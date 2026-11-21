import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A Windows checkout may end lines with CRLF; the lookups below expect LF.
const styles = readFileSync(join(import.meta.dir, "..", "src/mainview/styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The body of the rule with exactly this selector, which starts a line in styles.css and is not part of a list. */
function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?:^|\\n)(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
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
