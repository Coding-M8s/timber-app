import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCodexConversation, findCursorConversation } from "../src/bun/agent-conversations";
import { SESSIONS_FILE_LIMIT, createSessionLayout, endedKey, sessionsFilePath, type SessionLayoutDependencies } from "../src/bun/session-layout";
import type { RunningSession } from "../src/bun/terminals";
import type { Attention } from "../src/shared/attention";

const CLAUDE = "0b6f1c1e-7a52-4f0e-9d53-2f1f6f0c7a11";
const CODEX = "01a17995-a303-7160-8d6d-d7587e0d5d50";
const FOUND = "01a17995-a303-7160-8d6d-d7587e0d5d51";

let root: string;
let file: string;
let live: RunningSession[];
let warnings: string[];
let searches: { cwd: string; since: number; taken: string[]; budget: number }[];
let answer: (cwd: string) => string | null;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-layout-")));
	file = sessionsFilePath(join(root, "settings.json"));
	live = [];
	warnings = [];
	searches = [];
	answer = () => null;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function layout(overrides: Partial<SessionLayoutDependencies> = {}) {
	return createSessionLayout({
		file,
		running: () => live,
		find: (_store, options) => {
			searches.push({ cwd: options.cwd, since: options.since, taken: [...options.taken].sort(), budget: options.budget });
			return answer(options.cwd);
		},
		warn: message => warnings.push(message),
		...overrides,
	});
}

const session = (id: string, worktree: string, more: Partial<RunningSession> = {}): RunningSession => ({
	id, worktree, path: `/r/${worktree}`, kind: "terminal", agent: null, resumable: null, conversation: null, startedAt: 10_000, name: null, restored: null, program: null, conversationFolder: null, ...more,
});
const claude = (id: string, worktree: string, more: Partial<RunningSession> = {}) => session(id, worktree, { kind: "agent", agent: "Claude Code", resumable: "claude", program: "claude", conversation: CLAUDE, conversationFolder: "/home/a/.claude", ...more });
const codex = (id: string, worktree: string, more: Partial<RunningSession> = {}) => session(id, worktree, { kind: "agent", agent: "Codex", resumable: "codex", program: "codex", conversationFolder: "/home/a/.codex", ...more });
const grok = (id: string, worktree: string, more: Partial<RunningSession> = {}) => session(id, worktree, { kind: "agent", agent: "Grok Build", resumable: "grok", program: "grok", conversation: CLAUDE, conversationFolder: "/home/a/.grok", ...more });
const cursor = (id: string, worktree: string, more: Partial<RunningSession> = {}) => session(id, worktree, { kind: "agent", agent: "Cursor CLI", resumable: "cursor", program: "cursor", conversationFolder: "/home/a/.cursor", ...more });
const attention = (worktree: string | null, chip: string | null): Attention => ({
	visible: true, focused: true, selected: worktree === null ? null : { repository: "/r", worktree: `/r/${worktree}`, id: worktree }, session: chip,
});

async function reopened() {
	const next = layout();
	await next.load();
	return next.take();
}

describe("the sessions saved at quit", () => {
	test("no file gives nothing to restore and no warning", async () => {
		expect(await reopened()).toBeNull();
		expect(warnings).toEqual([]);
	});

	test("the file is beside the settings file", () => {
		const folder = join("/home/a", ".config", "timber-app");
		expect(sessionsFilePath(join(folder, "settings.json"))).toBe(join(folder, "sessions.json"));
	});

	test("what one run saves, the next takes once", async () => {
		live = [session("1", "w1"), claude("2", "w1"), session("3", "w1", { name: "dev server" })];
		const first = layout();
		first.attend(attention("w1", "2"));
		first.save();
		const next = layout();
		await next.load();
		expect(next.take()).toEqual({ selected: "w1", worktrees: { w1: { shown: 1, sessions: [{ kind: "terminal" }, { kind: "agent", agent: "Claude Code", conversation: CLAUDE }, { kind: "terminal", name: "dev server" }] } } });
		expect(next.take()).toBeNull();
		expect(warnings).toEqual([]);
	});

	test("the file on disk is the minimal shape", () => {
		live = [session("1", "w1"), claude("2", "w1")];
		const first = layout();
		first.attend(attention("w1", "2"));
		first.save();
		const text = readFileSync(file, "utf8");
		expect(Object.keys(JSON.parse(text)).sort()).toEqual(["selected", "version", "worktrees"]);
		for (const left of ["\"id\"", "\"path\"", "\"repository\"", "\"command\"", "\"shell\"", "/r/w1", "startedAt", "resumable", "null"]) expect(text).not.toContain(left);
		// Nothing is left beside it.
		expect(readdirSync(root)).toEqual(["sessions.json"]);
	});

	test("the shown chip of every worktree is remembered as the selection moves", async () => {
		live = [session("a", "w1"), session("c", "w1"), session("x", "w2"), session("b", "w2")];
		const first = layout();
		first.attend(attention("w1", "a"));
		first.attend(attention("w2", "b"));
		first.attend(attention("w1", "c"));
		// While Timber is not ready the window reports no selection. That changes nothing.
		first.attend(attention(null, null));
		first.save();
		const taken = await reopened();
		expect(taken?.selected).toBe("w1");
		expect(taken?.worktrees.w1!.shown).toBe(1);
		expect(taken?.worktrees.w2!.shown).toBe(1);
	});

	test("a damaged file is moved aside and saving works again", async () => {
		writeFileSync(file, "{oops");
		const damaged = layout();
		await damaged.load();
		expect(damaged.take()).toBeNull();
		expect(readFileSync(`${file}.damaged`, "utf8")).toBe("{oops");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("damaged");
		live = [session("1", "w1")];
		damaged.save();
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([{ kind: "terminal" }]);
	});

	test("a newer file is left byte for byte and nothing is saved in this run", async () => {
		const text = "{\"version\":2,\"worktrees\":{\"w\":{\"anything\":true}}}";
		writeFileSync(file, text);
		const newer = layout();
		await newer.load();
		expect(newer.take()).toBeNull();
		live = [session("1", "w1")];
		newer.save();
		newer.resume();
		newer.save();
		expect(readFileSync(file, "utf8")).toBe(text);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("newer");
	});

	test("saving twice writes once; after resume it writes again", async () => {
		live = [session("1", "w1")];
		const first = layout();
		first.save();
		// As closeAll would leave it.
		live = [];
		first.save();
		expect(JSON.parse(readFileSync(file, "utf8")).worktrees.w1.sessions).toHaveLength(1);
		first.resume();
		first.save();
		expect(JSON.parse(readFileSync(file, "utf8")).worktrees).toEqual({});
	});

	test("a saved session opened again and then closed does not come back", async () => {
		writeFileSync(file, "{\"version\":1,\"worktrees\":{\"w1\":{\"shown\":0,\"sessions\":[{\"kind\":\"terminal\"}]}}}");
		const first = layout();
		await first.load();
		first.take();
		first.restored({ worktree: "w1", index: 0 }, "opened");
		first.save();
		expect(await reopened()).toBeNull();
	});

	test("the one Codex session of a worktree gets the conversation found for its folder", async () => {
		live = [session("1", "w1"), codex("2", "w1", { conversation: CODEX, startedAt: 50_000 })];
		answer = () => FOUND;
		// A clock that stands still, so the budget is exactly what is left.
		const first = layout({ now: () => 1_000 });
		first.save();
		expect(searches).toEqual([{ cwd: "/r/w1", since: 48_000, taken: [], budget: 300 }]);
		expect((await reopened())?.worktrees.w1!.sessions[1]).toEqual({ kind: "agent", agent: "Codex", conversation: FOUND });
	});

	test("when nothing is found the Codex session keeps the conversation it was opened with, or has none", async () => {
		live = [codex("1", "w1", { conversation: CODEX }), codex("2", "w2")];
		layout().save();
		const taken = await reopened();
		expect(taken?.worktrees.w1!.sessions).toEqual([{ kind: "agent", agent: "Codex", conversation: CODEX }]);
		expect(taken?.worktrees.w2!.sessions).toEqual([{ kind: "agent", agent: "Codex" }]);
	});

	test("two Codex sessions in one worktree are never guessed apart", async () => {
		live = [codex("1", "w1", { conversation: CODEX }), codex("2", "w1")];
		answer = () => FOUND;
		layout().save();
		expect(searches).toEqual([]);
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([{ kind: "agent", agent: "Codex", conversation: CODEX }, { kind: "agent", agent: "Codex" }]);
	});

	test("a conversation is never given to two sessions", async () => {
		live = [claude("0", "w0"), codex("1", "w1"), codex("2", "w2")];
		answer = () => FOUND;
		layout().save();
		expect(searches.map(search => search.taken)).toEqual([[CLAUDE], [CLAUDE, FOUND].sort()]);
		const taken = await reopened();
		expect(taken?.worktrees.w1!.sessions).toEqual([{ kind: "agent", agent: "Codex", conversation: FOUND }]);
		expect(taken?.worktrees.w2!.sessions).toEqual([{ kind: "agent", agent: "Codex" }]);
	});

	test("the searches at quit have 300 ms in all", () => {
		let clock = 0;
		live = [codex("1", "w1"), codex("2", "w2"), codex("3", "w3")];
		const first = layout({
			now: () => clock,
			find: (_store, options) => {
				searches.push({ cwd: options.cwd, since: options.since, taken: [], budget: options.budget });
				clock += 200;
				return null;
			},
		});
		first.save();
		expect(searches.map(search => search.budget)).toEqual([300, 100]);
		expect(existsSync(file)).toBe(true);
	});

	test("a search that throws does not stop the save", async () => {
		live = [codex("1", "w1", { conversation: CODEX })];
		layout({ find: () => { throw new Error("broken"); } }).save();
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([{ kind: "agent", agent: "Codex", conversation: CODEX }]);
	});

	test.skipIf(process.platform === "win32")("a folder that cannot be written warns and never throws", () => {
		live = [session("1", "w1")];
		const broken = layout({ file: "/proc/nope/sessions.json" });
		expect(() => broken.save()).not.toThrow();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("/proc/nope/sessions.json");
	});

	test("discard deletes the file, the damaged copy, and temp files, and nothing is written after", () => {
		live = [session("1", "w1")];
		writeFileSync(`${file}.damaged`, "x");
		writeFileSync(`${file}.123.abc.tmp`, "x");
		writeFileSync(join(root, "settings.json"), "{}");
		const first = layout();
		first.save();
		first.discard();
		expect(readdirSync(root)).toEqual(["settings.json"]);
		first.resume();
		first.save();
		expect(readdirSync(root)).toEqual(["settings.json"]);
	});

	/**
	 * The fastest of three runs, in milliseconds. Each run saves from a new
	 * layout, so it does all the work again, Codex search included. But `bun run test` runs other test files
	 * at the same time, and on a busy machine one run can wait for the CPU.
	 */
	function fastest(run: () => void): number {
		let best = Infinity;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const started = performance.now();
			run();
			best = Math.min(best, performance.now() - started);
		}
		return best;
	}

	test("200 worktrees with 5 sessions each are saved in under 100 ms", async () => {
		for (let worktree = 0; worktree < 200; worktree += 1) {
			const id = `/home/someone/work/timber/.git\u0000verified\u0000/home/someone/work/timber-worktrees/feature-${worktree}`;
			live.push(
				session(`${worktree}-1`, id), session(`${worktree}-2`, id, { name: "dev server" }), claude(`${worktree}-3`, id, { conversation: crypto.randomUUID() }),
				codex(`${worktree}-4`, id, { conversation: crypto.randomUUID() }), session(`${worktree}-5`, id),
			);
		}
		const took = fastest(() => layout({ find: () => null }).save());
		const size = readFileSync(file).length;
		console.log(`quit save of 200 worktrees x 5 sessions: ${took.toFixed(1)} ms, ${size} bytes (budget: 300 ms Codex search plus this, under 500 ms)`);
		expect(took).toBeLessThan(100);
		expect(size).toBeLessThan(100 * 1024);
		expect(Object.keys((await reopened())!.worktrees)).toHaveLength(200);
	});

	test("the worst case, a real Codex search in 200 worktrees over 600 session files, still saves in under 500 ms", () => {
		const home = join(root, "codex home");
		const since = Date.now() - 60_000;
		// Session files of other folders, as many as a busy month leaves, with first lines as long as Codex writes them.
		for (let at = 0; at < 600; at += 1) {
			const time = new Date(since - (at % 3) * 86_400_000 + at * 10);
			const day = join(home, "sessions", String(time.getFullYear()), String(time.getMonth() + 1).padStart(2, "0"), String(time.getDate()).padStart(2, "0"));
			mkdirSync(day, { recursive: true });
			const id = `${String(at).padStart(8, "0")}-0000-4000-8000-000000000000`;
			const meta = { type: "session_meta", payload: { id, timestamp: time.toISOString(), cwd: "/elsewhere", source: "cli", base_instructions: { text: "x".repeat(20_000) } } };
			writeFileSync(join(day, `rollout-${time.getTime()}-${id}.jsonl`), `${JSON.stringify(meta)}\n`);
		}
		for (let worktree = 0; worktree < 200; worktree += 1) {
			live.push(session(`${worktree}-1`, `w${worktree}`), codex(`${worktree}-2`, `w${worktree}`, { startedAt: since }));
		}
		const took = fastest(() => layout({ find: (_store, options) => findCodexConversation({ ...options, folder: home }) }).save());
		console.log(`worst case quit save, real Codex search in 200 worktrees over 600 files: ${took.toFixed(1)} ms`);
		expect(took).toBeLessThan(500);
		expect(existsSync(file)).toBe(true);
	});
});

describe("saved sessions that did not open again in this run", () => {
	const saved = (worktrees: Record<string, unknown>, selected?: string) => writeFileSync(file, JSON.stringify({ version: 1, ...(selected ? { selected } : {}), worktrees }));
	const T = (name: string) => ({ kind: "terminal" as const, name });

	async function loaded(overrides: Partial<SessionLayoutDependencies> = {}) {
		const first = layout(overrides);
		await first.load();
		first.take();
		return first;
	}

	test("quitting before any opened keeps them all, with the selection", async () => {
		saved({ w1: { shown: 1, sessions: [T("a"), T("b")] }, w2: { shown: 0, sessions: [T("c")] } }, "w2");
		(await loaded()).save();
		expect(await reopened()).toEqual({ selected: "w2", worktrees: { w1: { shown: 1, sessions: [T("a"), T("b")] }, w2: { shown: 0, sessions: [T("c")] } } });
	});

	test("quitting while a worktree still opens keeps the rest in their saved order", async () => {
		saved({ w1: { shown: 2, sessions: [T("a"), T("b"), T("c")] } });
		const first = await loaded();
		live = [session("1", "w1", { name: "a", restored: { worktree: "w1", index: 0 } })];
		first.restored({ worktree: "w1", index: 0 }, "opened");
		first.save();
		expect(await reopened()).toEqual({ worktrees: { w1: { shown: 2, sessions: [T("a"), T("b"), T("c")] } } });
	});

	test("a session that runs counts even before its answer was noted", async () => {
		saved({ w1: { shown: 0, sessions: [T("a")] } });
		const first = await loaded();
		live = [session("1", "w1", { name: "a", restored: { worktree: "w1", index: 0 } })];
		first.save();
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([T("a")]);
	});

	test("a session opened in this run goes after the saved ones still to come", async () => {
		saved({ w1: { shown: 0, sessions: [T("a"), T("b")] } });
		const first = await loaded();
		live = [session("1", "w1", { name: "a", restored: { worktree: "w1", index: 0 } }), session("2", "w1", { name: "new" })];
		first.restored({ worktree: "w1", index: 0 }, "opened");
		first.save();
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([T("a"), T("b"), T("new")]);
	});

	test("one that failed to start is kept with a miss, and dropped after three launches in a row", async () => {
		saved({ w1: { shown: 0, sessions: [{ kind: "agent", agent: "Codex" }] } });
		for (const missed of [1, 2]) {
			const run = await loaded();
			run.restored({ worktree: "w1", index: 0 }, "not-found");
			run.restored({ worktree: "w1", index: 0 }, "not-found");
			run.save();
			expect((await reopened())?.worktrees.w1!.sessions).toEqual([{ kind: "agent", agent: "Codex", missed }]);
		}
		const last = await loaded();
		last.restored({ worktree: "w1", index: 0 }, "failed");
		last.save();
		expect(await reopened()).toBeNull();
	});

	test("one whose agent left Settings is dropped at once", async () => {
		saved({ w1: { shown: 0, sessions: [{ kind: "agent", agent: "Gone" }, T("a")] } });
		const first = await loaded();
		first.restored({ worktree: "w1", index: 0 }, "not-configured");
		first.save();
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([T("a")]);
	});

	test("a worktree the window found gone is dropped; only strings are read", async () => {
		saved({ w1: { shown: 0, sessions: [T("a")] }, w2: { shown: 0, sessions: [T("b")] } });
		const first = await loaded();
		first.forget(["w1", 7]);
		first.forget("w2");
		first.save();
		expect(Object.keys((await reopened())!.worktrees)).toEqual(["w2"]);
	});

	test("a tag that is not one, or names nothing saved, changes nothing", async () => {
		saved({ w1: { shown: 0, sessions: [T("a")] } });
		const first = await loaded();
		for (const tag of [null, "w1", { worktree: "w1", index: -1 }, { worktree: "w1", index: 0.5 }, { worktree: "w9", index: 0 }, { worktree: "w1", index: 4 }]) first.restored(tag, "opened");
		first.save();
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([T("a")]);
	});

	test("a worktree not visited in this run keeps its shown chip over a second restart", async () => {
		saved({ w1: { shown: 0, sessions: [T("a")] }, w2: { shown: 2, sessions: [T("b"), T("c"), T("d")] } }, "w1");
		const first = await loaded();
		live = [
			session("1", "w1", { name: "a", restored: { worktree: "w1", index: 0 } }),
			...["b", "c", "d"].map((name, index) => session(`w2-${index}`, "w2", { name, restored: { worktree: "w2", index } })),
		];
		for (const index of [0, 1, 2]) first.restored({ worktree: "w2", index }, "opened");
		first.restored({ worktree: "w1", index: 0 }, "opened");
		first.attend(attention("w1", "1"));
		first.save();
		expect((await reopened())?.worktrees.w2!.shown).toBe(2);
	});

	test("when the saved shown chip did not open, the nearest one before it shows", async () => {
		saved({ w1: { shown: 2, sessions: [T("a"), T("b"), { kind: "agent", agent: "Gone" }] } });
		const first = await loaded();
		live = [0, 1].map(index => session(`${index}`, "w1", { name: ["a", "b"][index]!, restored: { worktree: "w1", index } }));
		for (const index of [0, 1]) first.restored({ worktree: "w1", index }, "opened");
		first.restored({ worktree: "w1", index: 2 }, "not-configured");
		first.save();
		expect((await reopened())?.worktrees.w1).toEqual({ shown: 1, sessions: [T("a"), T("b")] });
	});

	test("a worktree id like __proto__ is only a key", async () => {
		writeFileSync(file, '{"version":1,"worktrees":{"__proto__":{"shown":0,"sessions":[{"kind":"terminal"}]}}}');
		const read = await reopened();
		expect(Object.getPrototypeOf(read!.worktrees)).toBeNull();
		expect(Object.keys(read!.worktrees)).toEqual(["__proto__"]);
		const first = await loaded();
		first.save();
		expect(readFileSync(file, "utf8")).toContain('"__proto__"');
	});

	test("a file over the limit is not read, and is moved aside", async () => {
		writeFileSync(file, `{"version":1,"worktrees":{},"pad":"${"x".repeat(SESSIONS_FILE_LIMIT)}"}`);
		expect(await reopened()).toBeNull();
		expect(existsSync(`${file}.damaged`)).toBe(true);
	});
});

describe("conversations checked at quit", () => {
	test("a Codex session is not given the conversation of a sibling that ran meanwhile and closed", () => {
		live = [codex("A", "w1", { startedAt: 50_000 })];
		answer = () => FOUND;
		layout({ endedAgents: () => new Map([[endedKey("codex", "w1"), 60_000]]), now: () => 1_000 }).save();
		expect(searches).toEqual([]);
	});

	test("a sibling that ended before this one started does not stop the search", () => {
		live = [codex("A", "w1", { startedAt: 50_000 })];
		answer = () => FOUND;
		layout({ endedAgents: () => new Map([[endedKey("codex", "w1"), 40_000], [endedKey("codex", "w2"), 90_000], [endedKey("cursor", "w1"), 90_000]]), now: () => 1_000 }).save();
		expect(searches.map(search => search.cwd)).toEqual(["/r/w1"]);
	});

	test("with real Codex files: open A, open B, close B, quit, and A keeps its own", async () => {
		const home = join(root, "codex");
		const at = (seconds: number) => Date.UTC(2026, 10, 20, 12, 0, seconds);
		const write = (id: string, seconds: number) => {
			const day = new Date(at(seconds));
			const folder = join(home, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
			mkdirSync(folder, { recursive: true });
			writeFileSync(join(folder, `rollout-${seconds}-${id}.jsonl`), `${JSON.stringify({ type: "session_meta", payload: { id, cwd: "/r/w1", source: "cli", timestamp: new Date(at(seconds)).toISOString() } })}\n`);
		};
		write(CODEX, 10);
		write(FOUND, 20);
		live = [codex("A", "w1", { startedAt: at(10) })];
		const real = (ended: Map<string, number>) => layout({
			endedAgents: () => ended,
			find: (_store, options) => findCodexConversation({ ...options, folder: home }),
		});
		real(new Map([[endedKey("codex", "w1"), at(30)]])).save();
		expect((await reopened())?.worktrees.w1!.sessions[0]).toEqual({ kind: "agent", agent: "Codex" });
		real(new Map()).save();
		expect((await reopened())?.worktrees.w1!.sessions[0]).toEqual({ kind: "agent", agent: "Codex", conversation: FOUND });
	});

	test("a Codex started as typed counts when Codex conversations are told apart, running or ended", () => {
		answer = () => FOUND;
		live = [codex("A", "w1", { startedAt: 50_000 }), session("B", "w1", { kind: "agent", agent: "Codex fix", program: "codex", conversationFolder: "/home/a/.codex" })];
		layout({ now: () => 1_000 }).save();
		expect(searches).toEqual([]);
		// The one Codex of the worktree started as typed: it has no conversation of its own to look for.
		live = [session("B", "w1", { kind: "agent", agent: "Codex fix", program: "codex", conversationFolder: "/home/a/.codex" })];
		layout({ now: () => 1_000 }).save();
		expect(searches).toEqual([]);
	});

	test("each session is looked for in the folder its agent kept its conversations in, and Codex sessions with their own home folders are told apart", async () => {
		const claudeAsked: [string, string][] = [];
		const homes: string[] = [];
		live = [
			claude("C", "w1", { conversationFolder: "/home/a/.claude-work" }),
			codex("A", "w1", { startedAt: 50_000 }),
			codex("B", "w1", { startedAt: 50_000, conversationFolder: "/home/a/.codex-work" }),
		];
		answer = () => FOUND;
		layout({
			now: () => 1_000,
			exists: (_store, id, folder) => (claudeAsked.push([id, folder]), true),
			find: (_store, options) => (homes.push(options.folder), options.folder === "/home/a/.codex-work" ? FOUND : CODEX),
		}).save();
		expect(claudeAsked).toEqual([[CLAUDE, "/home/a/.claude-work"]]);
		expect(homes.sort()).toEqual(["/home/a/.codex", "/home/a/.codex-work"]);
		expect((await reopened())?.worktrees.w1!.sessions.map(saved => (saved as { conversation?: string }).conversation)).toEqual([CLAUDE, CODEX, FOUND]);
	});

	test("the ids the app gave are checked before a search can use up the time", async () => {
		let clock = 0;
		live = [codex("A", "w1"), claude("C", "w2")];
		layout({
			now: () => clock,
			find: () => {
				clock += 1_000;
				return null;
			},
			exists: () => false,
		}).save();
		expect((await reopened())?.worktrees.w2!.sessions[0]).toEqual({ kind: "agent", agent: "Claude Code" });
	});

	test("a Claude Code id is saved only when Claude Code wrote that conversation", async () => {
		live = [claude("1", "w1"), claude("2", "w1", { conversation: FOUND })];
		layout({ exists: (_store, id) => id === FOUND }).save();
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([{ kind: "agent", agent: "Claude Code" }, { kind: "agent", agent: "Claude Code", conversation: FOUND }]);
	});

	test("a Grok Build id is saved only when Grok wrote that session, checked in Grok's own layout", async () => {
		const asked: [string, string, string][] = [];
		live = [grok("1", "w1"), grok("2", "w1", { conversation: FOUND })];
		layout({ exists: (store, id, folder) => (asked.push([store, id, folder]), id === FOUND) }).save();
		expect(asked).toEqual([["grok-sessions", CLAUDE, "/home/a/.grok"], ["grok-sessions", FOUND, "/home/a/.grok"]]);
		expect((await reopened())?.worktrees.w1!.sessions).toEqual([{ kind: "agent", agent: "Grok Build" }, { kind: "agent", agent: "Grok Build", conversation: FOUND }]);
	});

	test("a Cursor CLI chat is looked for at quit in Cursor's own layout, and a Codex that ended does not stop it", async () => {
		const stores: string[] = [];
		live = [cursor("A", "w1", { startedAt: 50_000 })];
		layout({
			now: () => 1_000,
			endedAgents: () => new Map([[endedKey("codex", "w1"), 60_000]]),
			find: (store, options) => (stores.push(store), options.folder === "/home/a/.cursor" ? FOUND : null),
		}).save();
		expect(stores).toEqual(["cursor-chats"]);
		expect((await reopened())?.worktrees.w1!.sessions[0]).toEqual({ kind: "agent", agent: "Cursor CLI", conversation: FOUND });
	});

	test("two Cursor CLI sessions in a worktree, or one after another ended there, are not told apart", () => {
		answer = () => FOUND;
		live = [cursor("A", "w1"), cursor("B", "w1")];
		layout({ now: () => 1_000 }).save();
		live = [cursor("A", "w1", { startedAt: 50_000 })];
		layout({ now: () => 1_000, endedAgents: () => new Map([[endedKey("cursor", "w1"), 60_000]]) }).save();
		// A Cursor started as typed has no chat of its own to look for.
		live = [cursor("A", "w1", { resumable: null })];
		layout({ now: () => 1_000 }).save();
		expect(searches).toEqual([]);
	});

	test("with real Cursor files: the chat started in the worktree after the session did is saved", async () => {
		const config = join(root, "cursor");
		const work = join(root, "w1");
		const write = (id: string, at: number, hasConversation = true) => {
			const folder = join(config, "chats", createHash("md5").update(work).digest("hex"), id);
			mkdirSync(folder, { recursive: true });
			writeFileSync(join(folder, "meta.json"), JSON.stringify({ schemaVersion: 1, createdAtMs: at, hasConversation, updatedAtMs: at, cwd: work }));
		};
		write(CODEX, 5_000);
		write(FOUND, 12_000);
		write(CLAUDE, 13_000, false);
		live = [cursor("A", "w1", { path: work, conversationFolder: config, startedAt: 10_000 })];
		layout({ find: (store, options) => store === "cursor-chats" ? findCursorConversation(options) : null }).save();
		expect((await reopened())?.worktrees.w1!.sessions[0]).toEqual({ kind: "agent", agent: "Cursor CLI", conversation: FOUND });
	});

	test("a Claude Code check that throws keeps the id", async () => {
		live = [claude("1", "w1")];
		layout({ exists: () => { throw new Error("no"); } }).save();
		expect((await reopened())?.worktrees.w1!.sessions[0]).toEqual({ kind: "agent", agent: "Claude Code", conversation: CLAUDE });
	});
});
