import { describe, expect, test } from "bun:test";
import { OUTPUT_LIMIT_BYTES, createOutputCapture, plainText } from "../src/shared/captured-output";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("createOutputCapture", () => {
	test("keeps everything while it fits", () => {
		const capture = createOutputCapture(16);
		capture.add(bytes("one\n"));
		capture.add(bytes(""));
		capture.add(bytes("two\n"));
		expect(capture.finish()).toEqual({ text: "one\ntwo\n", truncated: false });
	});

	test("keeps the end and says so when there is more than the limit", () => {
		const capture = createOutputCapture(8);
		capture.add(bytes("0123456789"));
		expect(capture.finish()).toEqual({ text: "23456789", truncated: true });
		capture.add(bytes("ab"));
		expect(capture.finish()).toEqual({ text: "456789ab", truncated: true });
		capture.add(bytes("a much longer piece than the limit"));
		expect(capture.finish()).toEqual({ text: "he limit", truncated: true });
	});

	test("exactly the limit is not truncated", () => {
		const capture = createOutputCapture(4);
		capture.add(bytes("ab"));
		capture.add(bytes("cd"));
		expect(capture.finish()).toEqual({ text: "abcd", truncated: false });
	});

	test("a cut inside a character drops the rest of that character", () => {
		const capture = createOutputCapture(5);
		// Each of these letters takes two bytes, so five bytes start in the middle of one.
		capture.add(bytes("żółć"));
		expect(capture.finish()).toEqual({ text: "łć", truncated: true });
	});

	test("the default limit holds however much is printed", () => {
		const capture = createOutputCapture();
		const line = bytes(`${"x".repeat(1023)}\n`);
		for (let count = 0; count < 300; count++) capture.add(line);
		capture.add(bytes("the last line\n"));
		const { text, truncated } = capture.finish();
		expect(truncated).toBe(true);
		expect(bytes(text).length).toBe(OUTPUT_LIMIT_BYTES);
		expect(text.endsWith("the last line\n")).toBe(true);
	});
});

describe("plainText", () => {
	test("drops terminal escape sequences and other control characters, and keeps tabs and new lines", () => {
		expect(plainText("\u001b[31merror:\u001b[0m no\n\tsecond\u0007 line\n")).toBe("error: no\n\tsecond line\n");
		expect(plainText("\u001b]0;window title\u0007done")).toBe("done");
	});

	test("turns every line end into a new line", () => {
		expect(plainText("one\r\ntwo\rthree\n")).toBe("one\ntwo\nthree\n");
	});
});
