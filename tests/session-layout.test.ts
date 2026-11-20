import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCodexConversation } from "../src/bun/agent-conversations";
import { createSessionLayout, sessionsFilePath, type SessionLayoutDependencies } from "../src/bun/session-layout";
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
		findCodex: options => {
			searches.push({ cwd: options.cwd, since: options.since, taken: [...options.taken].sort(), budget: options.budget });
			return answer(options.cwd);
		},
		warn: message => warnings.push(message),
		...overrides,
	});
}

const session = (id: string, worktree: string, more: Partial<RunningSession> = {}): RunningSession => ({
	id, worktree, path: `/r/${worktree}`, kind: "terminal", agent: null, resumable: null, conversation: null, startedAt: 10_000, name: null, ...more,
});
const claude = (id: string, worktree: string, more: Partial<RunningSession> = {}) => session(id, worktree, { kind: "agent", agent: "Claude Code", resumable: "claude", conversation: CLAUDE, ...more });
const codex = (id: string, worktree: string, more: Partial<RunningSession> = {}) => session(id, worktree, { kind: "agent", agent: "Codex", resumable: "codex", ...more });
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
		expect(sessionsFilePath("/home/a/.config/timber-app/settings.json")).toBe("/home/a/.config/timber-app/sessions.json");
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

	test("with nothing running the file says so, and the next run restores nothing", async () => {
		writeFileSync(file, "{\"version\":1,\"worktrees\":{\"w1\":{\"shown\":0,\"sessions\":[{\"kind\":\"terminal\"}]}}}");
		const first = layout();
		await first.load();
		first.save();
		expect(await reopened()).toBeNull();
	});

	test("the one Codex session of a worktree gets the conversation found for its folder", async () => {
		live = [session("1", "w1"), codex("2", "w1", { conversation: CODEX, startedAt: 50_000 })];
		answer = () => FOUND;
		const first = layout();
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

	test("the Codex search has 300 ms in all", () => {
		let clock = 0;
		live = [codex("1", "w1"), codex("2", "w2"), codex("3", "w3")];
		const first = layout({
			now: () => clock,
			findCodex: options => {
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
		layout({ findCodex: () => { throw new Error("broken"); } }).save();
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

	test("200 worktrees with 5 sessions each are saved in under 100 ms", async () => {
		for (let worktree = 0; worktree < 200; worktree += 1) {
			const id = `/home/someone/work/timber/.git\u0000verified\u0000/home/someone/work/timber-worktrees/feature-${worktree}`;
			live.push(
				session(`${worktree}-1`, id), session(`${worktree}-2`, id, { name: "dev server" }), claude(`${worktree}-3`, id, { conversation: crypto.randomUUID() }),
				codex(`${worktree}-4`, id, { conversation: crypto.randomUUID() }), session(`${worktree}-5`, id),
			);
		}
		const first = layout({ findCodex: () => null });
		const started = performance.now();
		first.save();
		const took = performance.now() - started;
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
		const first = layout({ findCodex: options => findCodexConversation({ homeFolder: home, ...options }) });
		const started = performance.now();
		first.save();
		const took = performance.now() - started;
		console.log(`worst case quit save, real Codex search in 200 worktrees over 600 files: ${took.toFixed(1)} ms`);
		expect(took).toBeLessThan(500);
		expect(existsSync(file)).toBe(true);
	});
});
