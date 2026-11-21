import { describe, expect, test } from "bun:test";
import { ensureSyntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";
import { MAX_COLORED_LINES, codeHighlightStyle, describeLanguage, pickLanguage } from "../src/mainview/editor-language";
import { TERMINAL_COLOR_PROPERTIES } from "../src/shared/theme";

const short = (text: string) => ({ lines: text.split("\n").length, length: text.length });

/** A sample of each language the File tab must color, with the name it goes by. */
const SAMPLES: { path: string; name: string; text: string }[] = [
	{ path: "src/a.ts", name: "TypeScript", text: "// note\nexport function add(a: number): number { return a + 1; }\n" },
	{ path: "src/a.js", name: "JavaScript", text: "// note\nconst x = \"a\"; function f() { return 2; }\n" },
	{ path: "package.json", name: "JSON", text: "{ \"name\": \"timber\", \"count\": 2, \"on\": true }\n" },
	{ path: "docs/plan.md", name: "Markdown", text: "# Plan\n\nSome *words* and `code`.\n" },
	{ path: "src/styles.css", name: "CSS", text: "/* note */\n.a { color: red; width: 2px; }\n" },
	{ path: "index.html", name: "HTML", text: "<!-- note -->\n<div class=\"a\">Hi</div>\n" },
	{ path: "tool.py", name: "Python", text: "# note\ndef add(a):\n    return a + 1\n" },
	{ path: "src/main.rs", name: "Rust", text: "// note\nfn main() { let x = 1; }\n" },
	{ path: "main.go", name: "Go", text: "// note\npackage main\nfunc main() { x := 1 }\n" },
	{ path: "scripts/run.sh", name: "Shell", text: "# note\nif [ -f a ]; then echo \"hi\"; fi\n" },
	{ path: ".github/ci.yaml", name: "YAML", text: "# note\nname: ci\non: [push]\n" },
	{ path: "Cargo.toml", name: "TOML", text: "# note\n[package]\nname = \"timber\"\n" },
];

const loaded = () => languages.filter(description => description.support).map(description => description.name);

describe("coloring by language", () => {
	test("opening a file loads only its own language's parser", async () => {
		const before = loaded();
		const picked = pickLanguage("src/only.rs", short("fn main() {}\n"));
		if (picked.kind !== "colored") throw new Error("Rust was not picked");
		await picked.description.load();
		expect(loaded().filter(name => !before.includes(name))).toEqual(before.includes("Rust") ? [] : ["Rust"]);
	});

	test("picks the language from the name and extension, and colors each one", async () => {
		for (const sample of SAMPLES) {
			const picked = pickLanguage(sample.path, short(sample.text));
			expect(picked.kind === "colored" && picked.name).toBe(sample.name);
			if (picked.kind !== "colored") continue;
			expect(describeLanguage(picked)).toBe(sample.name);
			const support = await picked.description.load();
			const state = EditorState.create({ doc: sample.text, extensions: [support] });
			const tree = ensureSyntaxTree(state, state.doc.length, 5_000);
			if (!tree) throw new Error(`${sample.name} did not parse`);
			const classes = new Set<string>();
			highlightTree(tree, codeHighlightStyle, (_from, _to, style) => classes.add(style));
			// Colored: more than one kind of token is styled.
			expect({ name: sample.name, kinds: classes.size > 1 }).toEqual({ name: sample.name, kinds: true });
		}
	});

	test("a kind of file it does not know, and a file too long, stay plain and say why", () => {
		const unknown = pickLanguage("notes.zzz", short("hello\n"));
		expect(unknown.kind).toBe("plain");
		expect(describeLanguage(unknown)).toBe("Plain text: no coloring for this kind of file");
		expect(pickLanguage("report.txt", short("hello\n")).kind).toBe("plain");

		const long = pickLanguage("src/a.ts", { lines: MAX_COLORED_LINES + 1, length: 100 });
		expect(long.kind).toBe("plain");
		expect(describeLanguage(long)).toContain("too long to color");
		// The 10,000 line file of the browser test is still colored.
		expect(pickLanguage("src/long.ts", { lines: 10_001, length: 700_000 }).kind).toBe("colored");
	});

	test("takes every color from the theme's terminal palette, so a theme change recolors", () => {
		const rules = codeHighlightStyle.module?.getRules() ?? "";
		const colors = [...rules.matchAll(/color: ([^;}]+)/g)].map(match => match[1]!.trim());
		expect(colors.length).toBeGreaterThan(0);
		const properties = new Set<string>(Object.values(TERMINAL_COLOR_PROPERTIES));
		for (const color of colors) expect(properties.has(/^var\((--[a-z-]+)\)$/.exec(color)?.[1] ?? color)).toBe(true);
		for (const kind of ["foreground", "magenta", "blue", "red", "green", "yellow", "cyan", "bright-black", "bright-blue"]) expect(rules).toContain(`var(--terminal-${kind})`);
	});
});
