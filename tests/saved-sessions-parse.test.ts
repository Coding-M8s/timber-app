import { describe, expect, test } from "bun:test";
import {
	type LiveSession, type SavedSessions, SAVED_SESSIONS_PER_WORKTREE, SAVED_WORKTREE_LIMIT, buildSavedSessions, isConversationId, parseSavedSessions,
	serializeSavedSessions,
} from "../src/shared/saved-sessions";

const claude = { kind: "agent", agent: "Claude Code", conversation: "0b6f1c1e-7a52-4f0e-9d53-2f1f6f0c7a11" } as const;

describe("the saved sessions file", () => {
	test("what is written is read back the same", () => {
		const saved: SavedSessions = { selected: "w1", worktrees: { w1: { shown: 1, sessions: [{ kind: "terminal" }, claude, { kind: "terminal", name: "dev server" }] }, w2: { shown: 0, sessions: [{ kind: "agent", agent: "Aider" }] } } };
		const text = serializeSavedSessions(saved);
		expect(JSON.parse(text).version).toBe(1);
		expect(text.endsWith("\n")).toBe(true);
		expect(parseSavedSessions(text)).toEqual({ ok: true, saved });
	});

	test("a file of another format is damaged, a newer one is refused", () => {
		for (const text of ["", "{", "[]", "null", "{\"version\":0,\"worktrees\":{}}", "{\"version\":1,\"worktrees\":[]}", "{\"version\":\"1\",\"worktrees\":{}}", "{\"version\":1.5,\"worktrees\":{}}", "{\"version\":1}"]) {
			expect(parseSavedSessions(text)).toEqual({ ok: false, reason: "damaged" });
		}
		expect(parseSavedSessions("{\"version\":2,\"worktrees\":{}}")).toEqual({ ok: false, reason: "newer" });
	});

	test("what cannot be trusted is dropped piece by piece", () => {
		const read = parseSavedSessions(JSON.stringify({ version: 1, selected: 7, worktrees: {
			a: { shown: 9, sessions: [{ kind: "timber" }, { kind: "agent" }, { kind: "agent", agent: "" }, { kind: "agent", agent: " x " }, 7, { kind: "terminal", name: " \n " }, { ...claude, conversation: "--dangerously-skip-permissions" }] },
			b: { shown: 0, sessions: [] }, c: 3, d: { shown: -1, sessions: [{ kind: "terminal", name: "y".repeat(50), cwd: "/etc" }] },
			e: { sessions: "x" }, f: [],
		} }));
		expect(read).toEqual({ ok: true, saved: { worktrees: {
			a: { shown: 0, sessions: [{ kind: "terminal" }, { kind: "agent", agent: "Claude Code" }] },
			d: { shown: 0, sessions: [{ kind: "terminal", name: "y".repeat(40) }] },
		} } });
	});

	test("the shown chip follows its session when sessions before it are dropped", () => {
		const read = parseSavedSessions(JSON.stringify({ version: 1, worktrees: { a: { shown: 2, sessions: [{ kind: "timber" }, { kind: "terminal" }, claude] } } }));
		expect(read).toEqual({ ok: true, saved: { worktrees: { a: { shown: 1, sessions: [{ kind: "terminal" }, claude] } } } });
		const fractional = parseSavedSessions(JSON.stringify({ version: 1, worktrees: { a: { shown: 0.5, sessions: [{ kind: "terminal" }, claude] } } }));
		expect(fractional.ok && fractional.saved.worktrees.a!.shown).toBe(0);
	});

	test("a selected worktree is kept when it is text, with or without sessions", () => {
		expect(parseSavedSessions(JSON.stringify({ version: 1, selected: "w9", worktrees: {} }))).toEqual({ ok: true, saved: { selected: "w9", worktrees: {} } });
	});

	test("counts are capped", () => {
		const sessions = Array.from({ length: 80 }, () => ({ kind: "terminal" }));
		const worktrees = Object.fromEntries(Array.from({ length: 300 }, (_, at) => [`w${at}`, { shown: 60, sessions }]));
		const read = parseSavedSessions(JSON.stringify({ version: 1, worktrees }));
		if (!read.ok) throw new Error("not read");
		expect(Object.keys(read.saved.worktrees)).toHaveLength(SAVED_WORKTREE_LIMIT);
		expect(read.saved.worktrees.w0).toEqual({ shown: SAVED_SESSIONS_PER_WORKTREE - 1, sessions: sessions.slice(0, SAVED_SESSIONS_PER_WORKTREE) as SavedSessions["worktrees"][string]["sessions"] });
	});

	test("only a UUID is a conversation id", () => {
		expect(isConversationId("01a17995-a303-7160-8d6d-d7587e0d5d50")).toBe(true);
		expect(isConversationId("0B6F1C1E-7A52-4F0E-9D53-2F1F6F0C7A11")).toBe(true);
		for (const value of ["", "--resume", "01a17995a3037160-8d6d-d7587e0d5d50", "01a17995-a303-7160-8d6d-d7587e0d5d50 x", "01a17995-a303-7160-8d6d-d7587e0d5d50\n", 7, null]) expect(isConversationId(value)).toBe(false);
	});

	test("the running sessions become the smallest file that restores them", () => {
		const live: LiveSession[] = [
			{ id: "1", worktree: "w1", kind: "terminal", agent: null, conversation: null, name: null },
			{ id: "2", worktree: "w2", kind: "agent", agent: "Codex", conversation: null, name: "review" },
			{ id: "3", worktree: "w1", kind: "agent", agent: "Claude Code", conversation: claude.conversation, name: null },
		];
		expect(buildSavedSessions(live, { w1: "3", w2: "gone" }, "w9")).toEqual({ selected: "w9", worktrees: {
			w1: { shown: 1, sessions: [{ kind: "terminal" }, claude] },
			w2: { shown: 0, sessions: [{ kind: "agent", agent: "Codex", name: "review" }] },
		} });
		expect(buildSavedSessions([], {}, null)).toEqual({ worktrees: {} });
		expect(serializeSavedSessions(buildSavedSessions(live, {}, null))).not.toContain("null");
	});

	test("200 worktrees of 5 sessions serialize in under 20 ms and under 100 KB", () => {
		const live: LiveSession[] = [];
		for (let worktree = 0; worktree < 200; worktree += 1) {
			const id = `/home/someone/work/timber/.git\u0000verified\u0000/home/someone/work/timber-worktrees/feature-${worktree}`;
			live.push(
				{ id: `${worktree}-1`, worktree: id, kind: "terminal", agent: null, conversation: null, name: null },
				{ id: `${worktree}-2`, worktree: id, kind: "terminal", agent: null, conversation: null, name: "dev server" },
				{ id: `${worktree}-3`, worktree: id, kind: "agent", agent: "Claude Code", conversation: crypto.randomUUID(), name: null },
				{ id: `${worktree}-4`, worktree: id, kind: "agent", agent: "Codex", conversation: crypto.randomUUID(), name: null },
				{ id: `${worktree}-5`, worktree: id, kind: "agent", agent: "Codex", conversation: null, name: null },
			);
		}
		const started = performance.now();
		const text = serializeSavedSessions(buildSavedSessions(live, {}, live[0]!.worktree));
		const took = performance.now() - started;
		console.log(`build and serialize of 200 worktrees x 5 sessions: ${took.toFixed(2)} ms, ${text.length} bytes`);
		expect(took).toBeLessThan(20);
		expect(Buffer.byteLength(text)).toBeLessThan(100 * 1024);
		const read = parseSavedSessions(text);
		expect(read.ok && Object.keys(read.saved.worktrees)).toHaveLength(200);
	});
});
