import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfiguredBaseReader } from "../src/bun/configured-base";
import { readRemoteDefaults } from "../src/bun/git-engine";
import { createRepositoryReader, readFallbackBase } from "../src/bun/repository-reader";
import type { ConfiguredBase } from "../src/shared/fallback-base";
import type { Worktree } from "../src/shared/model";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, isolatedEnvironment, makeRepository, ready, realTimber, recordedAppConfig, standInTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

let root: string;
/** A bare remote with main and develop. */
let remote: string;
/** A clone of it: `git clone` sets `refs/remotes/origin/HEAD` to origin/main. */
let clone: string;
/** A repository with two remotes, neither with a cached default branch. */
let twoRemotes: string;

const refsOf = (path: string) => git(path, "for-each-ref", "--format=%(refname) %(objectname) %(symref)");

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-fallback-base-")));
	const source = makeRepository(root, "source");
	git(source, "branch", "develop");
	remote = join(root, "remote.git");
	git(root, "clone", "--bare", source, remote);
	clone = join(root, "clone");
	git(root, "clone", remote, clone);

	twoRemotes = makeRepository(root, "two remotes");
	git(twoRemotes, "remote", "add", "origin", remote);
	git(twoRemotes, "remote", "add", "mirror", remote);
	git(twoRemotes, "fetch", "origin");
	git(twoRemotes, "fetch", "mirror");
	// Git 2.48 and later cache the remote's HEAD on a fetch; this repository is one without.
	git(twoRemotes, "remote", "set-head", "origin", "--delete");
	git(twoRemotes, "remote", "set-head", "mirror", "--delete");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("reading the remotes and their cached default branches from Git", () => {
	test("a clone has origin, whose default is origin/main, and the read changes no ref or file", async () => {
		const refs = refsOf(clone);
		const files = fingerprint(join(clone, ".git"));
		const defaults = await readRemoteDefaults(join(clone, ".git"));
		expect(defaults?.remotes).toEqual(["origin"]);
		expect([...defaults!.heads]).toEqual([["origin", "refs/remotes/origin/main"]]);
		expect(refsOf(clone)).toBe(refs);
		expect(fingerprint(join(clone, ".git"))).toBe(files);
	});

	test("remotes whose HEAD is not cached have no default", async () => {
		const defaults = await readRemoteDefaults(join(twoRemotes, ".git"));
		expect(defaults?.remotes.toSorted()).toEqual(["mirror", "origin"]);
		expect(defaults?.heads.size).toBe(0);
	});

	test("a folder that is no repository gives null", async () => {
		const plain = join(root, "plain");
		mkdirSync(plain, { recursive: true });
		expect(await readRemoteDefaults(join(plain, ".git"))).toBeNull();
	});
});

describe("the repository's fallback base", () => {
	const primary: Worktree = {
		id: "primary", path: "/work/clone", canonicalPath: "/work/clone", branch: "main", head: null, primary: true, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: { kind: "unassigned" }, issue: null, baseCounts: null,
		sync: { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/main" },
	};
	const linked: Worktree = { ...primary, id: "linked", path: "/work/clone-worktrees/main", primary: false };

	/** Sources for the clone, with a Timber settings read that counts its runs and answers `answer`. */
	const sources = (setup: "repository" | "machine" | "none" | "unknown", answer: ConfiguredBase | null = { baseBranch: null, remote: null }) => {
		const runs: string[] = [];
		return {
			runs,
			sources: {
				commonGitDir: join(clone, ".git"), primaryRoot: clone, setup, timber: "/bin/timber",
				configuredBase: async (_timber: string, primaryRoot: string) => {
					runs.push(primaryRoot);
					return answer;
				},
			},
		};
	};

	test("with no Timber settings files, Timber is not run and the remote's default is the fallback", async () => {
		const { runs, sources: from } = sources("none");
		expect(await readFallbackBase([primary, linked], from)).toBe("refs/remotes/origin/main");
		expect(runs).toEqual([]);
	});

	test("with settings files, Timber's effective settings decide: nothing set uses the remote's default, a base_branch keeps Rebase", async () => {
		const plain = sources("repository");
		expect(await readFallbackBase([primary], plain.sources)).toBe("refs/remotes/origin/main");
		expect(plain.runs).toEqual([clone]);
		expect(await readFallbackBase([primary], sources("machine", { baseBranch: "main", remote: null }).sources)).toBe("refs/remotes/origin/main");
		expect(await readFallbackBase([primary], sources("machine", { baseBranch: "develop", remote: null }).sources)).toBe("refs/remotes/origin/develop");
		expect(await readFallbackBase([primary], sources("repository", null).sources)).toBeNull();
	});

	test("Timber is not run for a primary checkout that cannot fall back to its upstream, nor with unknown settings", async () => {
		for (const worktrees of [
			[linked],
			[{ ...primary, base: { kind: "assigned", ref: "refs/remotes/origin/main" } } satisfies Worktree],
			[{ ...primary, sync: { kind: "unpublished" } } satisfies Worktree],
			[{ ...primary, branch: "local", sync: primary.sync } satisfies Worktree],
		]) {
			const { runs, sources: from } = sources("repository");
			expect(await readFallbackBase(worktrees, from)).toBeNull();
			expect(runs).toEqual([]);
		}
		const unknown = sources("unknown");
		expect(await readFallbackBase([primary], unknown.sources)).toBeNull();
		expect(unknown.runs).toEqual([]);
	});

	test("with no cached default, only a configured base gives a fallback base", async () => {
		const none = sources("none");
		expect(await readFallbackBase([primary], { ...none.sources, commonGitDir: join(twoRemotes, ".git") })).toBeNull();
		expect(none.runs).toEqual([]);
		expect(await readFallbackBase([primary], { ...sources("repository").sources, commonGitDir: join(twoRemotes, ".git") })).toBeNull();
		const configured = sources("repository", { baseBranch: "main", remote: "origin" });
		expect(await readFallbackBase([primary], { ...configured.sources, commonGitDir: join(twoRemotes, ".git") })).toBe("refs/remotes/origin/main");
	});
});

describe("reading Timber's settings for the fallback base", () => {
	test("is kept until a settings file or the Timber changes", async () => {
		const place = mkdtempSync(join(root, "cache-"));
		const home = join(place, "home");
		mkdirSync(join(home, ".config", "timber"), { recursive: true });
		const environment = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
		let runs = 0;
		const reader = createConfiguredBaseReader(environment, async () => {
			runs += 1;
			return { baseBranch: null, remote: null };
		}, "linux", () => home);
		const answer = await reader("/bin/timber", place);
		expect(answer).toEqual({ baseBranch: null, remote: null });
		await reader("/bin/timber", place);
		expect(runs).toBe(1);
		writeFileSync(join(place, ".timber.toml"), 'base_branch = "main"\n');
		await reader("/bin/timber", place);
		expect(runs).toBe(2);
		writeFileSync(join(home, ".config", "timber", "config.toml"), 'remote = "origin"\n');
		await reader("/bin/timber", place);
		expect(runs).toBe(3);
		await reader("/bin/timber", place);
		expect(runs).toBe(3);
		await reader("/usr/local/bin/timber", place);
		expect(runs).toBe(4);
	});
});

describe("reading Timber's effective settings", () => {
	/** Timber's recorded answer for a repository, with its effective settings changed. */
	const answer = (effective: Record<string, unknown>) => {
		const recorded = JSON.parse(recordedAppConfig.records.merged) as { effective: Record<string, unknown> };
		return JSON.stringify({ ...recorded, effective: { ...recorded.effective, ...effective } });
	};
	const readWith = async (name: string, output: string, exitCode = 0) => {
		const place = mkdtempSync(join(root, `${name}-`));
		const timber = standInTimber(place, "timber", output, exitCode);
		const read = await createConfiguredBaseReader({ ...process.env, HOME: place, XDG_CONFIG_HOME: join(place, "config") })(timber.path, place);
		return { read, timber, place };
	};

	test("runs timber __app-config read for the repository in its primary checkout, and keeps base_branch and remote", async () => {
		const { read, timber, place } = await readWith("set", answer({ base_branch: "develop", remote: "upstream" }));
		expect(read).toEqual({ baseBranch: "develop", remote: "upstream" });
		expect(readFileSync(join(timber.folder, "arguments"), "utf8").trim()).toBe("__app-config read --scope repository");
		expect(realpathSync(readFileSync(join(timber.folder, "cwd"), "utf8").trim())).toBe(realpathSync(place));
	});

	test("unset or blank values are none, as in Timber's recorded answer", async () => {
		expect((await readWith("recorded", recordedAppConfig.records.merged)).read).toEqual({ baseBranch: null, remote: null });
		expect((await readWith("blank", answer({ base_branch: "  ", remote: "" }))).read).toEqual({ baseBranch: null, remote: null });
	});

	test("a refusal or an answer this app cannot read gives null", async () => {
		expect((await readWith("refused", "", 1)).read).toBeNull();
		expect((await readWith("garbage", "not json")).read).toBeNull();
		expect((await readWith("other scope", recordedAppConfig.records.merged.replace('"scope":"repository"', '"scope":"global"'))).read).toBeNull();
	});

	test("a failed read is not kept: the next one runs Timber again", async () => {
		const place = mkdtempSync(join(root, "retry-"));
		let runs = 0;
		const reader = createConfiguredBaseReader({ HOME: place }, async () => {
			runs += 1;
			return runs === 1 ? null : { baseBranch: null, remote: null };
		}, "linux", () => place);
		expect(await reader("/bin/timber", place)).toBeNull();
		expect(await reader("/bin/timber", place)).toEqual({ baseBranch: null, remote: null });
		await reader("/bin/timber", place);
		expect(runs).toBe(2);
	});
});

describe.skipIf(realTimber === null)("with the installed Timber, on a real clone", () => {
	test("no settings: the primary checkout on main falls back to origin/main; a base_branch in .timber.toml names its own", async () => {
		const place = mkdtempSync(join(root, "real-"));
		const environment = isolatedEnvironment(place);
		const checkout = join(place, "checkout");
		git(place, "clone", remote, checkout);
		const reader = createRepositoryReader(async () => ready(realTimber!), environment);
		const plain = await reader.reload(checkout);
		expect(plain?.setup).toBe("none");
		expect(plain?.fallbackBase).toBe("refs/remotes/origin/main");

		writeFileSync(join(checkout, ".timber.toml"), 'base_branch = "develop"\n');
		const configured = await reader.reload(checkout);
		expect(configured?.setup).toBe("repository");
		expect(configured?.fallbackBase).toBe("refs/remotes/origin/develop");

		// Settings that name no base: Timber's effective settings are read, and the remote's default stays.
		writeFileSync(join(checkout, ".timber.toml"), 'remote = "origin"\n');
		const remoteOnly = await reader.reload(checkout);
		expect(remoteOnly?.fallbackBase).toBe("refs/remotes/origin/main");
	});
});
