import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The shared button keeps its label on one line inside its outline (issue
 * 310). The layout itself is checked in a real browser in
 * ./settings-buttons-browser.test.ts; these check the rules where there is none.
 */

// A Windows checkout may end lines with CRLF; the lookups below expect LF.
const styles = readFileSync(join(import.meta.dir, "..", "src/mainview/styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The body of the rule with exactly this selector, which starts a line in styles.css and is not part of a list. */
function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?:^|\\n)(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

/** Every component file, as text. */
const sources = new Bun.Glob("src/mainview/components/**/*.tsx");

describe("a button", () => {
	test("keeps its label on one line and does not shrink below it in a row", () => {
		const button = rule(".button");
		expect(button).toContain("white-space: nowrap;");
		expect(button).toContain("flex-shrink: 0;");
		// A fixed height holds one line only, which is why the label must not wrap.
		expect(button).toContain("height: 30px;");
	});

	test("with a label to reserve, is as wide as that label too, which is never drawn", () => {
		const reserve = rule(".button[data-reserve]::after");
		expect(reserve).toContain("content: attr(data-reserve);");
		expect(reserve).toContain("height: 0;");
		expect(reserve).toContain("overflow: hidden;");
		expect(reserve).toContain("visibility: hidden;");
	});

	test("rows of dialog and Settings buttons wrap rather than run past their edge", () => {
		for (const selector of [".dialog-buttons", ".settings-section-foot", ".uninstall-buttons", ".restart-prompt-buttons", ".chops-repository-head", ".chop-add"]) {
			expect(`${selector}: ${rule(selector).includes("flex-wrap: wrap;")}`).toBe(`${selector}: true`);
		}
	});

	test("each label that changes while it runs reserves the wider one", async () => {
		const reserved: string[] = [];
		for await (const path of sources.scan(join(import.meta.dir, ".."))) {
			const text = readFileSync(join(import.meta.dir, "..", path), "utf8");
			for (const found of text.matchAll(/data-reserve="([^"]+)"/g)) reserved.push(found[1]!);
		}
		expect(reserved.sort()).toEqual(["Check for updates", "Read again", "Read again", "Saving", "Saving", "Test connection", "Uninstall and quit"]);
	});
});
