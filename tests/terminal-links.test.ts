import { describe, expect, test } from "bun:test";
import { terminalLinks } from "../src/mainview/terminal-links";

const press = (modifiers: Partial<Record<"ctrlKey" | "metaKey", boolean>> = {}) => ({ ctrlKey: false, metaKey: false, ...modifiers });

/** The links of one terminal, with a stand-in opener that records every link it is asked to open. */
function links(mac = false) {
	const opened: string[] = [];
	return { opened, links: terminalLinks(url => opened.push(url), mac) };
}

describe("terminal links", () => {
	// xterm activates the one link under the pointer: the WebLinksAddon's for a plain URL, the linkHandler's for an OSC 8 link.
	test("Ctrl+click on a plain-text URL opens it once", () => {
		const { opened, links: terminal } = links();
		terminal.hover();
		terminal.activate(press({ ctrlKey: true }), "https://plain.example/a");
		expect(opened).toEqual(["https://plain.example/a"]);
	});

	test("Ctrl+click on an OSC 8 link whose text is the URL opens it once", () => {
		const { opened, links: terminal } = links();
		terminal.hover();
		terminal.activate(press({ ctrlKey: true }), "https://same.example/b");
		expect(opened).toEqual(["https://same.example/b"]);
	});

	test("Ctrl+click on an OSC 8 link with other text opens its target once", () => {
		const { opened, links: terminal } = links();
		terminal.hover();
		terminal.activate(press({ ctrlKey: true }), "https://target.example/c");
		expect(opened).toEqual(["https://target.example/c"]);
	});

	test("Cmd+click opens a link on macOS, and Ctrl+click does not", () => {
		const { opened, links: terminal } = links(true);
		terminal.hover();
		terminal.activate(press({ ctrlKey: true }), "https://example.com/ctrl");
		terminal.activate(press({ metaKey: true }), "https://example.com/cmd");
		expect(opened).toEqual(["https://example.com/cmd"]);
	});

	test("a plain click opens nothing", () => {
		const { opened, links: terminal } = links();
		terminal.hover();
		terminal.activate(press(), "https://example.com/");
		expect(opened).toEqual([]);
	});

	// A program that tracks the mouse, such as Claude Code in fullscreen, opens a clicked link itself.
	// Told of the press too, it would open the link a second time.
	test("a program that tracks the mouse is not told of a Ctrl+click on a link", () => {
		const { links: terminal } = links();
		terminal.hover();
		expect(terminal.keepsFromProgram(press({ ctrlKey: true }), true)).toBe(true);
	});

	test("the program still hears every other press", () => {
		const { links: terminal } = links();
		// Away from a link.
		expect(terminal.keepsFromProgram(press({ ctrlKey: true }), true)).toBe(false);
		terminal.hover();
		// A plain click on a link.
		expect(terminal.keepsFromProgram(press(), true)).toBe(false);
		// The pointer has left the link.
		terminal.leave();
		expect(terminal.keepsFromProgram(press({ ctrlKey: true }), true)).toBe(false);
	});

	test("a program that does not track the mouse hears nothing to keep from it", () => {
		const { links: terminal } = links();
		terminal.hover();
		expect(terminal.keepsFromProgram(press({ ctrlKey: true }), false)).toBe(false);
	});

	test("on macOS it is Cmd+click on a link that the program is not told of", () => {
		const { links: terminal } = links(true);
		terminal.hover();
		expect(terminal.keepsFromProgram(press({ metaKey: true }), true)).toBe(true);
		expect(terminal.keepsFromProgram(press({ ctrlKey: true }), true)).toBe(false);
	});
});
