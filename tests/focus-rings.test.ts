import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A Windows checkout may end lines with CRLF; the lookups below expect LF.
const styles = readFileSync(join(import.meta.dir, "..", "src/mainview/styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The body of the rule with exactly this selector, which starts a line in styles.css and is not part of a longer list. */
function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?:^|\\n)(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

function px(body: string, property: string): number {
	return Number(new RegExp(`(?:^|\\s)${property}: (-?[\\d.]+)px`).exec(body)?.[1] ?? Number.NaN);
}

/** How far a ring reaches past its element's edge: its width plus its offset. */
function reach(body: string): number {
	const width = Number(/outline: ([\d.]+)px solid/.exec(body)?.[1] ?? Number.NaN);
	return width + px(body, "outline-offset");
}

/** The top padding of a `padding` shorthand with one to four lengths. */
function paddingTop(body: string): number {
	const values = /(?:^|\s)padding: ([^;]+);/.exec(body)?.[1]?.split(/\s+/) ?? [];
	return Number.parseFloat(values[0] ?? "");
}

/** The bottom padding of a `padding` shorthand with one to four lengths. */
function paddingBottom(body: string): number {
	const values = /(?:^|\s)padding: ([^;]+);/.exec(body)?.[1]?.split(/\s+/) ?? [];
	return Number.parseFloat(values[values.length > 2 ? 2 : 0] ?? "");
}

const controlRing = rule("button:focus-visible,\ninput:focus-visible,\nselect:focus-visible,\nsummary:focus-visible,\npre:focus-visible");

describe("focus rings inside a scrolling container", () => {
	test("the ring every button and field takes reaches past its edge, so a scroller with no room clips it", () => {
		expect(reach(controlRing)).toBeGreaterThan(0);
	});

	test("draw a session chip's ring and the rename field's inside them, as a tab's is, so the scrolling row shows the whole ring", () => {
		const chipRing = rule(".session-chip:has(> button:focus-visible),\n.session-rename:focus-visible");
		expect(chipRing).toContain("outline: 2px solid var(--focus);");
		expect(reach(chipRing)).toBeLessThanOrEqual(0);
		expect(reach(chipRing)).toBe(reach(rule(".tab:focus-visible,\n.tabpanel:focus-visible")));
	});

	test("ring a session chip whole, its name and close button together, rather than each button alone", () => {
		expect(rule(".session-chip > button:focus-visible")).toContain("outline: none;");
	});

	test("leave room above the sidebar's first repository header for its whole ring", () => {
		expect(paddingTop(rule(".groups"))).toBeGreaterThanOrEqual(reach(controlRing));
	});

	test("keep the space between the filter and the first repository header as it was", () => {
		expect(paddingBottom(rule(".sidebar-tools")) + paddingTop(rule(".groups"))).toBe(8);
	});
});
