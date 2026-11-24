import { describe, expect, test } from "bun:test";
import { tags } from "@lezer/highlight";
import { type CodeSpan, highlightDiff, lineSegments } from "../src/mainview/diff-highlight";
import { codeHighlightStyle } from "../src/mainview/editor-language";
import { isPhpCode } from "../src/mainview/php-language";
import type { DiffLine, DiffLineKind, DiffSection } from "../src/shared/file-changes";

/** Lines of a hunk from Git's markers, numbered as Git numbers them. */
function hunk(...texts: string[]): DiffLine[] {
	let old = 1;
	let next = 1;
	return texts.map(text => {
		const marker = text[0];
		const kind: DiffLineKind = marker === "+" ? "added" : marker === "-" ? "removed" : marker === "\\" ? "note" : "context";
		const line: DiffLine = { kind, text: text.slice(1), oldLine: kind === "added" || kind === "note" ? null : old++, newLine: kind === "removed" || kind === "note" ? null : next++ };
		return line;
	});
}

const section = (lines: DiffLine[]): DiffSection[] => [{ header: [], hunks: [{ header: "@@ -1 +1 @@", lines }] }];

/** The class of a kind of token, as the editor colors it. */
const style = (tag: Parameters<typeof codeHighlightStyle.style>[0][number]) => codeHighlightStyle.style([tag]);

/** The class each piece of text of a line was given. */
function pieces(text: string, spans: readonly CodeSpan[]): Record<string, string> {
	return Object.fromEntries(spans.map(span => [text.slice(span.from, span.to), span.className]));
}

async function colors(path: string, lines: DiffLine[]) {
	const colored = await highlightDiff(path, section(lines));
	if (colored === null) throw new Error(`${path} was not colored`);
	return colored[0]![0]!;
}

describe("coloring a diff as the editor colors the file", () => {
	test("TypeScript: each side is parsed as code, context with the new side", async () => {
		const lines = hunk(" export function add(a: number) {", "-\treturn a + 1;", "+\treturn \"a\" + 2;", " }");
		const spans = await colors("src/math.ts", lines);
		expect(pieces(lines[0]!.text, spans[0]!)).toMatchObject({ export: style(tags.keyword), function: style(tags.keyword), add: style(tags.function(tags.definition(tags.variableName))), number: style(tags.typeName) });
		expect(pieces(lines[1]!.text, spans[1]!)).toMatchObject({ return: style(tags.keyword), "1": style(tags.number) });
		expect(pieces(lines[2]!.text, spans[2]!)).toMatchObject({ return: style(tags.keyword), "\"a\"": style(tags.string), "2": style(tags.number) });
	});

	test("CSS and Markdown", async () => {
		const css = hunk(" .a {", "-  color: red;", "+  width: 2px;", " }");
		const cssSpans = await colors("src/styles.css", css);
		expect(pieces(css[1]!.text, cssSpans[1]!)).toMatchObject({ color: style(tags.propertyName) });
		expect(pieces(css[2]!.text, cssSpans[2]!)).toMatchObject({ width: style(tags.propertyName) });

		const markdown = hunk("-# Old plan", "+# New plan", " ", " Some *words*.");
		const markdownSpans = await colors("docs/plan.md", markdown);
		expect(markdownSpans[0]!.map(span => span.className)).toContain(style(tags.heading)!);
		expect(markdownSpans[1]!.map(span => span.className)).toContain(style(tags.heading)!);
		expect(markdownSpans[3]!.map(span => span.className)).toContain(style(tags.emphasis)!);
	});

	test("a token across lines, such as a block comment, is cut at each line", async () => {
		const lines = hunk("+/* one", "+   two */", "+const x = 1;");
		const spans = await colors("a.ts", lines);
		const comment = style(tags.blockComment)!;
		expect(spans[0]).toEqual([{ from: 0, to: 6, className: comment }]);
		expect(spans[1]).toEqual([{ from: 0, to: 9, className: comment }]);
		expect(spans[2]!.some(span => span.className === comment)).toBe(false);
	});

	test("Git's notes are not code and get no colors", async () => {
		const lines = hunk("-x = 1", "\\ No newline at end of file", "+x = 2");
		const spans = await colors("tool.py", lines);
		expect(spans[1]).toEqual([]);
		expect(spans[0]!.length).toBeGreaterThan(0);
	});

	test("stream parsed languages color without an editor: Shell, YAML, TOML", async () => {
		for (const [path, text] of [["run.sh", "+if [ -f a ]; then echo \"hi\"; fi"], ["ci.yaml", "+name: ci # note"], ["Cargo.toml", "+name = \"timber\""]] as const) {
			const spans = await colors(path, hunk(text));
			expect({ path, colored: new Set(spans[0]!.map(span => span.className)).size > 1 }).toEqual({ path, colored: true });
		}
	});

	test("a kind of file it does not know, and a file too long to color, stay plain", async () => {
		expect(await highlightDiff("notes.zzz", section(hunk("+hello")))).toBeNull();
		const far = hunk("+const x = 1;").map(line => ({ ...line, newLine: 15_001 }));
		expect(await highlightDiff("a.ts", section(far))).toBeNull();
	});

	test("a hunk of removals alone colors its context and its removed lines, each once", async () => {
		const lines = hunk(" const keep = 1;", "-const gone = 2;");
		const spans = await colors("a.ts", lines);
		expect(spans.length).toBe(2);
		for (const line of spans) {
			expect(pieces("const", line)).toMatchObject({ const: style(tags.keyword) });
			// No piece is given twice.
			expect(line.every((span, index) => index === 0 || span.from >= line[index - 1]!.to)).toBe(true);
		}
	});
});

describe("PHP", () => {
	const file = [
		"<?php",
		"namespace App\\Models;",
		"",
		"class User extends Model implements HasName, \\Countable",
		"{",
		"    public function greet(string $who, int $times = 1): string",
		"    {",
		"        foreach ($this->names as $name) {",
		"            echo self::format($name, $who);",
		"        }",
		"        return $this->name . $who;",
		"    }",
		"}",
	];
	const method = file.slice(5, 12);

	test("a hunk without <?php, such as the inside of a method, colors as the File tab colors those lines", async () => {
		const whole = await colors("src/User.php", hunk(...file.map(line => ` ${line}`)));
		const inside = await colors("src/User.php", hunk(...method.map(line => ` ${line}`)));
		expect(inside).toEqual(whole.slice(5, 12));
		expect(pieces(method[0]!, inside[0]!)).toMatchObject({ public: style(tags.modifier), function: style(tags.definitionKeyword), greet: style(tags.function(tags.definition(tags.variableName))) });
	});

	test("a hunk's added and removed lines color as code too", async () => {
		const lines = hunk("     {", "-        return $this->name;", "+        return strtoupper($this->name);", "     }");
		const spans = await colors("User.php", lines);
		expect(pieces(lines[1]!.text, spans[1]!)).toMatchObject({ return: style(tags.controlKeyword), $this: style(tags.self), name: style(tags.propertyName) });
		expect(pieces(lines[2]!.text, spans[2]!)).toMatchObject({ return: style(tags.controlKeyword), strtoupper: style(tags.function(tags.variableName)), $this: style(tags.self) });
	});

	test("its tokens color as TypeScript's do", async () => {
		const spans = await colors("src/User.php", hunk(...file.map(line => `+${line}`)));
		const of = (line: number) => pieces(file[line]!, spans[line]!);
		expect(of(1)).toMatchObject({ namespace: style(tags.moduleKeyword), App: style(tags.namespace), Models: style(tags.namespace) });
		expect(of(3)).toMatchObject({ User: style(tags.definition(tags.className)), Model: style(tags.className), HasName: style(tags.className), Countable: style(tags.className) });
		expect(style(tags.className)).toBe(style(tags.typeName));
		// Parameters are definitions, as TypeScript's are; their uses are plain variables.
		expect(of(5)).toMatchObject({ $who: style(tags.definition(tags.variableName)), $times: style(tags.definition(tags.variableName)), string: style(tags.typeName) });
		expect(of(7)).toMatchObject({ $this: style(tags.self), $name: style(tags.definition(tags.variableName)) });
		expect(of(8)).toMatchObject({ self: style(tags.self), $name: style(tags.variableName), $who: style(tags.variableName) });
		expect(style(tags.self)).toBe(style(tags.keyword));
	});

	test("a use of a trait or a class by one name is a class name", async () => {
		const lines = hunk("+use Countable;", "+    use HasName;");
		const spans = await colors("a.php", lines);
		expect(pieces(lines[0]!.text, spans[0]!)).toMatchObject({ Countable: style(tags.className) });
		expect(pieces(lines[1]!.text, spans[1]!)).toMatchObject({ HasName: style(tags.className) });
	});

	test("an object before -> is a variable, not a property", async () => {
		const lines = hunk("+$user->save();");
		const spans = await colors("a.php", lines);
		expect(pieces(lines[0]!.text, spans[0]!)).toMatchObject({ $user: style(tags.variableName), save: style(tags.function(tags.propertyName)) });
	});

	test("a hunk that opens with <?php, and HTML mixed with PHP, still color", async () => {
		const opening = hunk("+<?php", "+echo $name;");
		const openingSpans = await colors("index.php", opening);
		expect(pieces(opening[0]!.text, openingSpans[0]!)).toMatchObject({ "<?php": style(tags.processingInstruction) });
		expect(pieces(opening[1]!.text, openingSpans[1]!)).toMatchObject({ echo: style(tags.keyword) });

		const page = hunk(" <ul>", "+  <li><?= $item ?></li>", " </ul>");
		const pageSpans = await colors("list.php", page);
		expect(pieces(page[0]!.text, pageSpans[0]!)).toMatchObject({ ul: style(tags.tagName) });
		expect(pieces(page[1]!.text, pageSpans[1]!)).toMatchObject({ li: style(tags.tagName), "<?=": style(tags.processingInstruction), $item: style(tags.variableName) });

		// Code that closes into HTML: code before ?>, the page after it.
		const closing = hunk("+    echo $title;", "+?>", "+<h1>Hi</h1>");
		const closingSpans = await colors("view.php", closing);
		expect(pieces(closing[0]!.text, closingSpans[0]!)).toMatchObject({ echo: style(tags.keyword) });
		expect(pieces(closing[2]!.text, closingSpans[2]!)).toMatchObject({ h1: style(tags.tagName) });
	});

	test("a hunk of HTML alone from a .php file colors as HTML", async () => {
		const lines = hunk(" <div class=\"card\">", "+  <p>Hello</p>", " </div>");
		const spans = await colors("card.phtml", lines);
		expect(pieces(lines[0]!.text, spans[0]!)).toMatchObject({ div: style(tags.tagName), class: style(tags.attributeName) });
		expect(pieces(lines[1]!.text, spans[1]!)).toMatchObject({ p: style(tags.tagName) });
	});
});

describe("whether a side of a PHP hunk is code", () => {
	test("the first tag decides, and with none, text starting with an HTML tag is the page", () => {
		expect(isPhpCode("    return $x;")).toBe(true);
		expect(isPhpCode("<?php\necho 1;")).toBe(false);
		expect(isPhpCode("<p><?= $x ?></p>")).toBe(false);
		expect(isPhpCode("echo 1;\n?>\n<p>")).toBe(true);
		expect(isPhpCode("  <div>")).toBe(false);
		expect(isPhpCode("$a = <<<EOT")).toBe(true);
		expect(isPhpCode("if ($a < $b) {")).toBe(true);
	});
});

describe("a line's pieces", () => {
	test("cut the code's colors at the changed words", () => {
		const spans: CodeSpan[] = [{ from: 0, to: 6, className: "keyword" }, { from: 7, to: 12, className: "name" }];
		expect(lineSegments("return value;", spans, { from: 9, to: 12 })).toEqual([
			{ text: "return", className: "keyword", word: false },
			{ text: " ", className: null, word: false },
			{ text: "va", className: "name", word: false },
			{ text: "lue", className: "name", word: true },
			{ text: ";", className: null, word: false },
		]);
	});

	test("plain text, with and without a changed word", () => {
		expect(lineSegments("abc", [], null)).toEqual([{ text: "abc", className: null, word: false }]);
		expect(lineSegments("abc", [], { from: 1, to: 3 })).toEqual([{ text: "a", className: null, word: false }, { text: "bc", className: null, word: true }]);
		expect(lineSegments("", [], null)).toEqual([]);
	});
});
