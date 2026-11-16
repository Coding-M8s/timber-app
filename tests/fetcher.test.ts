import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BATCH_SSH_COMMAND, type GitRun, type RunGit, batchSshCommand, createGitRunner, fetchEnvironment } from "../src/bun/fetch-git";
import { createFetcher } from "../src/bun/fetcher";
import { type WatchTarget, createRepositoryWatcher } from "../src/bun/repository-watcher";
import { type ForcePushMarks, type RepositoryFetch, withForcePushes } from "../src/shared/git-fetch";
import { manualClock } from "./support/clock";
import { fingerprint, git } from "./support/timber";

const windows = process.platform === "win32";
const settle = async () => {
	for (let round = 0; round < 10; round++) await Bun.sleep(0);
};

/** Git with no configuration from the machine, as the `git` helper of the tests uses. */
const testEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_COMMAND: undefined, GIT_SSH: undefined };

describe("fetchEnvironment and batchSshCommand", () => {
	test("never let Git, SSH, or a credential manager ask for anything, and keep the rest", () => {
		const environment = fetchEnvironment({ PATH: "/usr/bin", GIT_ASKPASS: "/usr/bin/code-askpass", SSH_ASKPASS: "/usr/lib/ssh/askpass", HOME: "/home/sam", UNSET: undefined });
		expect(environment).toMatchObject({
			PATH: "/usr/bin",
			HOME: "/home/sam",
			GIT_TERMINAL_PROMPT: "0",
			GIT_ASKPASS: "",
			SSH_ASKPASS: "",
			SSH_ASKPASS_REQUIRE: "never",
			GCM_INTERACTIVE: "never",
			GIT_OPTIONAL_LOCKS: "0",
			LC_ALL: "C",
		});
		expect("UNSET" in environment).toBe(false);
		expect("GIT_SSH_COMMAND" in environment).toBe(false);
	});

	test("use SSH in batch mode only when the person chose no SSH command of their own", () => {
		expect(batchSshCommand({}, null)).toEqual({ GIT_SSH_COMMAND: BATCH_SSH_COMMAND });
		expect(batchSshCommand({}, "  \n")).toEqual({ GIT_SSH_COMMAND: BATCH_SSH_COMMAND });
		expect(batchSshCommand({ GIT_SSH_COMMAND: "ssh -i ~/.ssh/work" }, null)).toEqual({});
		expect(batchSshCommand({ GIT_SSH: "/usr/bin/plink" }, null)).toEqual({});
		expect(batchSshCommand({}, "ssh -i ~/.ssh/work\n")).toEqual({});
	});
});

describe.skipIf(windows)("createGitRunner", () => {
	let root: string;
	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-git-runner-")));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("answers soon after Git ends, even when something Git started keeps its pipes open", async () => {
		// A stand-in Git that leaves a process in a session of its own holding standard error, then ends at once.
		const standIn = join(root, "git");
		writeFileSync(standIn, "#!/bin/sh\necho done\nsetsid sleep 8 >/dev/null &\nsetsid sleep 8 2>&2 &\nexit 3\n");
		Bun.spawnSync(["chmod", "+x", standIn]);
		const started = Date.now();
		const answer = await createGitRunner(standIn, {})(["fetch"], { network: true });
		expect(Date.now() - started).toBeLessThan(5000);
		expect(answer).toMatchObject({ exitCode: 3, stdout: "done\n", timedOut: false });
	});

	test("stops Git when asked, and says so", async () => {
		const standIn = join(root, "git");
		writeFileSync(standIn, "#!/bin/sh\nexec sleep 30\n");
		Bun.spawnSync(["chmod", "+x", standIn]);
		const stopping = new AbortController();
		const running = createGitRunner(standIn, {})(["fetch"], { network: true, signal: stopping.signal });
		await Bun.sleep(100);
		const started = Date.now();
		stopping.abort();
		expect(await running).toMatchObject({ exitCode: null, stderr: "The app stopped Git." });
		expect(Date.now() - started).toBeLessThan(3000);
	});
});

/** A runner whose answers the test decides, recording every call. */
function scriptedGit(answer: (args: readonly string[], network: boolean) => Partial<GitRun> | Promise<Partial<GitRun>>) {
	const calls: { args: readonly string[]; network: boolean; env: Record<string, string> | undefined }[] = [];
	const runGit: RunGit = async (args, { network, env }) => {
		calls.push({ args, network, env });
		return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...await answer(args, network) };
	};
	return { runGit, calls, fetches: () => calls.filter(call => call.network) };
}

const REPO: WatchTarget = { path: "/work/sample", commonDir: "/work/sample/.git" };
const OTHER: WatchTarget = { path: "/work/other", commonDir: "/work/other/.git" };
const tracks = (branch: string, remote = "origin") => `refs/heads/${branch}\0${"c".repeat(40)}\0refs/remotes/${remote}/${branch}\0${remote}/${branch}\0${remote}\n`;

/** Repositories whose one branch tracks origin, which fetches with the usual refspec. `offline` makes every fetch fail as with no network. */
function plainAnswer(state: { offline: boolean } = { offline: false }) {
	return (args: readonly string[], network: boolean): Partial<GitRun> => {
		if (network) return state.offline ? { exitCode: 128, stderr: "fatal: unable to access 'https://example.com/x.git/': Could not resolve host: example.com\n" } : {};
		if (args.includes("refs/heads")) return { stdout: tracks("main") };
		if (args.includes("core.sshCommand")) return { exitCode: 1 };
		if (args.includes("--get-all")) return { stdout: "+refs/heads/*:refs/remotes/origin/*\n" };
		return {};
	};
}
const plainRepository = (state?: { offline: boolean }) => scriptedGit(plainAnswer(state));

function scheduled(runGit: RunGit, marks?: ForcePushMarks) {
	const clock = manualClock();
	const changed: string[] = [];
	const statuses: RepositoryFetch[] = [];
	const saved: ForcePushMarks[] = [];
	const fetcher = createFetcher({
		runGit, onChanged: path => changed.push(path), onStatus: status => statuses.push(status), schedule: clock.schedule, now: clock.now,
		environment: {}, ...(marks ? { marks } : {}), saveMarks: next => saved.push(next),
	});
	async function advance(milliseconds: number) {
		clock.advance(milliseconds);
		await settle();
	}
	return { clock, changed, statuses, saved, fetcher, advance };
}

const MINUTE = 60_000;

describe("createFetcher, when it fetches", () => {
	test("fetches nothing in the background until it is told to, and nothing at all with background fetching off", async () => {
		const scripted = plainRepository();
		const { fetcher, advance } = scheduled(scripted.runGit);
		fetcher.sync([REPO, OTHER]);
		await advance(60 * MINUTE);
		expect(scripted.calls).toEqual([]);
		fetcher.configure({ background: false, intervalMinutes: 1 });
		await advance(24 * 60 * MINUTE);
		expect(scripted.calls).toEqual([]);
	});

	test("fetches each repository a little after start, one after the other, then once per interval", async () => {
		const scripted = plainRepository();
		const { fetcher, advance } = scheduled(scripted.runGit);
		fetcher.sync([REPO, OTHER]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		await advance(9_999);
		expect(scripted.fetches().length).toBe(0);
		await advance(1);
		expect(scripted.fetches().length).toBe(1);
		await advance(5_000);
		expect(scripted.fetches().length).toBe(2);
		await advance(5 * MINUTE - 5_001);
		expect(scripted.fetches().length).toBe(2);
		await advance(1);
		expect(scripted.fetches().length).toBe(3);
	});

	test("turning background fetching off stops what was planned, and Fetch now still works", async () => {
		const scripted = plainRepository();
		const { fetcher, advance } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		fetcher.configure({ background: false, intervalMinutes: 5 });
		await advance(60 * MINUTE);
		expect(scripted.fetches().length).toBe(0);
		expect((await fetcher.fetchNow(REPO.path)).outcome).toBe("fetched");
		expect(scripted.fetches().length).toBe(1);
		await advance(60 * MINUTE);
		expect(scripted.fetches().length).toBe(1);
	});

	test("waits while the window is hidden, and fetches what came due once it shows again", async () => {
		const scripted = plainRepository();
		const { fetcher, advance } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		fetcher.setVisible(false);
		await advance(3 * 60 * MINUTE);
		expect(scripted.fetches().length).toBe(0);
		fetcher.setVisible(true);
		await settle();
		expect(scripted.fetches().length).toBe(1);
		// Fetch now works while hidden too.
		fetcher.setVisible(false);
		await fetcher.fetchNow(REPO.path);
		expect(scripted.fetches().length).toBe(2);
	});

	test("runs one fetch at a time per repository: asking again while one runs waits for it", async () => {
		let release!: () => void;
		const held = new Promise<void>(resolve => {
			release = resolve;
		});
		const plain = plainAnswer();
		const scripted = scriptedGit(async (args, network) => {
			if (network) await held;
			return plain(args, network);
		});
		const { fetcher, statuses } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		const first = fetcher.fetchNow(REPO.path);
		const second = fetcher.fetchNow(REPO.path);
		await settle();
		expect(scripted.fetches().length).toBe(1);
		expect(fetcher.statuses()).toEqual([{ repository: REPO.path, fetching: true, lastFetched: null, failure: null }]);
		release();
		expect(await first).toEqual(await second);
		expect(scripted.fetches().length).toBe(1);
		expect(statuses.map(status => status.fetching)).toEqual([true, false]);
	});

	test("fetches at most two repositories at the same time", async () => {
		const releases: (() => void)[] = [];
		const plain = plainAnswer();
		const scripted = scriptedGit(async (args, network) => {
			if (network) await new Promise<void>(resolve => releases.push(resolve));
			return plain(args, network);
		});
		const { fetcher } = scheduled(scripted.runGit);
		const third: WatchTarget = { path: "/work/third", commonDir: "/work/third/.git" };
		fetcher.sync([REPO, OTHER, third]);
		const all = [REPO, OTHER, third].map(target => fetcher.fetchNow(target.path));
		await settle();
		expect(scripted.fetches().length).toBe(2);
		expect(fetcher.statuses().every(status => status.fetching)).toBe(true);
		releases.shift()!();
		await settle();
		expect(scripted.fetches().length).toBe(3);
		for (const release of releases.splice(0)) release();
		await Promise.all(all);
	});

	test("after failures it waits longer each time, up to an hour, and the first fetch that works puts it back", async () => {
		const state = { offline: true };
		const scripted = plainRepository(state);
		const { fetcher, advance } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		await advance(10_000);
		expect(scripted.fetches().length).toBe(1);
		const waits: number[] = [];
		for (let attempt = 0; attempt < 6; attempt++) {
			const before = scripted.fetches().length;
			let waited = 0;
			while (scripted.fetches().length === before) {
				await advance(MINUTE);
				waited += MINUTE;
			}
			waits.push(waited / MINUTE);
		}
		// 5 minutes doubled for each failure in a row: 10, 20, 40, then never more than 60.
		expect(waits).toEqual([10, 20, 40, 60, 60, 60]);
		const failed = fetcher.statuses()[0]!;
		expect(failed.failure?.kind).toBe("offline");
		expect(failed.lastFetched).toBeNull();

		state.offline = false;
		expect((await fetcher.fetchNow(REPO.path)).outcome).toBe("fetched");
		expect(fetcher.statuses()[0]!.failure).toBeNull();
		const before = scripted.fetches().length;
		await advance(5 * MINUTE);
		expect(scripted.fetches().length).toBe(before + 1);
	});

	test("never retries sooner than the interval, even when the interval is longer than an hour", async () => {
		const scripted = plainRepository({ offline: true });
		const { fetcher, advance } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		fetcher.configure({ background: true, intervalMinutes: 120 });
		await advance(10_000);
		expect(scripted.fetches().length).toBe(1);
		await advance(120 * MINUTE - 1);
		expect(scripted.fetches().length).toBe(1);
		await advance(1);
		expect(scripted.fetches().length).toBe(2);
	});

	test("fetches only remotes a local branch tracks, never with a refspec that would write a local branch or a tag, and never asks", async () => {
		const scripted = scriptedGit((args, network) => {
			if (network) return {};
			if (args.includes("refs/heads")) return { stdout: tracks("main") + tracks("copy", "mirror") };
			if (args.includes("core.sshCommand")) return { exitCode: 1 };
			if (args.includes("remote.mirror.fetch")) return { stdout: "+refs/heads/*:refs/heads/*\n+refs/tags/*:refs/tags/*\n" };
			if (args.includes("remote.origin.fetch")) return { stdout: "+refs/heads/*:refs/remotes/origin/*\n" };
			return {};
		});
		const { fetcher } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		await fetcher.fetchNow(REPO.path);
		expect(scripted.fetches().map(call => call.args)).toEqual([[
			"--git-dir", REPO.commonDir, "-c", "credential.interactive=false", "fetch",
			"--prune", "--no-prune-tags", "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no", "--no-auto-gc", "--refmap=",
			"--", "origin", "+refs/heads/*:refs/remotes/origin/*",
		]]);
		expect(scripted.fetches()[0]!.env).toEqual({ GIT_SSH_COMMAND: BATCH_SSH_COMMAND });
	});

	test("a repository that leaves the list is no longer fetched or reported", async () => {
		const scripted = plainRepository();
		const { fetcher, advance, statuses } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		fetcher.sync([]);
		await advance(60 * MINUTE);
		expect(scripted.fetches().length).toBe(0);
		expect(statuses).toEqual([]);
		expect(await fetcher.fetchNow(REPO.path)).toMatchObject({ outcome: "not-listed" });
	});

	test("a repository removed while its fetch runs keeps no marks, and added again waits for that fetch", async () => {
		const releases: (() => void)[] = [];
		let refReads = 0;
		const scripted = scriptedGit(async (args, network) => {
			if (network) {
				await new Promise<void>(resolve => releases.push(resolve));
				return {};
			}
			if (args.includes("refs/remotes")) {
				// Before and after the first fetch: the upstream moved to a commit that is not a descendant.
				refReads++;
				return { stdout: `refs/remotes/origin/main\0${(refReads === 1 ? "a" : "b").repeat(40)}\n` };
			}
			if (args.includes("merge-base")) return { exitCode: 1 };
			return plainAnswer()(args, network);
		});
		const { fetcher, saved, changed } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		const first = fetcher.fetchNow(REPO.path);
		await settle();
		fetcher.remove(REPO.path);
		fetcher.sync([REPO]);
		const second = fetcher.fetchNow(REPO.path);
		await settle();
		expect(scripted.fetches().length).toBe(1);
		releases.shift()!();
		await first;
		await settle();
		expect(saved).toEqual([]);
		expect(changed).toEqual([]);
		expect(fetcher.marks(REPO.path)).toEqual({});
		expect(scripted.fetches().length).toBe(2);
		releases.shift()!();
		await second;
	});

	test("a repository removed while Git compares its commits keeps no mark", async () => {
		let releaseCompare!: () => void;
		let refReads = 0;
		const scripted = scriptedGit(async (args, network) => {
			if (args.includes("refs/remotes")) {
				refReads++;
				return { stdout: `refs/remotes/origin/main\0${(refReads === 1 ? "a" : "b").repeat(40)}\n` };
			}
			if (args.includes("merge-base")) {
				await new Promise<void>(resolve => {
					releaseCompare = resolve;
				});
				return { exitCode: 1 };
			}
			return plainAnswer()(args, network);
		});
		const { fetcher, saved } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		const running = fetcher.fetchNow(REPO.path);
		await settle();
		fetcher.remove(REPO.path);
		fetcher.sync([]);
		releaseCompare();
		await running;
		expect(fetcher.allMarks()).toEqual({});
		expect(saved).toEqual([]);
	});

	test("a fetch waiting its turn does not run once its repository left the list, nor in the background once that was turned off", async () => {
		const releases: (() => void)[] = [];
		const plain = plainAnswer();
		const scripted = scriptedGit(async (args, network) => {
			if (network) await new Promise<void>(resolve => releases.push(resolve));
			return plain(args, network);
		});
		const { fetcher, advance } = scheduled(scripted.runGit);
		const third: WatchTarget = { path: "/work/third", commonDir: "/work/third/.git" };
		const fourth: WatchTarget = { path: "/work/fourth", commonDir: "/work/fourth/.git" };
		const fifth: WatchTarget = { path: "/work/fifth", commonDir: "/work/fifth/.git" };
		fetcher.sync([REPO, OTHER, third, fourth, fifth]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		// All five come due; two run, three wait their turn.
		await advance(10_000 + 4 * 5_000);
		expect(scripted.fetches().length).toBe(2);
		const asked = fetcher.fetchNow(fifth.path);
		fetcher.remove(third.path);
		fetcher.configure({ background: false, intervalMinutes: 5 });
		for (let round = 0; round < 6; round++) {
			for (const release of releases.splice(0)) release();
			await settle();
		}
		await asked;
		// The two that ran, and the one the person asked for. Neither the removed one nor the other background one.
		expect(scripted.fetches().map(call => call.args[1])).toEqual([REPO.commonDir, OTHER.commonDir, fifth.commonDir]);
	});

	test("a background fetch of several remotes stops before the next one once switched off, and one the person asked for does not", async () => {
		const releases: (() => void)[] = [];
		const scripted = scriptedGit(async (args, network) => {
			if (network) {
				await new Promise<void>(resolve => releases.push(resolve));
				return {};
			}
			if (args.includes("refs/heads")) return { stdout: tracks("main") + tracks("copy", "fork") };
			if (args.includes("core.sshCommand")) return { exitCode: 1 };
			if (args.includes("remote.origin.fetch")) return { stdout: "+refs/heads/*:refs/remotes/origin/*\n" };
			if (args.includes("remote.fork.fetch")) return { stdout: "+refs/heads/*:refs/remotes/fork/*\n" };
			return {};
		});
		const remotes = () => scripted.fetches().map(call => call.args[call.args.indexOf("--") + 1]);
		const { fetcher, advance } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		await advance(10_000);
		expect(remotes()).toEqual(["origin"]);
		fetcher.configure({ background: false, intervalMinutes: 5 });
		releases.shift()!();
		await settle();
		expect(remotes()).toEqual(["origin"]);
		expect(fetcher.statuses()[0]!.lastFetched).toBeNull();

		const asked = fetcher.fetchNow(REPO.path);
		await settle();
		for (let round = 0; round < 3; round++) {
			for (const release of releases.splice(0)) release();
			await settle();
		}
		await asked;
		expect(remotes()).toEqual(["origin", "origin", "fork"]);
	});

	test("a fetch of several remotes stops before the next one once its repository left the list, and does not count as fetched", async () => {
		const releases: (() => void)[] = [];
		const scripted = scriptedGit(async (args, network) => {
			if (network) {
				await new Promise<void>(resolve => releases.push(resolve));
				return {};
			}
			if (args.includes("refs/heads")) return { stdout: tracks("main") + tracks("copy", "fork") };
			if (args.includes("core.sshCommand")) return { exitCode: 1 };
			if (args.includes("--get-all")) return { stdout: "+refs/heads/*:refs/remotes/x/*\n" };
			return {};
		});
		const { fetcher } = scheduled(scripted.runGit);
		fetcher.sync([REPO]);
		const running = fetcher.fetchNow(REPO.path);
		await settle();
		fetcher.sync([]);
		releases.shift()!();
		expect(await running).toMatchObject({ outcome: "not-listed" });
		expect(scripted.fetches().length).toBe(1);
	});

	test("a slot that is let go passes to the fetch that waited, never to one started in between", async () => {
		const releases: (() => void)[] = [];
		let running = 0;
		let most = 0;
		const plain = plainAnswer();
		const scripted = scriptedGit(async (args, network) => {
			if (network) {
				running++;
				most = Math.max(most, running);
				await new Promise<void>(resolve => releases.push(resolve));
				running--;
			}
			return plain(args, network);
		});
		const targets = ["/work/a", "/work/b", "/work/c", "/work/d"].map(path => ({ path, commonDir: `${path}/.git` }));
		let fetcher!: ReturnType<typeof createFetcher>;
		fetcher = createFetcher({
			runGit: scripted.runGit, onChanged: () => {}, environment: {},
			// A fetch started from inside a report, right as a slot is let go.
			onStatus: status => {
				if (status.repository === "/work/a" && !status.fetching) void fetcher.fetchNow("/work/d");
			},
		});
		fetcher.sync(targets);
		const all = targets.slice(0, 3).map(target => fetcher.fetchNow(target.path));
		await settle();
		releases.shift()!();
		await settle();
		for (let round = 0; round < 5; round++) {
			for (const release of releases.splice(0)) release();
			await settle();
		}
		await Promise.all(all);
		expect(most).toBe(2);
	});

	test("stopping asks a running fetch to end and plans nothing more", async () => {
		let aborted = false;
		const plain = plainRepository();
		const runGit: RunGit = async (args, options) => {
			if (options.network) {
				await new Promise<void>(resolve => options.signal?.addEventListener("abort", () => resolve()));
				aborted = true;
				return { exitCode: null, stdout: "", stderr: "The app stopped Git.", timedOut: false };
			}
			return plain.runGit(args, options);
		};
		const { fetcher, advance } = scheduled(runGit);
		fetcher.sync([REPO]);
		fetcher.configure({ background: true, intervalMinutes: 5 });
		const running = fetcher.fetchNow(REPO.path);
		await settle();
		fetcher.stop();
		await running;
		expect(aborted).toBe(true);
		await advance(60 * MINUTE);
		expect(await fetcher.fetchNow(REPO.path)).toMatchObject({ outcome: "not-listed" });
	});
});

describe("createFetcher, its force-push marks", () => {
	const at = 1_000;
	const mark = { upstream: "refs/remotes/origin/main", upstreamName: "origin/main", object: "b".repeat(40), branchObject: "c".repeat(40), at };

	test("start from the saved marks, and only the mark that was shown goes when it is seen", () => {
		const { fetcher, saved } = scheduled(plainRepository().runGit, { [REPO.path]: { main: mark } });
		expect(fetcher.marks(REPO.path)).toEqual({ main: mark });
		expect(fetcher.acknowledge(REPO.path, "main", at + 1)).toBe(false);
		expect(saved).toEqual([]);
		expect(fetcher.acknowledge(REPO.path, "main", at)).toBe(true);
		expect(fetcher.marks(REPO.path)).toEqual({});
		expect(saved).toEqual([{}]);
	});

	test("forgetting and removing a repository save the marks that are left", () => {
		const { fetcher, saved } = scheduled(plainRepository().runGit, { [REPO.path]: { main: mark, other: mark }, [OTHER.path]: { main: mark } });
		// Only the mark of that time: a newer mark of the same branch stays.
		expect(fetcher.forget(REPO.path, [{ branch: "other", at: at + 1 }])).toBe(false);
		expect(fetcher.forget(REPO.path, [{ branch: "main", at }, { branch: "missing", at }])).toBe(true);
		expect(fetcher.forget(REPO.path, [{ branch: "missing", at }])).toBe(false);
		fetcher.remove(OTHER.path);
		expect(saved).toEqual([{ [REPO.path]: { other: mark }, [OTHER.path]: { main: mark } }, { [REPO.path]: { other: mark } }]);
	});
});

describe.skipIf(windows)("createFetcher against real repositories", () => {
	let root: string;
	let remote: string;
	let mine: string;
	let theirs: string;
	let target: WatchTarget;

	const commit = (cwd: string, file: string, text: string, message = `Change ${file}`) => {
		writeFileSync(join(cwd, file), text);
		git(cwd, "add", file);
		git(cwd, "commit", "-q", "-m", message);
	};
	const head = (cwd: string, ref: string) => git(cwd, "rev-parse", ref).trim();

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-fetch-")));
		remote = join(root, "remote.git");
		mine = join(root, "mine");
		theirs = join(root, "theirs");
		git(root, "init", "-q", "--bare", "-b", "main", remote);
		git(root, "clone", "-q", remote, theirs);
		git(theirs, "checkout", "-q", "-b", "main");
		commit(theirs, "readme.md", "one\n");
		git(theirs, "push", "-q", "origin", "main");
		git(theirs, "push", "-q", "origin", "main:feature", "main:doomed");
		git(root, "clone", "-q", remote, mine);
		git(mine, "branch", "-q", "--track", "feature", "origin/feature");
		git(mine, "branch", "-q", "--track", "doomed", "origin/doomed");
		git(mine, "worktree", "add", "-q", join(root, "mine-feature"), "feature");
		target = { path: mine, commonDir: join(mine, ".git") };
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function realFetcher(environment: Record<string, string | undefined> = testEnvironment, marks?: ForcePushMarks) {
		const changed: string[] = [];
		const fetcher = createFetcher({
			runGit: createGitRunner("git", environment), onChanged: path => changed.push(path), onStatus: () => {}, environment, ...(marks ? { marks } : {}),
		});
		fetcher.sync([target]);
		return { fetcher, changed };
	}

	/** How every local branch of `mine` stands, as the sidebar reads it. */
	const tracking = () => git(mine, "for-each-ref", "--format=%(refname:short) %(upstream:track)", "refs/heads").split("\n").map(line => line.trimEnd()).filter(Boolean);

	test("a push from another clone shows as behind after the next fetch", async () => {
		const { fetcher, changed } = realFetcher();
		commit(theirs, "readme.md", "two\n");
		git(theirs, "push", "-q", "origin", "main");
		expect(tracking()).toContain("main");
		expect(await fetcher.fetchNow(mine)).toMatchObject({ outcome: "fetched" });
		expect(tracking()).toContain("main [behind 1]");
		expect(changed).toEqual([mine]);
		expect(fetcher.marks(mine)).toEqual({});
	});

	test("a fetch that brings nothing new reports no change, and wakes no watcher", async () => {
		const { fetcher, changed } = realFetcher();
		await fetcher.fetchNow(mine);
		const heard: string[] = [];
		const watcher = createRepositoryWatcher({ onChange: path => heard.push(path), quietMilliseconds: 50, mostMilliseconds: 500 });
		try {
			watcher.sync([target]);
			await Bun.sleep(200);
			heard.length = 0;
			await fetcher.fetchNow(mine);
			await Bun.sleep(500);
			expect(heard).toEqual([]);
			expect(changed).toEqual([]);
		} finally {
			watcher.stop();
		}
	});

	test("a force-push to a tracked branch is marked until it is seen", async () => {
		const { fetcher, changed } = realFetcher();
		// The feature branch gets a commit that this clone fetches, and then the remote's history drops it.
		git(theirs, "fetch", "-q", "origin");
		git(theirs, "checkout", "-q", "-b", "feature", "origin/feature");
		commit(theirs, "other.md", "first try\n", "First try");
		git(theirs, "push", "-q", "origin", "feature");
		git(mine, "fetch", "-q", "origin");
		git(theirs, "reset", "-q", "--hard", "HEAD~1");
		commit(theirs, "other.md", "second try\n", "Second try");
		git(theirs, "push", "-q", "--force", "origin", "feature");
		// An ordinary push to main as well, which is not a rewrite.
		git(theirs, "checkout", "-q", "main");
		commit(theirs, "readme.md", "three\n");
		git(theirs, "push", "-q", "origin", "main");

		await fetcher.fetchNow(mine);
		const marks = fetcher.marks(mine);
		expect(Object.keys(marks)).toEqual(["feature"]);
		expect(marks.feature).toMatchObject({ upstream: "refs/remotes/origin/feature", upstreamName: "origin/feature", object: head(theirs, "feature") });
		expect(changed).toEqual([mine]);
		// Marked until the person saw it, also across fetches that bring nothing new.
		await fetcher.fetchNow(mine);
		expect(Object.keys(fetcher.marks(mine))).toEqual(["feature"]);
		expect(fetcher.acknowledge(mine, "feature", marks.feature!.at)).toBe(true);
		expect(fetcher.marks(mine)).toEqual({});
	});

	test("a force-push that rewinds the upstream is marked, and stays marked while the branch is not behind", async () => {
		const { fetcher } = realFetcher();
		commit(theirs, "readme.md", "two\n");
		commit(theirs, "readme.md", "three\n");
		git(theirs, "push", "-q", "origin", "main");
		git(mine, "pull", "-q", "--ff-only");
		await fetcher.fetchNow(mine);
		git(theirs, "push", "-q", "--force", "origin", "HEAD~2:main");
		await fetcher.fetchNow(mine);
		const marks = fetcher.marks(mine);
		expect(Object.keys(marks)).toEqual(["main"]);
		expect(tracking()).toContain("main [ahead 2]");
		// As the sidebar reads it: ahead 2, behind 0, and the branch did not move, so the mark shows.
		const read = (head: string, behind: number) => withForcePushes({
			path: mine, name: "mine", available: true, failure: null,
			worktrees: [{
				id: "main", path: mine, canonicalPath: mine, branch: "main", head, primary: true, detached: false, locked: false, prunable: false, pathExists: true,
				changes: { kind: "known", modified: [], untracked: [] }, sync: { kind: "tracking", upstream: "origin/main", ahead: 2, behind },
			}],
		}, marks);
		expect(read(head(mine, "main"), 0).repository.worktrees[0]!.sync).toMatchObject({ forcePushed: { at: marks.main!.at } });
		expect(read(head(mine, "main"), 0).stale).toEqual([]);
		// Once the branch moved, as after a reset to the rewound upstream, it is no longer marked.
		expect(read("f".repeat(40), 0).stale).toEqual([{ branch: "main", at: marks.main!.at }]);
	});

	test("a deleted remote branch shows as upstream gone, its local branch stays, and its mark goes", async () => {
		const marks = { [mine]: { doomed: { upstream: "refs/remotes/origin/doomed", upstreamName: "origin/doomed", object: head(mine, "main"), branchObject: head(mine, "main"), at: 5 } } };
		const { fetcher } = realFetcher(testEnvironment, marks);
		git(theirs, "push", "-q", "origin", "--delete", "doomed");
		await fetcher.fetchNow(mine);
		expect(tracking()).toContain("doomed [gone]");
		expect(git(mine, "rev-parse", "--verify", "-q", "refs/heads/doomed").trim()).toBe(head(mine, "main"));
		expect(fetcher.marks(mine)).toEqual({});
	});

	test("fetching changes no local branch, tag, HEAD, index, stash, or working tree, only remote-tracking refs", async () => {
		const { fetcher } = realFetcher();
		writeFileSync(join(mine, "stashed.txt"), "kept\n");
		git(mine, "stash", "push", "-q", "-u");
		writeFileSync(join(mine, "untracked.txt"), "mine\n");
		writeFileSync(join(mine, "readme.md"), "edited, not committed\n");
		git(mine, "tag", "local-only");
		git(mine, "config", "fetch.pruneTags", "true");
		git(mine, "config", "fetch.prune", "true");
		git(theirs, "tag", "v1");
		git(theirs, "push", "-q", "origin", "v1");
		commit(theirs, "readme.md", "two\n");
		git(theirs, "push", "-q", "origin", "main", "main:feature");
		git(theirs, "push", "-q", "origin", "--delete", "doomed");
		// A refspec that would move local branches if it were used.
		git(mine, "config", "--add", "remote.origin.fetch", "+refs/heads/*:refs/heads/mirrored/*");
		const local = () => git(mine, "for-each-ref", "refs/heads", "refs/tags", "refs/stash") + git(mine, "symbolic-ref", "HEAD");
		const before = local();
		// Everything but Git's own folder and the remote-tracking refs, which a fetch is there to move.
		const unchanged = (folder: string) => fingerprint(folder).split("\n").filter(line => !line.includes("/.git/") && !line.includes("refs/remotes/")).join("\n");
		const files = [unchanged(mine), unchanged(join(root, "mine-feature"))];
		const index = readFileSync(join(mine, ".git", "index"));

		expect(await fetcher.fetchNow(mine)).toMatchObject({ outcome: "fetched" });
		expect(local()).toBe(before);
		expect(local()).toContain("refs/tags/local-only");
		expect(local()).not.toContain("refs/tags/v1");
		expect(readFileSync(join(mine, ".git", "index"))).toEqual(index);
		expect([unchanged(mine), unchanged(join(root, "mine-feature"))]).toEqual(files);
		expect(git(mine, "status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([" M readme.md", "?? untracked.txt"]);
		// The remote-tracking refs did move, and the deleted branch's was pruned.
		expect(head(mine, "origin/main")).toBe(head(theirs, "main"));
		expect(git(mine, "for-each-ref", "--format=%(refname)", "refs/remotes/origin/doomed").trim()).toBe("");
		expect(() => git(mine, "rev-parse", "--verify", "-q", "FETCH_HEAD")).toThrow();
	});

	test("a remote no local branch tracks is not fetched", async () => {
		git(mine, "remote", "add", "forgotten", "https://127.0.0.1:9/nothing.git");
		const { fetcher } = realFetcher();
		expect(await fetcher.fetchNow(mine)).toMatchObject({ outcome: "fetched" });
	});

	test("an unreachable remote fails as offline, at once and without asking for anything", async () => {
		git(mine, "remote", "set-url", "origin", "https://127.0.0.1:9/nothing.git");
		const { fetcher } = realFetcher();
		const started = Date.now();
		const result = await fetcher.fetchNow(mine);
		expect(Date.now() - started).toBeLessThan(15_000);
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.fetch.failure?.kind).toBe("offline");
	});

	test("a remote that wants a password fails as authentication instead of asking", async () => {
		// A remote helper that asks for credentials, as an HTTPS host does, with nothing stored to answer.
		const helper = join(root, "git-remote-askme");
		writeFileSync(helper, "#!/bin/sh\nprintf 'protocol=https\\nhost=example.invalid\\n\\n' | git credential fill >/dev/null || exit 128\n");
		Bun.spawnSync(["chmod", "+x", helper]);
		git(mine, "remote", "set-url", "origin", "askme::anything");
		const { fetcher, changed } = realFetcher({ ...testEnvironment, PATH: `${root}:${process.env.PATH}` });
		const result = await fetcher.fetchNow(mine);
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.fetch.failure?.kind).toBe("authentication");
		expect(changed).toEqual([]);
	});
});
