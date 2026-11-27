import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claudeConfigFolder, claudeConversationExists, codexConversationExists, codexHomeFolder, conversationExists, conversationFinders, conversationFolder,
	cursorConversationExists, findCodexConversation, findCursorConversation, grokConversationExists, piConversationExists, qwenConversationExists,
} from "../src/bun/agent-conversations";
import { agentById } from "../src/shared/agent-registry";

const ONE = "0b6f1c1e-7a52-4f0e-9d53-2f1f6f0c7a11";
const TWO = "01a17995-a303-7160-8d6d-d7587e0d5d50";
const THREE = "01a17995-a303-7160-8d6d-d7587e0d5d51";

let root: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-conversations-")));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const pad = (value: number) => String(value).padStart(2, "0");

/** A Codex session file as Codex writes it: a first line of session_meta with a long `base_instructions`, then more lines. */
function rollout(home: string, options: { id: string; cwd: string; at: number; source?: unknown; parent?: string | null; filler?: number; dayOf?: number }): string {
	const at = new Date(options.at);
	const day = new Date(options.dayOf ?? options.at);
	const folder = join(home, "sessions", String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
	mkdirSync(folder, { recursive: true });
	const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
	const file = join(folder, `rollout-${stamp}-${options.id}.jsonl`);
	const payload = {
		id: options.id, timestamp: at.toISOString(), cwd: options.cwd, source: options.source ?? "cli",
		...(options.parent === undefined ? {} : { parent_thread_id: options.parent }),
		base_instructions: { text: "x".repeat(options.filler ?? 20_000) },
	};
	writeFileSync(file, `${JSON.stringify({ timestamp: at.toISOString(), type: "session_meta", payload })}\n{"type":"event_msg"}\n`);
	return file;
}

describe("where the agents keep their conversations", () => {
	test("a full path in the environment wins, anything else is the home folder's", () => {
		expect(claudeConfigFolder({ CLAUDE_CONFIG_DIR: "/cfg/claude" }, "/home/a")).toBe("/cfg/claude");
		expect(claudeConfigFolder({ CLAUDE_CONFIG_DIR: "relative" }, "/home/a")).toBe(join("/home/a", ".claude"));
		expect(claudeConfigFolder({}, "/home/a")).toBe(join("/home/a", ".claude"));
		expect(codexHomeFolder({ CODEX_HOME: "/cfg/codex" }, "/home/a")).toBe("/cfg/codex");
		expect(codexHomeFolder({ CODEX_HOME: "" }, "/home/a")).toBe(join("/home/a", ".codex"));
	});

	test("Grok Build's is GROK_HOME or ~/.grok", () => {
		const grok = agentById("grok").resume!.conversations;
		expect(conversationFolder(grok, { GROK_HOME: "/cfg/grok" }, "/home/a")).toBe("/cfg/grok");
		expect(conversationFolder(grok, { XDG_CONFIG_HOME: "/cfg" }, "/home/a")).toBe(join("/home/a", ".grok"));
	});

	test("Cursor CLI's is CURSOR_CONFIG_DIR, else cursor in XDG_CONFIG_HOME, else ~/.cursor, as Cursor reads them", () => {
		const cursor = agentById("cursor").resume!.conversations;
		expect(conversationFolder(cursor, { CURSOR_CONFIG_DIR: "/cfg/cursor", XDG_CONFIG_HOME: "/xdg" }, "/home/a")).toBe("/cfg/cursor");
		expect(conversationFolder(cursor, { XDG_CONFIG_HOME: "/xdg" }, "/home/a")).toBe(join("/xdg", "cursor"));
		expect(conversationFolder(cursor, { XDG_CONFIG_HOME: "relative" }, "/home/a")).toBe(join("/home/a", ".cursor"));
		expect(conversationFolder(cursor, { XDG_CONFIG_HOME: " " }, "/home/a")).toBe(join("/home/a", ".cursor"));
		expect(conversationFolder(cursor, {}, "/home/a")).toBe(join("/home/a", ".cursor"));
	});

	test("every layout has its check, and the agents found at quit have their search", () => {
		expect(Object.keys(conversationExists).sort()).toEqual(["claude-projects", "codex-sessions", "cursor-chats", "grok-sessions", "pi-sessions", "qwen-projects"]);
		expect(Object.keys(conversationFinders).sort()).toEqual(["codex-sessions", "cursor-chats"]);
	});
});

/** A Grok Build session folder as Grok writes one, under its working folder's URL-encoded name. */
function grokSession(home: string, cwd: string, id: string): string {
	const folder = join(home, "sessions", encodeURIComponent(cwd), id);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "summary.json"), JSON.stringify({ info: { id, cwd }, session_summary: "", num_messages: 0 }));
	writeFileSync(join(folder, "updates.jsonl"), "");
	return folder;
}

describe("whether a Grok Build conversation is there", () => {
	test("found under any working folder's folder, beside Grok's own files, and not found when it is not", () => {
		grokSession(root, "/w/feat", ONE);
		mkdirSync(join(root, "sessions", encodeURIComponent("/w/other"), TWO), { recursive: true });
		writeFileSync(join(root, "sessions", "session_search.sqlite"), "");
		expect(grokConversationExists(ONE, root)).toBe(true);
		// A folder without its summary is not a session Grok can go back to.
		expect(grokConversationExists(TWO, root)).toBe(false);
		expect(grokConversationExists(THREE, root)).toBe(false);
	});

	test("an id that is not a UUID, or a folder that is not there, gives false", () => {
		grokSession(root, "/w/feat", ONE);
		expect(grokConversationExists("../sessions", root)).toBe(false);
		expect(grokConversationExists(ONE, join(root, "nowhere"))).toBe(false);
	});
});

/** A Cursor CLI chat as Cursor writes one: `chats/<md5 of the folder>/<id>/meta.json` and its store. */
function cursorChat(config: string, options: { id: string; cwd: string; at: number; hasConversation?: boolean; folderOf?: string; meta?: string }): string {
	const hash = createHash("md5").update(options.folderOf ?? options.cwd).digest("hex");
	const folder = join(config, "chats", hash, options.id);
	mkdirSync(folder, { recursive: true });
	const meta = options.meta ?? JSON.stringify({ schemaVersion: 1, createdAtMs: options.at, hasConversation: options.hasConversation ?? true, title: "Private title", updatedAtMs: options.at + 5_000, cwd: options.cwd });
	writeFileSync(join(folder, "meta.json"), meta);
	writeFileSync(join(folder, "store.db"), "");
	return folder;
}

describe("whether a Cursor CLI chat is there", () => {
	test("found under any folder's chats, and not found when it is not", () => {
		cursorChat(root, { id: ONE, cwd: "/w/feat", at: 1 });
		mkdirSync(join(root, "chats", "0123", TWO), { recursive: true });
		expect(cursorConversationExists(ONE, root)).toBe(true);
		expect(cursorConversationExists(TWO, root)).toBe(false);
		expect(cursorConversationExists(THREE, root)).toBe(false);
		expect(cursorConversationExists("..", root)).toBe(false);
		expect(cursorConversationExists(ONE, join(root, "nowhere"))).toBe(false);
	});
});

describe("finding the Cursor CLI chat a session is in", () => {
	const since = Date.UTC(2026, 10, 22, 12, 0, 0);
	let work: string;
	beforeEach(() => {
		work = join(root, "work", "feat");
		mkdirSync(work, { recursive: true });
	});
	const find = (extra: Partial<Parameters<typeof findCursorConversation>[0]> = {}) => findCursorConversation({ folder: root, cwd: work, since, taken: new Set(), ...extra });

	test("the newest chat with a message, in the session's folder, from its start on", () => {
		cursorChat(root, { id: ONE, cwd: work, at: since + 1_000 });
		cursorChat(root, { id: TWO, cwd: work, at: since + 2_000 });
		// No message yet: Cursor leaves such a folder behind when it is killed.
		cursorChat(root, { id: THREE, cwd: work, at: since + 3_000, hasConversation: false });
		expect(find()).toBe(TWO);
	});

	test("a chat from before the start, of another folder, taken, or unreadable is not taken", () => {
		cursorChat(root, { id: ONE, cwd: work, at: since - 1 });
		cursorChat(root, { id: TWO, cwd: "/elsewhere", at: since + 1_000, folderOf: work });
		cursorChat(root, { id: THREE, cwd: work, at: since + 1_000 });
		expect(find({ taken: new Set([THREE]) })).toBeNull();
		expect(find()).toBe(THREE);
		cursorChat(root, { id: "10000000-0000-4000-8000-000000000000", cwd: work, at: since + 9_000, meta: "{ not json" });
		cursorChat(root, { id: "20000000-0000-4000-8000-000000000000", cwd: work, at: since + 9_000, meta: JSON.stringify({ cwd: work, hasConversation: true, createdAtMs: "soon" }) });
		cursorChat(root, { id: "not-a-uuid", cwd: work, at: since + 9_000 });
		cursorChat(root, { id: "40000000-0000-4000-8000-000000000000", cwd: work, at: since + 9_000, meta: JSON.stringify({ cwd: work, hasConversation: true, createdAtMs: since + 9_000, isSubagent: true }) });
		cursorChat(root, { id: "30000000-0000-4000-8000-000000000000", cwd: work, at: since + 9_000, meta: JSON.stringify({ cwd: work, hasConversation: true, createdAtMs: since + 9_000, title: "x".repeat(70_000) }) });
		expect(find()).toBe(THREE);
	});

	test("a session in a folder reached through a link finds the chat Cursor filed under the real folder", () => {
		const link = join(root, "link");
		symlinkSync(join(root, "work"), link);
		cursorChat(root, { id: ONE, cwd: work, at: since + 1_000 });
		expect(find({ cwd: join(link, "feat") })).toBe(ONE);
	});

	test("a search that runs out of time finds nothing, since the chat folders are in no order", () => {
		cursorChat(root, { id: ONE, cwd: work, at: since + 1_000 });
		cursorChat(root, { id: TWO, cwd: work, at: since + 2_000 });
		let clock = 0;
		expect(find({ budget: 15, now: () => (clock += 10) })).toBeNull();
		clock = 0;
		expect(find({ budget: 1_000, now: () => (clock += 10) })).toBe(TWO);
	});

	test("nothing in Cursor's folder is changed", () => {
		const folder = cursorChat(root, { id: ONE, cwd: work, at: since + 1_000 });
		const before = { names: readdirSync(folder).sort(), meta: readFileSync(join(folder, "meta.json"), "utf8"), modified: statSync(join(folder, "meta.json")).mtimeMs };
		expect(find()).toBe(ONE);
		expect(cursorConversationExists(ONE, root)).toBe(true);
		expect({ names: readdirSync(folder).sort(), meta: readFileSync(join(folder, "meta.json"), "utf8"), modified: statSync(join(folder, "meta.json")).mtimeMs }).toEqual(before);
	});

	test("a folder that is not there finds nothing", () => {
		expect(findCursorConversation({ folder: join(root, "nowhere"), cwd: work, since, taken: new Set() })).toBeNull();
	});
});

describe("where Qwen Code and Pi keep theirs", () => {
	test("Qwen Code's is QWEN_HOME or ~/.qwen, and Pi's is PI_CODING_AGENT_DIR or ~/.pi/agent", () => {
		const qwen = agentById("qwen").resume!.conversations;
		const pi = agentById("pi").resume!.conversations;
		expect(conversationFolder(qwen, { QWEN_HOME: "/cfg/qwen" }, "/home/a")).toBe("/cfg/qwen");
		expect(conversationFolder(qwen, { QWEN_HOME: "relative" }, "/home/a")).toBe(join("/home/a", ".qwen"));
		expect(conversationFolder(pi, { PI_CODING_AGENT_DIR: "/cfg/pi" }, "/home/a")).toBe("/cfg/pi");
		expect(conversationFolder(pi, {}, "/home/a")).toBe(join("/home/a", ".pi", "agent"));
	});
});

describe("whether a Qwen Code conversation is there", () => {
	test("found as chats/<id>.jsonl under any project folder, and not found when it is not", () => {
		mkdirSync(join(root, "projects", "-work-a", "chats"), { recursive: true });
		mkdirSync(join(root, "projects", "-work-b", "chats"), { recursive: true });
		writeFileSync(join(root, "projects", "-work-b", "chats", `${ONE}.jsonl`), "{}\n");
		expect(qwenConversationExists(ONE, root)).toBe(true);
		expect(qwenConversationExists(TWO, root)).toBe(false);
	});

	test("a runtime file alone, as before the first message, is not a conversation, and nor is a file outside chats", () => {
		mkdirSync(join(root, "projects", "p", "chats"), { recursive: true });
		writeFileSync(join(root, "projects", "p", "chats", `${ONE}.runtime.json`), "{}");
		writeFileSync(join(root, "projects", "p", `${TWO}.jsonl`), "{}\n");
		expect(qwenConversationExists(ONE, root)).toBe(false);
		expect(qwenConversationExists(TWO, root)).toBe(false);
	});

	test("a folder that is not there, or an id that is not a UUID, gives false", () => {
		expect(qwenConversationExists(ONE, join(root, "nowhere"))).toBe(false);
		mkdirSync(join(root, "projects", "p", "chats"), { recursive: true });
		writeFileSync(join(root, "projects", "p", "chats", "--resume.jsonl"), "{}\n");
		expect(qwenConversationExists("--resume", root)).toBe(false);
		expect(qwenConversationExists(`../${ONE}`, root)).toBe(false);
	});
});

describe("whether a Pi conversation is there", () => {
	test("found as sessions/<folder>/<time>_<id>.jsonl, compared in lower case, and not found when it is not", () => {
		mkdirSync(join(root, "sessions", "--work-a--"), { recursive: true });
		mkdirSync(join(root, "sessions", "--work-b--"), { recursive: true });
		writeFileSync(join(root, "sessions", "--work-b--", `2026-11-27T10-00-00-000Z_${ONE.toUpperCase()}.jsonl`), "{}\n");
		expect(piConversationExists(ONE, root)).toBe(true);
		expect(piConversationExists(ONE.toUpperCase(), root)).toBe(true);
		expect(piConversationExists(TWO, root)).toBe(false);
	});

	test("a file of another name or kind is not a conversation", () => {
		mkdirSync(join(root, "sessions", "p"), { recursive: true });
		writeFileSync(join(root, "sessions", "p", `${ONE}.jsonl`), "{}\n");
		writeFileSync(join(root, "sessions", "p", `2026-11-27_${TWO}.json`), "{}");
		writeFileSync(join(root, "sessions", `x_${THREE}.jsonl`), "{}\n");
		expect(piConversationExists(ONE, root)).toBe(false);
		expect(piConversationExists(TWO, root)).toBe(false);
		expect(piConversationExists(THREE, root)).toBe(false);
	});

	test("a folder that is not there, or an id that is not a UUID, gives false", () => {
		expect(piConversationExists(ONE, join(root, "nowhere"))).toBe(false);
		mkdirSync(join(root, "sessions", "p"), { recursive: true });
		writeFileSync(join(root, "sessions", "p", "x_--resume.jsonl"), "{}\n");
		expect(piConversationExists("--resume", root)).toBe(false);
		expect(piConversationExists("resume", root)).toBe(false);
	});
});

describe("whether a Claude Code conversation is there", () => {
	test("found under any project folder, and not found when it is not", () => {
		mkdirSync(join(root, "projects", "-work-a"), { recursive: true });
		mkdirSync(join(root, "projects", "-work-b"), { recursive: true });
		writeFileSync(join(root, "projects", "-work-b", `${ONE}.jsonl`), "{}\n");
		expect(claudeConversationExists(ONE, root)).toBe(true);
		expect(claudeConversationExists(TWO, root)).toBe(false);
	});

	test("a folder that is not there gives false", () => {
		expect(claudeConversationExists(ONE, join(root, "nowhere"))).toBe(false);
	});

	test("an id that is not a UUID is never looked for, even when a file of that name is there", () => {
		mkdirSync(join(root, "projects", "p"), { recursive: true });
		writeFileSync(join(root, "projects", "p", "--resume.jsonl"), "{}\n");
		writeFileSync(join(root, "projects", "p", "..jsonl"), "{}\n");
		expect(claudeConversationExists("--resume", root)).toBe(false);
		expect(claudeConversationExists(".", root)).toBe(false);
		expect(claudeConversationExists(`../${ONE}`, root)).toBe(false);
	});
});

describe("whether a Codex conversation is there", () => {
	test("found in a day folder, and not found when it is not", () => {
		rollout(root, { id: TWO, cwd: "/w", at: Date.now() - 3 * 86_400_000, filler: 10 });
		expect(codexConversationExists(TWO, root)).toBe(true);
		expect(codexConversationExists(THREE, root)).toBe(false);
		expect(codexConversationExists("not-an-id", root)).toBe(false);
	});

	test("a folder that is not there gives false", () => {
		expect(codexConversationExists(TWO, join(root, "nowhere"))).toBe(false);
	});
});

describe("the Codex conversation of a folder since a session started", () => {
	const since = Date.parse("2026-11-20T12:00:00");
	const find = (extra: Partial<Parameters<typeof findCodexConversation>[0]> = {}) => findCodexConversation({ folder: root, cwd: "/w/feat", since, taken: new Set(), ...extra });

	test("the one started in the folder after the session started", () => {
		rollout(root, { id: ONE, cwd: "/w/feat", at: since - 60_000 });
		rollout(root, { id: TWO, cwd: "/w/feat", at: since + 5_000 });
		expect(find()).toBe(TWO);
	});

	test("another folder, a subagent, a non-interactive run, and a taken id are passed over", () => {
		rollout(root, { id: ONE, cwd: "/w/other", at: since + 9_000 });
		rollout(root, { id: THREE, cwd: "/w/feat", at: since + 8_000, source: { subagent: { kind: "review" } } });
		rollout(root, { id: "11111111-1111-4111-8111-111111111111", cwd: "/w/feat", at: since + 7_000, parent: TWO });
		rollout(root, { id: "22222222-2222-4222-8222-222222222222", cwd: "/w/feat", at: since + 6_000, source: "exec" });
		rollout(root, { id: "33333333-3333-4333-8333-333333333333", cwd: "/w/feat", at: since + 5_500 });
		rollout(root, { id: TWO, cwd: "/w/feat", at: since + 5_000 });
		expect(find()).toBe("33333333-3333-4333-8333-333333333333");
		expect(find({ taken: new Set(["33333333-3333-4333-8333-333333333333"]) })).toBe(TWO);
		expect(find({ taken: new Set(["33333333-3333-4333-8333-333333333333", TWO]) })).toBeNull();
	});

	test("none gives null", () => {
		expect(find()).toBeNull();
		rollout(root, { id: ONE, cwd: "/w/feat", at: since - 1 });
		expect(find()).toBeNull();
	});

	test("after /new the newest one wins", () => {
		rollout(root, { id: TWO, cwd: "/w/feat", at: since + 60_000 });
		rollout(root, { id: ONE, cwd: "/w/feat", at: since + 1_000 });
		expect(find()).toBe(TWO);
	});

	test("a first line that is not JSON, or 2 MiB long, is skipped without throwing", () => {
		const day = join(root, "sessions", "2026", "11", "20");
		mkdirSync(day, { recursive: true });
		writeFileSync(join(day, `rollout-2026-11-20T12-00-09-${THREE}.jsonl`), "not json\n");
		writeFileSync(join(day, `rollout-2026-11-20T12-00-08-${THREE}.jsonl`), `${"y".repeat(2 * 1024 * 1024)}\n`);
		writeFileSync(join(day, `rollout-2026-11-20T12-00-07-${THREE}.jsonl`), "");
		rollout(root, { id: ONE, cwd: "/w/feat", at: since + 1_000 });
		expect(find()).toBe(ONE);
	});

	test("a start just before midnight finds a file in the next day's folder", () => {
		const late = Date.parse("2026-11-20T23:59:30");
		rollout(root, { id: TWO, cwd: "/w/feat", at: late + 60_000 });
		expect(findCodexConversation({ folder: root, cwd: "/w/feat", since: late, taken: new Set() })).toBe(TWO);
	});

	test("day folders long before the start are not opened", () => {
		// A file whose own first line says it is new, in a folder of a week before: never read.
		rollout(root, { id: TWO, cwd: "/w/feat", at: since + 1_000, dayOf: since - 7 * 86_400_000 });
		expect(find()).toBeNull();
	});

	test("300 files of 20 KB first lines, 150 in range, are searched within the budget", () => {
		for (let at = 0; at < 300; at += 1) {
			const day = at < 150 ? since - 3 * 86_400_000 : since;
			const id = `${String(at).padStart(8, "0")}-0000-4000-8000-000000000000`;
			rollout(root, { id, cwd: at === 151 ? "/w/feat" : "/w/other", at: day + at * 1000 });
		}
		const started = performance.now();
		const found = find();
		const took = performance.now() - started;
		console.log(`Codex search of 300 session files, 150 in range: ${took.toFixed(1)} ms`);
		expect(found).toBe("00000151-0000-4000-8000-000000000000");
		expect(took).toBeLessThan(400);
		const none = performance.now();
		expect(find({ budget: 0 })).toBeNull();
		expect(performance.now() - none).toBeLessThan(5);
	});

	test("the search stops with what it has once the budget is spent", () => {
		rollout(root, { id: ONE, cwd: "/w/feat", at: since + 1_000 });
		rollout(root, { id: TWO, cwd: "/w/feat", at: since + 2_000 });
		let clock = 0;
		// Each look at the clock is 10 ms later: the newest file is opened, the next is not.
		expect(find({ budget: 25, now: () => (clock += 10) })).toBe(TWO);
		clock = 0;
		expect(find({ budget: 15, now: () => (clock += 10) })).toBeNull();
	});
});
