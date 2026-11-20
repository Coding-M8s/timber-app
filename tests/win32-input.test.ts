import { describe, expect, test } from "bun:test";
import { asWin32KeyEvents } from "../src/shared/win32-input";

describe("asWin32KeyEvents", () => {
	test("each character is a key press and a release carrying its code unit, with no virtual key or scan code", () => {
		expect(asWin32KeyEvents("a\x1b")).toBe("\x1b[0;0;97;1;0;1_\x1b[0;0;97;0;0;1_\x1b[0;0;27;1;0;1_\x1b[0;0;27;0;0;1_");
	});

	test("a character outside the basic plane goes as its two UTF-16 code units", () => {
		expect(asWin32KeyEvents("\u{1F600}")).toBe("\x1b[0;0;55357;1;0;1_\x1b[0;0;55357;0;0;1_\x1b[0;0;56832;1;0;1_\x1b[0;0;56832;0;0;1_");
	});

	test("nothing gives nothing", () => {
		expect(asWin32KeyEvents("")).toBe("");
	});
});
