import { describe, expect, test } from "bun:test";
import { PROMPT_BUSY_MILLISECONDS, PROMPT_QUIET_MILLISECONDS, isReadyForPrompt, promptEndedMessage, promptNotReadyMessage } from "../src/shared/agent-prompt";
import type { ProgramStatus } from "../src/shared/program-status";
import { type TerminalSession, bracketedPaste, promptBytes } from "../src/shared/terminal";
import { promptTarget } from "../src/mainview/agent-sessions";
import { chopAction, chopButtonLabel, describeChopApproval, runChopLabel } from "../src/mainview/chop-format";

const status = (state: ProgramStatus["state"]): ProgramStatus => ({ state, kind: null, progress: null, app: null, title: null, message: null });

describe("when a new agent is ready for its prompt", () => {
	test("an agent that probed gets it only once it says it is idle, never while blocked or working", () => {
		const probed = { probed: true, pasteOn: true, quietMilliseconds: 10_000, pasteOnMilliseconds: 60_000 };
		expect(isReadyForPrompt({ ...probed, status: null })).toBe(false);
		expect(isReadyForPrompt({ ...probed, status: status("blocked") })).toBe(false);
		expect(isReadyForPrompt({ ...probed, status: status("working") })).toBe(false);
		expect(isReadyForPrompt({ ...probed, status: status("done") })).toBe(false);
		expect(isReadyForPrompt({ ...probed, status: status("idle") })).toBe(true);
	});

	test("an agent that probes but stays silent until its first input, as Amp does, gets it by the paste and quiet rule until it reports, then by its status", () => {
		const silent = { probed: true, silentUntilInput: true, pasteOnMilliseconds: 0 };
		expect(isReadyForPrompt({ ...silent, status: null, pasteOn: false, quietMilliseconds: 10_000 })).toBe(false);
		expect(isReadyForPrompt({ ...silent, status: null, pasteOn: true, quietMilliseconds: PROMPT_QUIET_MILLISECONDS - 1 })).toBe(false);
		expect(isReadyForPrompt({ ...silent, status: null, pasteOn: true, quietMilliseconds: PROMPT_QUIET_MILLISECONDS })).toBe(true);
		expect(isReadyForPrompt({ ...silent, status: null, pasteOn: true, quietMilliseconds: 10, pasteOnMilliseconds: PROMPT_BUSY_MILLISECONDS })).toBe(true);
		// Once it reported, its status rules: working or blocked waits however quiet, idle is ready.
		const ready = { ...silent, pasteOn: true, quietMilliseconds: 10_000, pasteOnMilliseconds: 60_000 };
		expect(isReadyForPrompt({ ...ready, status: status("working") })).toBe(false);
		expect(isReadyForPrompt({ ...ready, status: status("blocked") })).toBe(false);
		expect(isReadyForPrompt({ ...ready, status: status("idle") })).toBe(true);
		// An agent that probes and is not silent still waits for idle when it has reported nothing.
		expect(isReadyForPrompt({ ...ready, silentUntilInput: false, status: null })).toBe(false);
		expect(isReadyForPrompt({ probed: true, status: null, pasteOn: true, quietMilliseconds: 10_000, pasteOnMilliseconds: 60_000 })).toBe(false);
	});

	test("OpenCode's done, read from its idle after a turn, is ready too", () => {
		const probed = { probed: true, pasteOn: true, quietMilliseconds: 0, pasteOnMilliseconds: 0 };
		expect(isReadyForPrompt({ ...probed, status: { ...status("done"), app: "opencode" } })).toBe(true);
		expect(isReadyForPrompt({ ...probed, status: { ...status("working"), app: "opencode" } })).toBe(false);
	});

	test("an agent that never probed gets it once bracketed paste is on and it stayed quiet long enough", () => {
		const plain = { probed: false, status: null, pasteOnMilliseconds: 0 };
		expect(isReadyForPrompt({ ...plain, pasteOn: false, quietMilliseconds: 10_000 })).toBe(false);
		expect(isReadyForPrompt({ ...plain, pasteOn: true, quietMilliseconds: PROMPT_QUIET_MILLISECONDS - 1 })).toBe(false);
		expect(isReadyForPrompt({ ...plain, pasteOn: true, quietMilliseconds: PROMPT_QUIET_MILLISECONDS })).toBe(true);
		expect(isReadyForPrompt({ ...plain, pasteOn: true, quietMilliseconds: 20 }, 20)).toBe(true);
	});

	test("an agent that never probed and keeps redrawing gets it once bracketed paste was on long enough", () => {
		const busy = { probed: false, status: null, pasteOn: true, quietMilliseconds: 10 };
		expect(isReadyForPrompt({ ...busy, pasteOnMilliseconds: PROMPT_BUSY_MILLISECONDS - 1 })).toBe(false);
		expect(isReadyForPrompt({ ...busy, pasteOnMilliseconds: PROMPT_BUSY_MILLISECONDS })).toBe(true);
		// Never while bracketed paste is off, however long.
		expect(isReadyForPrompt({ ...busy, pasteOn: false, pasteOnMilliseconds: 0, quietMilliseconds: 60_000 })).toBe(false);
	});

	test("the message names the agent and the wait in seconds", () => {
		expect(promptNotReadyMessage("Codex", 120_000)).toContain("Codex was not ready for the prompt within 120 seconds");
	});

	test("for a review, the messages say it was not pasted and the notes are kept, with no chop to run again", () => {
		expect(promptNotReadyMessage("Codex", 120_000, "review")).toBe("Codex was not ready for the review within 120 seconds, so it was not pasted. The notes are kept: send the review again.");
		expect(promptEndedMessage("Codex", "review")).toBe("Codex ended before it was ready for the review, so it was not pasted. The notes are kept.");
		expect(promptEndedMessage("Codex")).toBe("Codex ended before it was ready for the prompt, so it was not sent.");
	});
});

describe("the bytes that send a prompt", () => {
	test("one bracketed paste, so line breaks do not submit early, then Enter apart", () => {
		expect(promptBytes("one\ntwo", true)).toEqual({ paste: bracketedPaste("one\ntwo"), enter: "\r" });
		expect(bracketedPaste("one\ntwo")).toBe("\x1b[200~one\rtwo\x1b[201~");
	});

	test("without bracketed paste, one line goes as typed, and text with a line break does not go at all", () => {
		expect(promptBytes("one line", false)).toEqual({ paste: "one line", enter: "\r" });
		expect(promptBytes("one\ntwo", false)).toBeNull();
	});
});

describe("where a prompt chop goes", () => {
	const session = (id: string, more: Partial<TerminalSession> = {}): TerminalSession => ({
		id, kind: "agent", name: id, repository: "/r", worktree: "w", path: "/r", shell: "/bin/x", command: "/bin/x", state: { kind: "running" }, status: null, children: [], ...more,
	});

	test("a new agent when none runs in the worktree; shells, ended agents, and other worktrees do not count", () => {
		expect(promptTarget([], "w")).toEqual({ kind: "new" });
		expect(promptTarget([session("t", { kind: "terminal" }), session("e", { state: { kind: "exited", exitCode: 0, signal: null } }), session("o", { worktree: "other" })], "w")).toEqual({ kind: "new" });
	});

	test("the only running agent, unless it waits on the person", () => {
		expect(promptTarget([session("a")], "w")).toEqual({ kind: "session", session: "a" });
		expect(promptTarget([session("a", { status: status("working") })], "w")).toEqual({ kind: "session", session: "a" });
		expect(promptTarget([session("a", { status: status("blocked") })], "w")).toMatchObject({ kind: "ask", sessions: [{ id: "a" }] });
		// Still waiting to be ready for a prompt of its own: maybe on a first-run screen.
		expect(promptTarget([session("a", { prompt: { state: "pending" } })], "w")).toMatchObject({ kind: "ask" });
		expect(promptTarget([session("a", { prompt: { state: "sent" } })], "w")).toEqual({ kind: "session", session: "a" });
	});

	test("a question when several agents run, listing them in the order they started", () => {
		expect(promptTarget([session("a"), session("b")], "w")).toMatchObject({ kind: "ask", sessions: [{ id: "a" }, { id: "b" }] });
	});
});

describe("words for prompt chops", () => {
	test("a command runs, a prompt is sent, and with no agent saved it is copied", () => {
		expect(chopAction("command", 0)).toBe("run");
		expect(chopAction("prompt", 2)).toBe("send");
		expect(chopAction("prompt", 0)).toBe("copy");
		expect(runChopLabel("Ask", "send")).toBe("Send prompt: Ask");
		expect(runChopLabel("Ask", "copy")).toBe("Copy prompt: Ask");
		expect(runChopLabel("Test")).toBe("Run chop: Test");
		expect(chopButtonLabel("Ask", "copy")).toBe("Copy Ask");
	});

	test("the approval of a repository prompt says Send and where it goes", () => {
		expect(describeChopApproval({ name: "Review", kind: "prompt" }, "/r/.timber/chops.json", "Codex")).toMatchObject({ title: "Send Review from the repository?", submit: "Send", text: expect.stringContaining("goes to Codex exactly as shown") });
		// A new agent is named, since the file picks it.
		expect(describeChopApproval({ name: "Review", kind: "prompt", agent: "Codex" }, "/r/.timber/chops.json").text).toContain("goes to a new Codex exactly as shown");
		expect(describeChopApproval({ name: "Review", kind: "prompt", agent: null }, "/r/.timber/chops.json").text).toContain("goes to a new session of the first agent found");
		expect(describeChopApproval({ name: "Review", kind: "prompt", agent: null }, "/r/.timber/chops.json", null, "Codex").text).toContain("goes to a new Codex exactly");
		expect(describeChopApproval({ name: "Review", kind: "prompt", agent: "Claude Code" }, "/r/.timber/chops.json", null, "Codex").text).toContain("goes to a new Claude Code exactly");
		expect(describeChopApproval({ name: "Test", kind: "command" }, "/r/.timber/chops.json")).toMatchObject({ title: "Run Test from the repository?", submit: "Run" });
	});
});
