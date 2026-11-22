import { describe, expect, test } from "bun:test";
import { startPseudoTerminal, startBunTerminal, createStartupQuery, exitCodeOf } from "../src/bun/pseudo-terminal";

describe("createStartupQuery", () => {
	test("the first CSI c at the start is taken out and asks for the answer; the rest passes on", () => {
		const startup = createStartupQuery();
		expect(startup.take("\x1b[1t")).toEqual({ text: "", answer: false });
		expect(startup.take("\x1b[c\x1b[?1004h\x1b[?9001h")).toEqual({ text: "\x1b[1t\x1b[?1004h\x1b[?9001h", answer: true });
		// A later query is the program's, and the window answers it.
		expect(startup.take("hello\x1b[c")).toEqual({ text: "hello\x1b[c", answer: false });
		expect(startup.flush()).toBe("");
	});

	test("a query split across parts is still found", () => {
		const startup = createStartupQuery();
		expect(startup.take("\x1b[1t\x1b[")).toEqual({ text: "", answer: false });
		expect(startup.take("cafter")).toEqual({ text: "\x1b[1tafter", answer: true });
	});

	test("without a query in the first 256 code units, nothing is held back or taken out", () => {
		const startup = createStartupQuery();
		const long = "x".repeat(256);
		expect(startup.take(long)).toEqual({ text: long, answer: false });
		expect(startup.take("\x1b[c")).toEqual({ text: "\x1b[c", answer: false });
	});

	test("flush gives what was held back, once, and then everything passes on", () => {
		const startup = createStartupQuery();
		expect(startup.take("\x1b[1t")).toEqual({ text: "", answer: false });
		expect(startup.flush()).toBe("\x1b[1t");
		expect(startup.flush()).toBe("");
		expect(startup.take("\x1b[c")).toEqual({ text: "\x1b[c", answer: false });
	});
});

describe("startPseudoTerminal", () => {
	const fakePty = {} as typeof import("node-pty");

	test("Linux and macOS use Bun.Terminal, and never load node-pty", () => {
		let loaded = false;
		const load = () => {
			loaded = true;
			return fakePty;
		};
		expect(startPseudoTerminal("linux", load)).toBe(startBunTerminal);
		expect(startPseudoTerminal("darwin", load)).toBe(startBunTerminal);
		expect(loaded).toBe(false);
	});

	test("Windows uses node-pty where it loads, and Bun.Terminal, where there is one, where it does not", () => {
		const withPty = startPseudoTerminal("win32", () => fakePty);
		expect(withPty).not.toBeNull();
		expect(withPty).not.toBe(startBunTerminal);
		expect(startPseudoTerminal("win32", () => null)).toBe(typeof Bun.Terminal === "function" ? startBunTerminal : null);
	});
});

describe("exitCodeOf, for node-pty's exit", () => {
	test("the code node-pty told is taken as it is", async () => {
		expect(await exitCodeOf({ _agent: { exitCode: 9 } }, 3)).toBe(3);
		expect(await exitCodeOf({}, 0)).toBe(0);
	});

	test("a code that was not there yet when the exit was told is read from the agent once it comes", async () => {
		const agent: { exitCode?: number } = {};
		setTimeout(() => (agent.exitCode = 3), 50);
		expect(await exitCodeOf({ _agent: agent }, undefined)).toBe(3);
	});

	test("a code that never comes is unknown, after the wait", async () => {
		const started = Date.now();
		expect(await exitCodeOf({ _agent: {} }, undefined, 100)).toBeNull();
		expect(Date.now() - started).toBeGreaterThanOrEqual(100);
		expect(await exitCodeOf({}, undefined)).toBeNull();
	});
});
