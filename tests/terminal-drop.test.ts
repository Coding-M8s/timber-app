import { describe, expect, test } from "bun:test";
import {
	FILE_PATHS_TYPE, carriesDroppedPaths, droppedPaths, fileUriToPath, pathsFromHtml, pathsFromUriList, pathsPasteText, shellQuote, worktreeFilePath,
} from "../src/mainview/terminal-drop";

describe("fileUriToPath", () => {
	test("turns a file URI into its path, decoded", () => {
		expect(fileUriToPath("file:///home/me/notes.txt")).toBe("/home/me/notes.txt");
		expect(fileUriToPath("file:///home/me/a%20folder")).toBe("/home/me/a folder");
		// As WebKitGTK wrote it for `it's a ćma "x" #1%.txt`.
		expect(fileUriToPath("file:///home/me/it's%20a%20%C4%87ma%20%22x%22%20%231%25.txt")).toBe(`/home/me/it's a ćma "x" #1%.txt`);
	});

	test("takes localhost as this machine, and nothing from another host", () => {
		expect(fileUriToPath("file://localhost/srv/x.md")).toBe("/srv/x.md");
		expect(fileUriToPath("file://server/share/x.md")).toBeNull();
	});

	test("keeps a folder's trailing slash off", () => {
		expect(fileUriToPath("file:///home/me/folder/")).toBe("/home/me/folder");
		expect(fileUriToPath("file:///")).toBe("/");
	});

	test("answers null for other schemes and broken escapes instead of throwing", () => {
		expect(fileUriToPath("https://example.com/x.txt")).toBeNull();
		expect(fileUriToPath("/home/me/x.txt")).toBeNull();
		expect(fileUriToPath("file:///home/me/%E0%A4%A.txt")).toBeNull();
		expect(fileUriToPath("")).toBeNull();
	});

	test("reads a Windows drive without the slash before it", () => {
		expect(fileUriToPath("file:///C:/Users/me/x.txt")).toBe("C:/Users/me/x.txt");
	});
});

describe("pathsFromUriList", () => {
	test("reads every file URI, line by line, skipping comments, blank lines, and other schemes", () => {
		const list = "# dropped\r\nfile:///home/me/a.txt\r\n\r\nhttps://example.com/\r\nfile:///home/me/b%20c.md\r\n";
		expect(pathsFromUriList(list)).toEqual(["/home/me/a.txt", "/home/me/b c.md"]);
	});

	test("answers nothing for an empty list", () => {
		expect(pathsFromUriList("")).toEqual([]);
	});
});

describe("pathsFromHtml", () => {
	test("reads the file URI that WebKitGTK writes as a link's text", () => {
		const html = `<a style="caret-color: rgb(0, 0, 0); text-decoration: none;">file:///home/rafipafi/timber-drop-test/a%20folder</a>`;
		expect(pathsFromHtml(html)).toEqual(["/home/rafipafi/timber-drop-test/a folder"]);
	});

	test("keeps a quote that the URI leaves unescaped, and reads characters written as entities", () => {
		expect(pathsFromHtml(`<a>file:///home/me/it's%20here.txt</a>`)).toEqual(["/home/me/it's here.txt"]);
		expect(pathsFromHtml(`<a>file:///home/me/a&amp;b.txt</a>`)).toEqual(["/home/me/a&b.txt"]);
	});

	test("reads links' addresses too, once each", () => {
		const html = `<a href="file:///home/me/x.txt">file:///home/me/x.txt</a> <a href="file:///home/me/y.txt">y</a>`;
		expect(pathsFromHtml(html)).toEqual(["/home/me/x.txt", "/home/me/y.txt"]);
	});

	test("finds nothing in html without a file URI", () => {
		expect(pathsFromHtml(`<p>Some <b>text</b> from https://example.com/x.txt</p>`)).toEqual([]);
	});
});

describe("droppedPaths", () => {
	const read = (data: Record<string, string>) => (type: string) => data[type] ?? "";

	test("the app's own paths come first", () => {
		const paths = droppedPaths(read({ [FILE_PATHS_TYPE]: JSON.stringify(["/repo/src/app.ts"]), "text/uri-list": "file:///other" }));
		expect(paths).toEqual(["/repo/src/app.ts"]);
	});

	test("then the URI list, which can hold several files", () => {
		expect(droppedPaths(read({ "text/uri-list": "file:///a.txt\nfile:///b.txt", "text/html": "<a>file:///c.txt</a>" }))).toEqual(["/a.txt", "/b.txt"]);
	});

	test("then the html, where WebKitGTK puts the one path it lets a page read", () => {
		expect(droppedPaths(read({ "text/uri-list": "", "text/html": "<a>file:///home/me/x.txt</a>" }))).toEqual(["/home/me/x.txt"]);
	});

	test("ignores the app's paths when they are not a list of strings", () => {
		expect(droppedPaths(read({ [FILE_PATHS_TYPE]: "{broken" }))).toEqual([]);
		expect(droppedPaths(read({ [FILE_PATHS_TYPE]: JSON.stringify([1, "/x"]) }))).toEqual(["/x"]);
	});

	test("finds nothing in a drop of plain text", () => {
		expect(droppedPaths(read({ "text/plain": "/home/me/x.txt" }))).toEqual([]);
	});
});

describe("carriesDroppedPaths", () => {
	test("is true for a drag of files from outside or of rows from the Files panel", () => {
		expect(carriesDroppedPaths(["text/uri-list", "text/html"])).toBe(true);
		expect(carriesDroppedPaths(["Files"])).toBe(true);
		expect(carriesDroppedPaths([FILE_PATHS_TYPE, "text/plain"])).toBe(true);
	});

	test("is false for a drag of text", () => {
		expect(carriesDroppedPaths(["text/plain", "text/html"])).toBe(false);
		expect(carriesDroppedPaths([])).toBe(false);
	});
});

describe("shellQuote", () => {
	test("leaves a plain path as it is", () => {
		expect(shellQuote("/home/me/src/app.ts")).toBe("/home/me/src/app.ts");
		expect(shellQuote("/home/me/v1.2_x-y+z@host:8,=%")).toBe("/home/me/v1.2_x-y+z@host:8,=%");
	});

	test("puts single quotes around anything a shell would read differently", () => {
		expect(shellQuote("/home/me/a folder")).toBe("'/home/me/a folder'");
		expect(shellQuote(`/home/me/"x"`)).toBe(`'/home/me/"x"'`);
		expect(shellQuote("/home/me/$HOME`id`*?[]~!#&;|<>(){}\\")).toBe("'/home/me/$HOME`id`*?[]~!#&;|<>(){}\\'");
		expect(shellQuote("/home/me/ćma.txt")).toBe("'/home/me/ćma.txt'");
	});

	test("ends the quotes around a single quote and escapes it", () => {
		expect(shellQuote("/home/me/it's")).toBe(`'/home/me/it'\\''s'`);
	});

	test("quotes an empty path, so it still counts as one", () => {
		expect(shellQuote("")).toBe("''");
	});
});

describe("pathsPasteText", () => {
	test("separates the quoted paths with spaces and ends with one", () => {
		expect(pathsPasteText(["/a.txt", "/b c.md", "/d"])).toBe("/a.txt '/b c.md' /d ");
	});

	test("is empty when nothing was dropped", () => {
		expect(pathsPasteText([])).toBe("");
	});
});

describe("worktreeFilePath", () => {
	test("puts a path in the Files panel under its worktree's folder", () => {
		expect(worktreeFilePath("/home/me/repo", "src/app.ts")).toBe("/home/me/repo/src/app.ts");
		expect(worktreeFilePath("/home/me/repo/", "docs")).toBe("/home/me/repo/docs");
	});

	test("uses a Windows folder's own separator", () => {
		expect(worktreeFilePath("C:\\work\\repo", "src/app.ts")).toBe("C:\\work\\repo\\src\\app.ts");
	});
});
