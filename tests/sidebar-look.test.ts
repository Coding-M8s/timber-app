import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_THEMES } from "../src/shared/builtin-themes";
import { contrastRatio, formatColor, over, parseColor } from "../src/shared/color";
import { CONTRAST_MINIMUMS } from "../src/shared/theme";

// A Windows checkout may end lines with CRLF; the lookups below expect LF.
const styles = readFileSync(join(import.meta.dir, "..", "src/mainview/styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The body of the rule with exactly this selector, which starts a line in styles.css and is not part of a list. */
function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?:^|\\n)(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

/** Every rule, nested in a media query or not, whose selector list names this class, as its selector and body. */
function rulesNaming(className: string): { selector: string; body: string }[] {
	const pattern = new RegExp(`\\.${className}(?![\\w-])`);
	const uncommented = styles.replace(/\/\*[\s\S]*?\*\//g, "");
	return [...uncommented.matchAll(/(?<=^|[{}])\s*([^{}]+?)\s*\{([^{}]*)\}/g)]
		.map(match => ({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" }))
		.filter(found => pattern.test(found.selector));
}

/** The value of one property in a rule's body. */
function property(body: string, name: string): string | undefined {
	return new RegExp(`(?:^|[\\s;])${name}: ([^;]+);`).exec(body)?.[1];
}

describe("a repository's header in the sidebar", () => {
	test("names the repository in the main text color, larger than a worktree's name", () => {
		const name = rule(".group-name");
		expect(name).toContain("color: var(--text);");
		const size = (body: string) => Number(/font-size: ([\d.]+)px;/.exec(body)?.[1] ?? Number.NaN);
		// A worktree's name takes the body's size.
		expect(size(name)).toBeGreaterThan(size(rule("body")));
	});

	test("draws a hairline above each repository after the first", () => {
		expect(rule(".group + .group")).toContain("border-top: 1px solid var(--line);");
	});

	test("puts the line that shows where a dragged repository lands in the middle of the gap, either side of the hairline", () => {
		const px = (body: string, property: string) => Number(new RegExp(`(?:^|\\s)${property}: (-?[\\d.]+)px`).exec(body)?.[1] ?? Number.NaN);
		const gap = px(rule(".groups"), "gap");
		const hairline = px(rule(".group + .group"), "border-top");
		const thickness = px(rule(".group.drop-before::before,\n.group.drop-after::after"), "height");
		// Placed from the padding box: after a group from its bottom, before one from inside its hairline.
		const after = -px(rule(".group.drop-after::after"), "bottom") - thickness / 2;
		const before = -px(rule(".group.drop-before::before"), "top") - thickness / 2 - hairline;
		expect(after).toBe(gap / 2);
		expect(before).toBe(gap / 2);
	});

	test("keeps an unavailable repository's name faint", () => {
		expect(rule(".group-head.unavailable .group-name")).toContain("color: var(--text-3);");
	});
});

describe("a repository's header row", () => {
	test("has its own background, unlike a worktree row, which is drawn straight on the sidebar", () => {
		const head = property(rule(".group-head"), "background");
		expect(head).toBe("var(--fill-field)");
		// A worktree row has no background of its own until it is pointed at or selected.
		expect(property(rule(".row"), "background")).toBe("transparent");
		expect(property(rule(".sidebar"), "background")).toBe("var(--bg-app)");
	});

	test("differs from the sidebar in every built-in theme, and stays quieter than a selected row", () => {
		for (const theme of BUILT_IN_THEMES) {
			expect({ id: theme.id, step: contrastRatio(theme.ui.fillField, theme.ui.bgApp, theme.ui.bgApp) > 1 }).toEqual({ id: theme.id, step: true });
			expect({ id: theme.id, quieter: contrastRatio(theme.ui.fillField, theme.ui.bgApp, theme.ui.bgApp) < contrastRatio(theme.ui.fillSelected, theme.ui.bgApp, theme.ui.bgApp) }).toEqual({ id: theme.id, quieter: true });
		}
	});

	test("keeps its text and marks readable on its background in every built-in theme", () => {
		for (const theme of BUILT_IN_THEMES) {
			for (const color of ["text", "text2", "text3"] as const) {
				const ratio = contrastRatio(theme.ui[color], theme.ui.fillField, theme.ui.bgApp);
				expect({ id: theme.id, color, clear: ratio >= CONTRAST_MINIMUMS.text }).toEqual({ id: theme.id, color, clear: true });
			}
			for (const color of ["behind", "ahead", "modified", "untracked", "error", "focus"] as const) {
				const ratio = contrastRatio(theme.ui[color], theme.ui.fillField, theme.ui.bgApp);
				expect({ id: theme.id, color, clear: ratio >= CONTRAST_MINIMUMS.meaning }).toEqual({ id: theme.id, color, clear: true });
			}
		}
	});

	test("still changes under the pointer, on the header and on its controls", () => {
		expect(property(rule(".group-header"), "background")).toBe("transparent");
		expect(property(rule(".group-header:hover"), "background")).toBe("var(--fill-hover)");
		expect(property(rule(".group-header:hover"), "color")).toBe("var(--text-2)");
		expect(property(rule(".icon-button:hover"), "background")).toBe("var(--fill-hover)");
	});

	test("raises its faint words to the secondary color under the pointer, which stays readable on the deeper tint in every built-in theme", () => {
		const raised = rule(".group-header:hover .group-flag.fetch-failed,\n.group-header:hover .group-flag.pulls-failed,\n.group-header:hover .group-flag.backups-failed,\n.group-head.unavailable .group-header:hover .group-name");
		expect(raised).toContain("color: var(--text-2);");
		for (const theme of BUILT_IN_THEMES) {
			// The header's tint laid over the sidebar, as the pointer's fill is laid over it.
			const tinted = formatColor(over(parseColor(theme.ui.fillField)!, parseColor(theme.ui.bgApp)!));
			const ratio = contrastRatio(theme.ui.text2, theme.ui.fillHover, tinted);
			expect({ id: theme.id, clear: ratio >= CONTRAST_MINIMUMS.text }).toEqual({ id: theme.id, clear: true });
		}
	});

	test("does not clip what it holds, so focus rings on the header and its controls are drawn whole", () => {
		expect(property(rule(".group-head"), "overflow")).toBeUndefined();
	});

	test("shows Fetch now and More without pointing at it or focusing it, and More on a group's header too", () => {
		for (const className of ["group-fetch", "group-more", "repository-group-more"]) {
			const rules = rulesNaming(className);
			expect(rules.length).toBeGreaterThan(0);
			for (const { selector, body } of rules) {
				expect({ selector, hidden: /(?:^|[\s;])opacity:\s*0(?![.\d])/.test(body) }).toEqual({ selector, hidden: false });
				expect({ selector, hidden: /visibility:\s*hidden/.test(body) }).toEqual({ selector, hidden: false });
			}
		}
	});

	test("keeps Fetch now's disabled look and its pulse while fetching", () => {
		expect(rule(".group-fetch[aria-disabled=\"true\"]")).toContain("color: var(--text-3);");
		expect(rule(".group-fetch.fetching svg")).toContain("animation: fetch-pulse 1.2s ease-in-out infinite;");
	});
});
