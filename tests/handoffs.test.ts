import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BURST_LIMIT, BURST_WINDOW_MS, type HandoffFolder, openHandoffFolder } from "../src/bun/handoffs";
import { sessionEnvironment } from "../src/bun/terminals";
import { HANDOFF_SIZE_LIMIT, HANDOFF_VARIABLE, type WorktreeHandoff, isHandoffName, parseHandoff } from "../src/shared/handoff";
import { describeHandoffNotListed, handoffAgent } from "../src/mainview/handoff-format";
import { AGENT_PRESETS } from "../src/shared/agent";
import { until, windows } from "./support/runtime";
import { fingerprint, git, makeRepository } from "./support/timber";

/** A record as Timber's `timber new` writes it (Timber's docs/ide-contract.md). */
const record = (repository: string, worktree: string, agent = true, extra: object = {}) => JSON.stringify({
	schemaVersion: 1, command: "new", repository: { primaryWorktreeRoot: repository }, worktree: { path: worktree, branch: "feature" }, agent, ...extra,
});

describe("reading a handoff record", () => {
	test("takes Timber's v1 record and nothing else", () => {
		expect(parseHandoff(record("/repo", "/repo-worktrees/feature"))).toEqual({ repository: "/repo", worktree: "/repo-worktrees/feature", agent: true });
		expect(parseHandoff(JSON.stringify({ ...JSON.parse(record("/repo", "/w")), command: "open" }))?.worktree).toBe("/w");
		expect(parseHandoff(record("C:\\repo", "C:\\repo-worktrees\\feature", false))).toEqual({ repository: "C:\\repo", worktree: "C:\\repo-worktrees\\feature", agent: false });
		for (const text of [
			"", "not json", "[]", "null",
			JSON.stringify({ ...JSON.parse(record("/repo", "/w")), schemaVersion: 2 }),
			JSON.stringify({ ...JSON.parse(record("/repo", "/w")), command: "done" }),
			record("relative", "/w"), record("/repo", "w"), record("/repo", "/w\0x"),
			JSON.stringify({ ...JSON.parse(record("/repo", "/w")), agent: "yes" }),
			JSON.stringify({ ...JSON.parse(record("/repo", "/w")), worktree: "/w" }),
		]) expect(parseHandoff(text)).toBeNull();
	});

	test("reads only finished records: Timber writes a dot-file and renames it", () => {
		expect(isHandoffName("1-2-abc.json")).toBe(true);
		expect(isHandoffName(".1-2-abc.tmp")).toBe(false);
		expect(isHandoffName(".1-2-abc.json")).toBe(false);
		expect(isHandoffName("notes.txt")).toBe(false);
	});

	test("starts the first saved agent only when Timber wanted its agent", () => {
		const handoff: WorktreeHandoff = { repository: "/repo", worktree: "/w", agent: true };
		expect(handoffAgent(handoff, AGENT_PRESETS)?.name).toBe(AGENT_PRESETS[0]!.name);
		expect(handoffAgent(handoff, [])).toBeNull();
		expect(handoffAgent({ ...handoff, agent: false }, AGENT_PRESETS)).toBeNull();
	});

	test("a path that is not listed is shown cleaned and quoted for the shell", () => {
		const text = describeHandoffNotListed({ repository: "/repo", worktree: "/o'ne\u001b[2Jx", agent: true });
		expect(text).not.toContain("\u001b");
		expect(text).toEndWith("timber open --agent --no-editor -- '/o'\\''ne\uFFFD[2Jx'");
		expect(describeHandoffNotListed({ repository: "/repo", worktree: "/w", agent: false })).toEndWith("Add its repository to open it here.");
	});
});

describe("a terminal session's environment", () => {
	test("names this run's handoff folder, never one inherited from the app's own environment", () => {
		const inherited = { PATH: "/bin", [HANDOFF_VARIABLE]: "/old/run" };
		expect(sessionEnvironment(inherited, "/run/now")).toMatchObject({ PATH: "/bin", TERM_PROGRAM: "timber-app", [HANDOFF_VARIABLE]: "/run/now" });
		expect(HANDOFF_VARIABLE in sessionEnvironment(inherited, null)).toBe(false);
	});
});

// Folder modes, symbolic links, and a shell writing as Timber does are part of what is tested.
describe.skipIf(windows)("the handoff folder, with a real repository", () => {
	let root: string;
	let primary: string;
	let linked: string;
	let folder: HandoffFolder;
	let heard: WorktreeHandoff[];
	let problems: string[];
	let clock: number;

	beforeEach(async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-handoff-test-")));
		primary = makeRepository(root, "repo");
		linked = join(root, "repo-worktrees", "feature");
		git(primary, "worktree", "add", "-b", "feature", linked);
		heard = [];
		problems = [];
		clock = 1_000_000;
		folder = await openHandoffFolder({ parent: root, onHandoff: handoff => heard.push(handoff), onProblem: message => problems.push(message), now: () => clock });
	});
	afterEach(() => {
		folder.close();
		rmSync(root, { recursive: true, force: true });
	});

	/** Write a record as Timber does: a private dot-file, renamed into place. */
	function handOff(text: string, name = `${Date.now()}-1-${Math.random().toString(16).slice(2, 14)}`) {
		const temporary = join(folder.path, `.${name}.tmp`);
		writeFileSync(temporary, text, { mode: 0o600 });
		Bun.spawnSync(["mv", temporary, join(folder.path, `${name}.json`)]);
	}

	test("is private to this user and removed on close", () => {
		expect(statSync(folder.path).mode & 0o777).toBe(0o700);
		folder.close();
		expect(existsSync(folder.path)).toBe(false);
		folder.close();
	});

	test("hears a record written by a shell in a session, deletes it, and leaves the repository untouched", async () => {
		const before = { refs: git(primary, "show-ref"), worktrees: git(primary, "worktree", "list", "--porcelain"), files: fingerprint(linked) };
		// What the session's program gets, as `timber new` would: the folder in TIMBER_APP_HANDOFF.
		const env = sessionEnvironment({ PATH: process.env.PATH }, folder.path) as Record<string, string>;
		const script = `printf '%s' "$RECORD" > "$${HANDOFF_VARIABLE}/.one.tmp" && mv "$${HANDOFF_VARIABLE}/.one.tmp" "$${HANDOFF_VARIABLE}/one.json"`;
		const shell = Bun.spawnSync(["/bin/sh", "-c", script], { cwd: primary, env: { ...env, RECORD: record(primary, linked) } });
		expect(shell.exitCode).toBe(0);
		expect(await until(() => heard.length === 1)).toBe(true);
		expect(heard).toEqual([{ repository: primary, worktree: linked, agent: true }]);
		expect(await until(() => readdirSync(folder.path).length === 0)).toBe(true);
		expect({ refs: git(primary, "show-ref"), worktrees: git(primary, "worktree", "list", "--porcelain"), files: fingerprint(linked) }).toEqual(before);
		expect(problems).toEqual([]);
	});

	test("never reads a record still being written, and reads it once renamed", async () => {
		writeFileSync(join(folder.path, ".half.tmp"), "{\"schemaVersion\":");
		await folder.scan();
		expect(heard).toEqual([]);
		expect(readdirSync(folder.path)).toEqual([".half.tmp"]);
		handOff(record(primary, linked, false));
		await folder.scan();
		expect(heard).toEqual([{ repository: primary, worktree: linked, agent: false }]);
	});

	test("deletes links, oversized and broken records without passing them on, and leaves folders alone", async () => {
		const outside = join(root, "outside.json");
		writeFileSync(outside, record(primary, linked));
		symlinkSync(outside, join(folder.path, "link.json"));
		mkdirSync(join(folder.path, "folder.json"));
		handOff(record(primary, linked, true, { padding: "x".repeat(HANDOFF_SIZE_LIMIT) }), "big");
		handOff("not json", "broken");
		await folder.scan();
		expect(heard).toEqual([]);
		expect(readdirSync(folder.path)).toEqual(["folder.json"]);
		// The link was removed, not what it points to.
		expect(existsSync(outside)).toBe(true);
	});

	test("passes on at most a few records at a time, deletes the rest, and takes more once the burst is over", async () => {
		for (let index = 0; index < BURST_LIMIT + 3; index += 1) handOff(record(primary, linked), `burst-${index}`);
		await folder.scan();
		expect(await until(() => readdirSync(folder.path).length === 0)).toBe(true);
		expect(heard).toHaveLength(BURST_LIMIT);
		expect(problems).toEqual(Array(3).fill("Dropped a handed-off worktree: too many came at once."));
		clock += BURST_WINDOW_MS;
		handOff(record(primary, linked), "later");
		await folder.scan();
		expect(heard).toHaveLength(BURST_LIMIT + 1);
	});
});
