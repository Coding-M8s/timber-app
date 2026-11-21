import { describe, expect, test } from "bun:test";
import { agentStartArguments, conversationMissingNote, resumableAgent } from "../src/shared/agent-resume";

const ID = "01a17995-a303-7160-8d6d-d7587e0d5d50";

describe("which agents can go back to their conversation", () => {
	test("Claude Code and Codex by their executable's name, wherever they are", () => {
		expect(resumableAgent("claude", [])).toBe("claude");
		expect(resumableAgent("/usr/local/bin/codex", ["--model", "o4"])).toBe("codex");
		expect(resumableAgent("C:\\tools\\claude.exe", [])).toBe("claude");
		expect(resumableAgent("C:\\tools\\CODEX.EXE", [])).toBe("codex");
	});

	test("any other program is not one", () => {
		for (const executable of ["aider", "claude-wrapper", "mycodex", "/bin/sh", "", "claude.sh"]) expect(resumableAgent(executable, [])).toBeNull();
	});

	test("a command that already picks a conversation is started as typed", () => {
		for (const args of [["-c"], ["--continue"], ["--resume", "x"], ["-r"], ["--session-id", "x"], ["--session-id=x"], ["--resume=x"], ["-p"], ["--print", "hi"], ["--from-pr", "1"], ["--teleport"]]) {
			expect(resumableAgent("claude", args)).toBeNull();
		}
		for (const args of [["exec", "hi"], ["e"], ["resume", "--last"], ["fork"], ["review"]]) expect(resumableAgent("codex", args)).toBeNull();
	});

	test("only whole words count", () => {
		expect(resumableAgent("claude", ["--continue-on-error"])).toBe("claude");
		expect(resumableAgent("claude", ["--model", "opus", "--resume-later"])).toBe("claude");
		expect(resumableAgent("codex", ["--resume"])).toBe("codex");
	});

	test("a group of short options that picks a conversation counts too", () => {
		for (const args of [["-cp"], ["-pc"], ["--model", "opus", "-rp"], ["-dc"]]) expect(resumableAgent("claude", args)).toBeNull();
		expect(resumableAgent("codex", ["-hV"])).toBeNull();
		// Codex's -c is --config, which picks nothing.
		expect(resumableAgent("codex", ["-c", "model=o3"])).toBe("codex");
	});

	test("a subcommand, a prompt, or -- starts as typed", () => {
		for (const args of [["mcp", "list"], ["fix it"], ["--", "fix it"], ["--model", "opus", "--", "fix it"]]) expect(resumableAgent("claude", args)).toBeNull();
		for (const args of [["fix the bug"], ["mcp", "list"], ["--model", "o3", "--", "fix it"]]) expect(resumableAgent("codex", args)).toBeNull();
	});

	test("an option with = that picks a conversation counts", () => {
		expect(resumableAgent("claude", ["--from-pr=12"])).toBeNull();
		expect(resumableAgent("claude", ["--model=opus"])).toBe("claude");
	});
});

describe("the arguments an agent starts with", () => {
	test("Claude Code resumes with --resume and starts fresh with an id of the app's choosing", () => {
		expect(agentStartArguments("claude", ["--model", "opus"], { resume: ID })).toEqual(["--resume", ID, "--model", "opus"]);
		expect(agentStartArguments("claude", ["--model", "opus"], { fresh: ID })).toEqual(["--session-id", ID, "--model", "opus"]);
		expect(agentStartArguments("claude", ["--model", "opus"], null)).toEqual(["--model", "opus"]);
	});

	test("Codex resumes with its subcommand and starts plain otherwise", () => {
		expect(agentStartArguments("codex", ["--model", "o4"], { resume: ID })).toEqual(["resume", ID, "--model", "o4"]);
		// Before an option that takes several values, which would read the id as one of them.
		expect(agentStartArguments("codex", ["-i", "shot.png"], { resume: ID })).toEqual(["resume", ID, "-i", "shot.png"]);
		expect(agentStartArguments("codex", ["--model", "o4"], { fresh: ID })).toEqual(["--model", "o4"]);
		expect(agentStartArguments("codex", ["--model", "o4"], null)).toEqual(["--model", "o4"]);
	});

	test("any other agent keeps its arguments", () => {
		for (const conversation of [{ resume: ID }, { fresh: ID }, null]) expect(agentStartArguments(null, ["--yes"], conversation)).toEqual(["--yes"]);
	});

	test("the arguments given are not changed", () => {
		const args = ["--model", "opus"];
		agentStartArguments("claude", args, { fresh: ID });
		expect(args).toEqual(["--model", "opus"]);
	});

	test("the note for a conversation that is gone", () => {
		const note = conversationMissingNote("Codex");
		expect(note).toContain("The saved conversation was not found, so Codex started fresh.");
		expect(note.endsWith("\r\n")).toBe(true);
		expect(note).not.toContain(String.fromCharCode(0x2014));
	});
});
