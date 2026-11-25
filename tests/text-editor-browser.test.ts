import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";
import { BUILT_IN_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";
import { parseColor } from "../src/shared/color";
import { writeTheme } from "../src/shared/theme";

/**
 * The File tab's editor in a real browser, over the mock engine, on a
 * TypeScript file of 10,000 lines: it opens straight in the editor, colored,
 * typing stays quick, undo and redo, Tab and Enter, search, the history kept
 * across tabs, Save, brackets, comments, and colors that follow the theme.
 * The rest is tested without a window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const LONG = Array.from({ length: 10_000 }, (_, index) => `\tconst value${index + 1} = compute(${index + 1}, "a line of the long file");`).join("\n") + "\n";
const VIEW = `document.querySelector(".cm-content").cmTile.view`;
const DOC_LENGTH = `${VIEW}.state.doc.length`;
const STATUS = `document.querySelector(".text-editor-status span").textContent`;
const UNSAVED = `document.querySelector(".file-unsaved") !== null`;
const ACTIVE = `document.activeElement?.className ?? "nothing"`;
/** The color the first "const" on screen is drawn in. */
const KEYWORD_COLOR = `(() => {
	const word = [...document.querySelectorAll(".cm-line span")].find(span => span.textContent === "const");
	return word ? getComputedStyle(word).color : "none";
})()`;
/** The outline around the editor and around its text, which CodeMirror would ring by itself. */
const EDITOR_OUTLINE = `["cm-editor", "cm-content"].map(name => getComputedStyle(document.querySelector("." + name)).outlineStyle).join(" ")`;
/** The caret is drawn and the caret's line is marked. */
const CARET_SHOWS = `(() => {
	const line = document.querySelector(".cm-activeLine");
	return document.querySelector(".cm-cursor") !== null && line !== null && getComputedStyle(line).backgroundColor !== "rgba(0, 0, 0, 0)";
})()`;
/** The caret's line is about the middle of the editor's view. */
const CARET_LINE_CENTERED = `(() => {
	const line = document.querySelector(".cm-activeLine");
	if (line === null) return false;
	const at = line.getBoundingClientRect();
	const view = ${VIEW}.scrollDOM.getBoundingClientRect();
	return Math.abs((at.top + at.bottom) / 2 - (view.top + view.bottom) / 2) <= at.height * 2;
})()`;
const RENDERED_OUTLINE = `getComputedStyle(document.querySelector(".file-viewer-rendered")).outlineStyle`;
const rgb = (color: string) => {
	const { r, g, b } = parseColor(color)!;
	return `rgb(${r}, ${g}, ${b})`;
};

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the editor in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	/** Presses Tab, a few times at most, until the element with this class name has the keyboard. */
	async function tabTo(className: string) {
		for (let step = 0; step < 40 && await page.evaluate<string>(ACTIVE) !== className; step++) await page.press("Tab");
		expect(await page.evaluate<string>(ACTIVE)).toBe(className);
	}

	/** Opens a Markdown file, which shows rendered, in a theme so the focus colors are set. */
	async function openMarkdown() {
		// The saved choice may already be dark, and saving it again changes nothing; light first puts a theme on.
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-light" } })`);
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-dark" } })`);
		await page.until(`getComputedStyle(document.documentElement).getPropertyValue("--focus") !== ""`, "the theme was put on");
		await page.evaluate(`(() => {
			const feature = ${STORE}.getState().repositories[0].worktrees[1];
			${ENGINE}.setWorktreeFile(feature.path, "notes.md", "# Notes\\n\\nA line to read.\\n");
			${STORE}.openFile(feature.id, "notes.md");
		})()`);
		await page.until(`document.querySelector(".file-viewer-rendered") !== null`, "the Markdown file showed rendered");
	}

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
		await page.evaluate(`(() => {
			const feature = ${STORE}.getState().repositories[0].worktrees[1];
			${ENGINE}.setWorktreeFile(feature.path, "src/long.ts", ${JSON.stringify(LONG)});
			${STORE}.select(feature.id);
			${STORE}.openFile(feature.id, "src/long.ts");
		})()`);
		await page.until(`${STORE}.getState().files[${STORE}.getState().selection.worktree]?.result?.outcome === "read"`, "the file was read");
		// Straight in the editor, with no Edit to click.
		await page.until(`document.querySelector(".cm-content") === document.activeElement`, "the editor took the keyboard");
		// The caret at the start of line 5,000, past its indent.
		await page.evaluate(`(() => {
			const view = ${VIEW};
			const at = view.state.doc.line(5000).from + 1;
			view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
		})()`);
	}, 30_000);

	test("opens a code file straight in the editor, colored, with no Source / Edit switch", async () => {
		expect(await page.evaluate<boolean>(`document.querySelector('[role="radiogroup"]') === null`)).toBe(true);
		await page.until(`document.querySelector(".text-editor-language").textContent === "TypeScript"`, "the status line named the language");
		// The test page starts with no theme on it, as main.tsx is not there to put one; saving one puts it on.
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-light" } })`);
		await page.until(`${KEYWORD_COLOR} === ${JSON.stringify(rgb(DEFAULT_LIGHT_THEME.terminal.magenta))}`, "keywords were drawn in the theme's magenta");
		// Strings in green, from the same palette.
		const stringColor = await page.evaluate<string>(`(() => {
			const text = [...document.querySelectorAll(".cm-line span")].find(span => span.textContent === '"a line of the long file"');
			return text ? getComputedStyle(text).color : "none";
		})()`);
		expect(stringColor).toBe(rgb(DEFAULT_LIGHT_THEME.terminal.green));
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-dark" } })`);
	}, 30_000);

	test("colors PHP's $this and self as keywords, class and namespace names as types, and parameters as definitions, in either theme", async () => {
		const php = "<?php\nnamespace App\\Models;\n\nclass User extends Model implements HasName\n{\n    public function greet(string $who): string\n    {\n        return self::format($this->name, $who);\n    }\n}\n";
		await page.evaluate(`(() => {
			const feature = ${STORE}.getState().repositories[0].worktrees[1];
			${ENGINE}.setWorktreeFile(feature.path, "src/User.php", ${JSON.stringify(php)});
			${STORE}.openFile(feature.id, "src/User.php");
		})()`);
		await page.until(`document.querySelector(".text-editor-language")?.textContent === "PHP"`, "the status line named PHP");
		/** The color of the innermost piece of the line drawn with exactly this text. */
		const colorOf = (text: string, nth = 0) => `(() => {
			const pieces = [...document.querySelectorAll(".cm-line span")].filter(span => span.textContent === ${JSON.stringify(text)} && span.children.length === 0);
			return pieces[${nth}] ? getComputedStyle(pieces[${nth}]).color : "none";
		})()`;
		for (const theme of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
			await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: ${JSON.stringify(theme.id)} } })`);
			const { magenta, yellow, red, foreground } = theme.terminal;
			await page.until(`${colorOf("$this")} === ${JSON.stringify(rgb(magenta))}`, `$this took ${theme.name}'s keyword color`);
			expect({
				self: await page.evaluate<string>(colorOf("self")),
				App: await page.evaluate<string>(colorOf("App")),
				Models: await page.evaluate<string>(colorOf("Models")),
				Model: await page.evaluate<string>(colorOf("Model")),
				HasName: await page.evaluate<string>(colorOf("HasName")),
				parameter: await page.evaluate<string>(colorOf("$who", 0)),
				use: await page.evaluate<string>(colorOf("$who", 1)),
			}).toEqual({ self: rgb(magenta), App: rgb(yellow), Models: rgb(yellow), Model: rgb(yellow), HasName: rgb(yellow), parameter: rgb(red), use: rgb(foreground) });
		}
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-dark" } })`);
	}, 30_000);

	test("changing the theme, to a built-in one or a custom one, recolors the open file", async () => {
		await page.until(`${KEYWORD_COLOR} !== "none"`, "the file was colored");
		const nord = BUILT_IN_THEMES.find(theme => theme.id === "nord")!;
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "nord" } })`);
		await page.until(`${KEYWORD_COLOR} === ${JSON.stringify(rgb(nord.terminal.magenta))}`, "keywords took Nord's magenta");
		const custom = writeTheme({ ...DEFAULT_DARK_THEME, id: "custom-loud", name: "Loud", terminal: { ...DEFAULT_DARK_THEME.terminal, magenta: "#ff0000" } });
		await page.evaluate(`${STORE}.savePreferences({ customThemes: [${JSON.stringify(custom)}], theme: { mode: "fixed", theme: "custom-loud" } })`);
		await page.until(`${KEYWORD_COLOR} === "rgb(255, 0, 0)"`, "keywords took the custom theme's magenta");
		await page.evaluate(`${STORE}.savePreferences({ customThemes: [], theme: { mode: "fixed", theme: "timber-dark" } })`);
	}, 30_000);

	test("marks the matching bracket, closes brackets and quotes, and Ctrl+/ toggles a line comment", async () => {
		// The caret just before "(" in "compute(5000, ...)".
		await page.evaluate(`(() => {
			const view = ${VIEW};
			const line = view.state.doc.line(5000);
			view.dispatch({ selection: { anchor: line.from + line.text.indexOf("(") } });
		})()`);
		await page.until(`document.querySelectorAll(".cm-matchingBracket").length === 2`, "both brackets were marked");

		await page.evaluate(`(() => {
			const view = ${VIEW};
			view.dispatch({ selection: { anchor: view.state.doc.line(5000).to } });
		})()`);
		await page.type("(");
		await page.until(`${VIEW}.state.doc.line(5000).text.endsWith(";()")`, "the bracket was closed");
		await page.type('"');
		await page.until(`${VIEW}.state.doc.line(5000).text.endsWith(';("")')`, "the quote was closed");

		await page.press("/", "ctrl");
		await page.until(`${VIEW}.state.doc.line(5000).text.startsWith("\t// const value5000")`, "Ctrl+/ commented the line");
		await page.press("/", "ctrl");
		await page.until(`${VIEW}.state.doc.line(5000).text.startsWith("\tconst value5000")`, "Ctrl+/ took the comment away");
	}, 30_000);

	test("Read again after the file changed on disk shows the new text, so a save never writes the old one back", async () => {
		await page.evaluate(`${ENGINE}.setWorktreeFile(${STORE}.getState().repositories[0].worktrees[1].path, "src/long.ts", "const fresh = 1;\\n")`);
		await page.evaluate(`${STORE}.readFileAgain(${STORE}.getState().selection.worktree)`);
		await page.until(`${VIEW}.state.doc.toString() === "const fresh = 1;\\n"`, "the editor showed the new text");
		await page.type("x");
		await page.press("S", "ctrl");
		await page.until(`!(${UNSAVED})`, "the file was saved");
		const saved = await page.evaluate<string>(`${ENGINE}.readWorktreeFileNow(${STORE}.getState().repositories[0].worktrees[1].path, "src/long.ts")`);
		expect(saved.length).toBe("const fresh = 1;\n".length + 1);
	}, 30_000);

	/** Opens a file of the worktree at a place, as a terminal link with a line does. */
	async function openAt(path: string, at: string) {
		await page.evaluate(`(() => {
			const feature = ${STORE}.getState().repositories[0].worktrees[1];
			${STORE}.openFile(feature.id, ${JSON.stringify(path)}, ${at});
		})()`);
	}

	test("a link's line and column put the caret there, its line in the middle of the view, with the keyboard in the text", async () => {
		// A theme on, so the caret's line is marked in a color; light first, as the saved choice may already be dark.
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-light" } })`);
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-dark" } })`);
		await page.evaluate(`${STORE}.showTab("workspace")`);
		await openAt("src/long.ts", "{ line: 8000, column: 4 }");
		await page.until(`${STATUS} === "Ln 8,000, Col 4"`, "the caret went to line 8,000, column 4");
		await page.until(CARET_LINE_CENTERED, "the caret's line was in the middle of the view");
		expect(await page.evaluate<string>(ACTIVE)).toBe("cm-content");
		expect(await page.evaluate<boolean>(CARET_SHOWS)).toBe(true);
		expect(await page.evaluate<boolean>(`${STORE}.getState().files[${STORE}.getState().selection.worktree].goTo === null`)).toBe(true);

		// Asked again while the File tab shows, the editor that is there goes.
		await openAt("src/long.ts", "{ line: 120 }");
		await page.until(`${STATUS} === "Ln 120, Col 1"`, "the caret went to line 120");
		await page.until(CARET_LINE_CENTERED, "line 120 was in the middle of the view");
		expect(await page.evaluate<string>(ACTIVE)).toBe("cm-content");
	}, 30_000);

	test("a second link into the open file moves the caret and keeps unsaved edits", async () => {
		await page.type("abc");
		await page.until(UNSAVED, "the file showed as unsaved");
		await page.evaluate(`${STORE}.showTab("workspace")`);
		await openAt("src/long.ts", "{ line: 20, column: 2 }");
		await page.until(`${STATUS} === "Ln 20, Col 2"`, "the caret went to line 20, column 2");
		expect(await page.evaluate<boolean>(`${STORE}.getState().dialog === null`)).toBe(true);
		expect(await page.evaluate<boolean>(UNSAVED)).toBe(true);
		expect(await page.evaluate<number>(DOC_LENGTH)).toBe(LONG.length + 3);
		// The undo history came along too.
		await page.press("Z", "ctrl");
		await page.until(`${DOC_LENGTH} === ${LONG.length}`, "undo took the typing away");
	}, 30_000);

	test("a line past the end goes to the last line, and a column past a line's end to its end", async () => {
		await page.evaluate(`${STORE}.showTab("workspace")`);
		await openAt("src/long.ts", "{ line: 99999, column: 7 }");
		await page.until(`${STATUS} === "Ln 10,001, Col 1"`, "the caret went to the last line");
		await openAt("src/long.ts", "{ line: 3, column: 999 }");
		const end = LONG.split("\n")[2]!.length + 1;
		await page.until(`${STATUS} === "Ln 3, Col ${end}"`, "the caret went to the end of line 3");
	}, 30_000);

	test("Markdown with a line opens in Source, read-only, at that line", async () => {
		const notes = Array.from({ length: 200 }, (_, index) => `Line ${index + 1} of the notes.`).join("\n") + "\n";
		await page.evaluate(`(() => {
			const feature = ${STORE}.getState().repositories[0].worktrees[1];
			${ENGINE}.setWorktreeFile(feature.path, "docs/design.md", ${JSON.stringify(notes)});
		})()`);
		await openAt("docs/design.md", "{ line: 120 }");
		await page.until(`${STATUS} === "Ln 120, Col 1"`, "the caret went to line 120 of the source");
		expect(await page.evaluate<string>(`document.querySelector(".file-viewer .mode-option.selected")?.textContent ?? "none"`)).toBe("Source");
		expect(await page.evaluate<string>(`document.querySelector(".text-editor-hint").textContent`)).toStartWith("Read-only.");
		expect(await page.evaluate<string>(ACTIVE)).toBe("cm-content");
		await page.until(CARET_LINE_CENTERED, "line 120 was in the middle of the view");
	}, 30_000);

	test("types quickly in a colored file of 10,000 lines, and the file turns unsaved", async () => {
		await page.until(`${KEYWORD_COLOR} !== "none" && document.querySelector(".text-editor-language").textContent === "TypeScript"`, "the file was colored");
		expect(await page.evaluate<string>(`document.querySelector(".text-editor-status").textContent`)).toContain("10,001 lines");
		const keystrokes = 100;
		const started = performance.now();
		for (let index = 0; index < keystrokes; index++) await page.type("x");
		const perKeystroke = (performance.now() - started) / keystrokes;
		// Each keystroke here also waits on the browser's answer; a plain text box took about 450 ms.
		expect(perKeystroke).toBeLessThan(50);
		await page.until(UNSAVED, "the file showed as unsaved");
		expect(await page.evaluate<string>(STATUS)).toBe("Ln 5,000, Col 102");
		expect(await page.evaluate<number>(DOC_LENGTH)).toBe(LONG.length + keystrokes);
	}, 60_000);

	test("undoes and redoes, and undoing everything leaves nothing unsaved", async () => {
		await page.type("abc");
		await page.until(UNSAVED, "the file showed as unsaved");
		await page.press("Z", "ctrl");
		await page.until(`${DOC_LENGTH} === ${LONG.length}`, "undo took the typing away");
		await page.until(`!(${UNSAVED})`, "nothing showed as unsaved");
		await page.press("Z", "ctrlShift");
		await page.until(`${DOC_LENGTH} === ${LONG.length + 3}`, "Ctrl+Shift+Z did it again");
		await page.press("Z", "ctrl");
		await page.press("Y", "ctrl");
		await page.until(`${DOC_LENGTH} === ${LONG.length + 3}`, "Ctrl+Y did it again");
	}, 30_000);

	test("Tab indents the line as the file does, and Enter keeps the indent", async () => {
		await page.press("Tab");
		await page.until(`${VIEW}.state.doc.line(5000).text.startsWith("\\t\\tconst value5000")`, "Tab indented the line with a tab");
		await page.press("Enter");
		await page.until(`${VIEW}.state.doc.line(5001).text === "\\t\\tconst value5000 = compute(5000, \\"a line of the long file\\");"`, "the new line kept the indent");
	}, 30_000);

	test("Ctrl+F searches from a bar above the text, and Escape goes back to the text", async () => {
		await page.press("F", "ctrl");
		await page.until(`document.activeElement?.classList.contains("text-editor-find-field") === true`, "the search field took the keyboard");
		// Above the text, not below it.
		expect(await page.evaluate<boolean>(`document.querySelector(".cm-panels-top .text-editor-find") !== null`)).toBe(true);
		await page.type("value9999 ");
		await page.until(`document.querySelector(".text-editor-find-count").textContent === "1 match"`, "the match was counted");
		await page.press("Enter");
		await page.until(`document.querySelector(".text-editor-find-count").textContent === "1 of 1"`, "Enter went to the match");
		expect(await page.evaluate<string>(STATUS)).toBe("Ln 9,999, Col 18");
		expect(await page.evaluate<number>(`document.querySelectorAll(".cm-searchMatch-selected").length`)).toBe(1);
		await page.press("Escape");
		await page.until(`document.querySelector(".text-editor-find") === null`, "Escape closed the bar");
		expect(await page.evaluate<string>(ACTIVE)).toBe("cm-content");
	}, 30_000);

	test("keeps the edits and the undo history while another tab shows, and Ctrl+S saves only that file", async () => {
		await page.type("abc");
		await page.evaluate(`${STORE}.showTab("workspace")`);
		await page.until(`document.querySelector(".cm-content") === null`, "the editor went");
		await page.evaluate(`${STORE}.showTab("file")`);
		await page.until(`document.querySelector(".cm-content") === document.activeElement`, "the editor came back with the keyboard");
		expect(await page.evaluate<number>(DOC_LENGTH)).toBe(LONG.length + 3);
		expect(await page.evaluate<string>(STATUS)).toBe("Ln 5,000, Col 5");
		await page.press("Z", "ctrl");
		await page.until(`${DOC_LENGTH} === ${LONG.length}`, "undo still worked after the tab came back");
		await page.press("Z", "ctrlShift");
		await page.press("S", "ctrl");
		await page.until(`!(${UNSAVED})`, "the file was saved");
		const saved = await page.evaluate<string>(`${ENGINE}.readWorktreeFileNow(${STORE}.getState().repositories[0].worktrees[1].path, "src/long.ts")`);
		expect(saved.length).toBe(LONG.length + 3);
		expect(saved.split("\n")[4999]).toBe("\tabcconst value5000 = compute(5000, \"a line of the long file\");");
	}, 30_000);

	test("Ctrl+F with the bar open goes back to the field, and Ctrl+S saves from the field", async () => {
		await page.type("abc");
		await page.press("F", "ctrl");
		await page.until(`document.activeElement?.classList.contains("text-editor-find-field") === true`, "the search field took the keyboard");
		await page.evaluate(`document.querySelector(".cm-content").focus()`);
		await page.press("F", "ctrl");
		await page.until(`document.activeElement?.classList.contains("text-editor-find-field") === true`, "Ctrl+F gave the field the keyboard again");
		await page.press("S", "ctrl");
		await page.until(`!(${UNSAVED})`, "Ctrl+S in the field saved the file");
	}, 30_000);

	test("the first edit after a save reaches the store at once, so quitting knows", async () => {
		await page.type("a");
		await page.press("S", "ctrl");
		await page.until(`!(${UNSAVED})`, "the file was saved");
		await page.type("b");
		expect(await page.evaluate<number>(`window.timberTestEngine.unsavedFilesReported()`)).toBe(1);
	}, 30_000);

	test("a search bar left open comes back with the editor and leaves the keyboard in the text", async () => {
		await page.press("F", "ctrl");
		await page.until(`document.activeElement?.classList.contains("text-editor-find-field") === true`, "the search field took the keyboard");
		await page.evaluate(`${STORE}.showTab("workspace")`);
		await page.until(`document.querySelector(".cm-content") === null`, "the editor went");
		await page.evaluate(`${STORE}.showTab("file")`);
		await page.until(`document.querySelector(".text-editor-find-field") !== null`, "the bar came back");
		await Bun.sleep(100);
		expect(await page.evaluate<string>(ACTIVE)).toBe("cm-content");
	}, 30_000);

	test("Ctrl+Shift+K never deletes a line, with the chops panel or a dialog in the way", async () => {
		await page.press("K", "ctrlShift");
		await Bun.sleep(100);
		expect(await page.evaluate<number>(DOC_LENGTH)).toBe(LONG.length);
	}, 30_000);

		test("the window's own keys still work from the editor: Ctrl+Shift+P opens the palette", async () => {
		await page.press("P", "ctrlShift");
		await page.until(`${STORE}.getState().dialog?.kind === "palette"`, "the palette opened");
	}, 30_000);

	test("draws no outline around the editor, clicked or tabbed into, in either theme; the caret and its line show where typing goes", async () => {
		for (const theme of ["timber-light", "timber-dark"]) {
			await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "${theme}" } })`);
			await page.click(".cm-content");
			await page.until(`document.querySelector(".cm-editor").classList.contains("cm-focused")`, "the click gave the editor the keyboard");
			expect(await page.evaluate<string>(EDITOR_OUTLINE)).toBe("none none");
			expect(await page.evaluate<boolean>(CARET_SHOWS)).toBe(true);
			// Back to the title line, then Tab until the text has the keyboard again.
			await page.click(".file-viewer-title button");
			await tabTo("cm-content");
			await page.until(`document.querySelector(".cm-editor").classList.contains("cm-focused")`, "Tab gave the editor the keyboard");
			expect(await page.evaluate<string>(EDITOR_OUTLINE)).toBe("none none");
			expect(await page.evaluate<boolean>(CARET_SHOWS)).toBe(true);
		}
	}, 30_000);

	test("Markdown's read-only Source draws no outline either, and marks the caret's line", async () => {
		await openMarkdown();
		await page.evaluate(`${STORE}.showFileAs(${STORE}.getState().selection.worktree, "source")`);
		await page.until(`document.querySelector(".cm-content") !== null`, "Source showed the editor");
		await page.click(".cm-content");
		await page.until(`document.querySelector(".cm-editor").classList.contains("cm-focused")`, "the click gave Source the keyboard");
		expect(await page.evaluate<string>(EDITOR_OUTLINE)).toBe("none none");
		expect(await page.evaluate<boolean>(CARET_SHOWS)).toBe(true);
	}, 30_000);

	test("rendered Markdown shows a focus outline when tabbed to, and none when clicked", async () => {
		await openMarkdown();
		await page.click(".file-viewer-rendered");
		expect(await page.evaluate<string>(ACTIVE)).toBe("file-viewer-body file-viewer-rendered");
		expect(await page.evaluate<string>(RENDERED_OUTLINE)).toBe("none");
		await page.click(".file-viewer-title button");
		await tabTo("file-viewer-body file-viewer-rendered");
		expect(await page.evaluate<boolean>(`document.activeElement.matches(":focus-visible")`)).toBe(true);
		expect(await page.evaluate<string>(RENDERED_OUTLINE)).toBe("solid");
	}, 30_000);
});
