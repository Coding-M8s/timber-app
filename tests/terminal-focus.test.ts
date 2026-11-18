import { describe, expect, test } from "bun:test";
import { dropTerminalFocus, onTerminalFocusWish, takeTerminalFocus, wantTerminalFocus } from "../src/mainview/terminal-focus";

describe("asking for the keyboard in a worktree's terminal", () => {
	test("only that worktree's terminal takes it, and only once", () => {
		wantTerminalFocus("a");
		expect(takeTerminalFocus("b")).toBe(false);
		expect(takeTerminalFocus("a")).toBe(true);
		expect(takeTerminalFocus("a")).toBe(false);
	});

	test("a newer wish replaces an older one", () => {
		wantTerminalFocus("a");
		wantTerminalFocus("b");
		expect(takeTerminalFocus("a")).toBe(false);
		expect(takeTerminalFocus("b")).toBe(true);
	});

	test("a worktree with nothing to show drops its own wish, never another's", () => {
		wantTerminalFocus("a");
		dropTerminalFocus("b");
		dropTerminalFocus("a");
		expect(takeTerminalFocus("a")).toBe(false);
	});

	test("a terminal already on screen hears a wish as it is made", () => {
		const heard: string[] = [];
		const stop = onTerminalFocusWish(() => {
			if (takeTerminalFocus("a")) heard.push("a");
		});
		wantTerminalFocus("a");
		stop();
		wantTerminalFocus("a");
		expect(heard).toEqual(["a"]);
		dropTerminalFocus("a");
	});
});
