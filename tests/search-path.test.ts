import { describe, expect, test } from "bun:test";
import { SHOWN_FOLDERS, describeSearchPath, notFoundOnPath } from "../src/shared/search-path";

describe("describeSearchPath", () => {
	test("a short search path is shown as it is", () => {
		expect(describeSearchPath("/usr/local/bin:/usr/bin:/bin", ":")).toBe("/usr/local/bin:/usr/bin:/bin");
		expect(describeSearchPath("/only", ":")).toBe("/only");
	});

	test("a long one names its first folders and counts the rest", () => {
		expect(SHOWN_FOLDERS).toBe(3);
		expect(describeSearchPath("/a:/b:/c:/d", ":")).toBe("/a:/b:/c and 1 more folder");
		const long = Array.from({ length: 23 }, (_, index) => `/home/someone/.local/share/tool ${index}/bin`).join(":");
		expect(describeSearchPath(long, ":")).toBe("/home/someone/.local/share/tool 0/bin:/home/someone/.local/share/tool 1/bin:/home/someone/.local/share/tool 2/bin and 20 more folders");
	});

	test("empty entries do not count, and nothing at all is said so", () => {
		expect(describeSearchPath("", ":")).toBe("(empty)");
		expect(describeSearchPath("::", ":")).toBe("(empty)");
		expect(describeSearchPath(":/a::/b:/c:/d:", ":")).toBe("/a:/b:/c and 1 more folder");
	});

	test("folders are separated by what the platform uses", () => {
		expect(describeSearchPath("C:\\Tools;C:\\Windows;C:\\a;C:\\b;C:\\c", ";")).toBe("C:\\Tools;C:\\Windows;C:\\a and 2 more folders");
	});
});

describe("notFoundOnPath", () => {
	test("names the command that was looked for", () => {
		expect(notFoundOnPath(["code"], "/usr/bin:/bin", ":")).toBe('"code" was not found on the PATH the app was started with: /usr/bin:/bin.');
		expect(notFoundOnPath(["code"], "", ":")).toBe('"code" was not found on the PATH the app was started with: (empty).');
	});

	test("names every name that was looked for", () => {
		expect(notFoundOnPath(["zed", "zeditor"], "/usr/bin", ":")).toBe('Neither "zed" nor "zeditor" was found on the PATH the app was started with: /usr/bin.');
		expect(notFoundOnPath(["a", "b", "c"], "/usr/bin", ":")).toBe('Neither "a", "b" nor "c" was found on the PATH the app was started with: /usr/bin.');
	});

	test("stays one short line with a long PATH", () => {
		const long = Array.from({ length: 40 }, (_, index) => `/opt/tools/number-${index}/bin`).join(":");
		const sentence = notFoundOnPath(["zed", "zeditor"], long, ":");
		expect(sentence).toBe('Neither "zed" nor "zeditor" was found on the PATH the app was started with: /opt/tools/number-0/bin:/opt/tools/number-1/bin:/opt/tools/number-2/bin and 37 more folders.');
		expect(sentence).not.toContain("number-3/");
	});
});
