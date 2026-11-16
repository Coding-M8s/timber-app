import { describe, expect, test } from "bun:test";
import { describeCommandLine, quoteWord, splitCommandLine } from "../src/shared/command-line";

const words = (text: string) => {
	const reading = splitCommandLine(text);
	if (!reading.ok) throw new Error(reading.message);
	return reading.words;
};

describe("splitCommandLine", () => {
	test("spaces and tabs separate words, however many there are", () => {
		expect(words("code")).toEqual(["code"]);
		expect(words("  zed \t --new   ")).toEqual(["zed", "--new"]);
		expect(words("")).toEqual([]);
		expect(words("   ")).toEqual([]);
	});

	test("single and double quotes group text with spaces into one word", () => {
		expect(words(`"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --wait`))
			.toEqual(["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", "--wait"]);
		expect(words(`'/opt/my editor/bin/edit' -n`)).toEqual(["/opt/my editor/bin/edit", "-n"]);
	});

	test("each quote keeps the other as an ordinary character", () => {
		expect(words(`say "it's" 'a "word"'`)).toEqual(["say", "it's", `a "word"`]);
	});

	test("quoted and plain text next to each other make one word", () => {
		expect(words(`--folder="{path}" a'b c'd`)).toEqual(["--folder={path}", "ab cd"]);
	});

	test("empty quotes are an empty word", () => {
		expect(words(`edit "" ''`)).toEqual(["edit", "", ""]);
	});

	test("a backslash is an ordinary character, inside quotes and out", () => {
		expect(words(`C:\\Tools\\edit.exe "C:\\My Files\\x" a\\ b`)).toEqual(["C:\\Tools\\edit.exe", "C:\\My Files\\x", "a\\", "b"]);
	});

	test("nothing is expanded", () => {
		expect(words("$EDITOR ~/x *.ts ; rm -rf / | cat `id` $(id)")).toEqual(["$EDITOR", "~/x", "*.ts", ";", "rm", "-rf", "/", "|", "cat", "`id`", "$(id)"]);
	});

	test("a quote that is never closed is an error that says where it starts", () => {
		expect(splitCommandLine(`code "my folder`)).toEqual({ ok: false, message: "The double quote at character 6 is never closed." });
		expect(splitCommandLine(`it's`)).toEqual({ ok: false, message: "The single quote at character 3 is never closed." });
	});
});

describe("describing a command line", () => {
	test("plain words stay as they are, and others are quoted for a POSIX shell", () => {
		expect(quoteWord("code")).toBe("code");
		expect(quoteWord("/work/my repo")).toBe("'/work/my repo'");
		expect(quoteWord("it's")).toBe(`'it'\\''s'`);
		expect(quoteWord("")).toBe("''");
		expect(describeCommandLine(["code", "--new-window", "/work/a b"])).toBe("code --new-window '/work/a b'");
	});
});
