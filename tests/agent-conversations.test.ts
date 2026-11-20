import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claudeConfigFolder, claudeConversationExists, codexConversationExists, codexHomeFolder, findCodexConversation,
} from "../src/bun/agent-conversations";

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
	const find = (extra: Partial<Parameters<typeof findCodexConversation>[0]> = {}) => findCodexConversation({ homeFolder: root, cwd: "/w/feat", since, taken: new Set(), ...extra });

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
		expect(findCodexConversation({ homeFolder: root, cwd: "/w/feat", since: late, taken: new Set() })).toBe(TWO);
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
