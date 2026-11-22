import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Files dropped on a session in a real browser, over the mock engine. The
 * drags are made in the page, with the data types WebKitGTK gives a page for
 * a drop from a file manager. What reaches the session is read from
 * `writeTerminal`. That a drop never makes the window open the file is up to
 * the main process too, and is checked by hand (see the PR).
 */

const STORE = "window.timberTestStore";
const SCREEN = ".terminal-screen";

/** Open a session in the selected worktree, show it, and record what is typed into it on `window.written`. */
const OPEN_SESSION = `(async () => {
	const store = ${STORE};
	const { repository, worktree } = store.getState().selection;
	const path = store.getState().repositories.find(candidate => candidate.path === repository).worktrees.find(candidate => candidate.id === worktree).path;
	const session = await store.openTerminal({ repository, worktree: path, cols: 80, rows: 24 });
	window.written = [];
	const write = store.writeTerminal.bind(store);
	store.writeTerminal = (id, data) => {
		window.written.push({ id, data });
		write(id, data);
	};
	return session?.id ?? store.getState().terminals.at(-1).id;
})()`;

/** Fire a drag event at an element with a fresh DataTransfer holding `data`, or the one in `window.dragged`. Answers whether the page took it. */
const fire = (selector: string, type: string, data: Record<string, string> | null) => `(() => {
	const element = document.querySelector(${JSON.stringify(selector)});
	let transfer = window.dragged;
	if (${JSON.stringify(data)} !== null) {
		transfer = new DataTransfer();
		for (const [kind, value] of Object.entries(${JSON.stringify(data ?? {})})) transfer.setData(kind, value);
	}
	const event = new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: transfer });
	element.dispatchEvent(event);
	return event.defaultPrevented;
})()`;

const WEBKIT_DROP = (uri: string) => ({ "text/uri-list": "", "text/html": `<a style="text-decoration: none;">${uri}</a>` });
const WRITTEN = `window.written.map(entry => entry.data).join("")`;

describe.skipIf(browserPath === null || process.platform === "win32")("files dropped on a session in a real browser", () => {
	let page: BrowserPage;
	let session = "";

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`${STORE}.getState().selection !== null`, "a worktree was selected");
		session = await page.evaluate<string>(OPEN_SESSION);
		await page.until(`document.querySelector(${JSON.stringify(`${SCREEN}[data-drop-session="${session}"] .xterm`)}) !== null`, "the session's terminal showed");
	}, 30_000);

	test("a file dragged over a session shows it as a place to drop, and dropped there pastes its quoted path with a space after it", async () => {
		const drop = WEBKIT_DROP("file:///home/me/it's%20a%20%C4%87ma%20%22x%22.txt");
		expect(await page.evaluate<boolean>(fire(".xterm-screen", "dragover", drop))).toBe(true);
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(SCREEN)}).classList.contains("drop-target")`)).toBe(true);
		expect(await page.evaluate<boolean>(fire(".xterm-screen", "drop", drop))).toBe(true);
		await page.until(`${WRITTEN}.includes("ma")`, "the path reached the session");
		expect(await page.evaluate<string>(WRITTEN)).toBe(`'/home/me/it'\\''s a ćma "x".txt' `);
		expect(await page.evaluate<string[]>(`[...new Set(window.written.map(entry => entry.id))]`)).toEqual([session]);
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(SCREEN)}).classList.contains("drop-target")`)).toBe(false);
	}, 30_000);

	test("several files in a URI list paste as several paths, and a folder as its path", async () => {
		const drop = { "text/uri-list": "file:///home/me/a.txt\r\nfile:///home/me/b%20c.md\r\nfile:///home/me/a%20folder/\r\n" };
		await page.evaluate(fire(SCREEN, "dragover", drop));
		await page.evaluate(fire(SCREEN, "drop", drop));
		await page.until(`${WRITTEN}.includes("folder")`, "the paths reached the session");
		expect(await page.evaluate<string>(WRITTEN)).toBe("/home/me/a.txt '/home/me/b c.md' '/home/me/a folder' ");
	}, 30_000);

	test("a file dropped outside a session does nothing, and the page still takes it so the webview does not open it", async () => {
		const drop = WEBKIT_DROP("file:///home/me/x.txt");
		expect(await page.evaluate<boolean>(fire(".sidebar", "dragover", drop))).toBe(true);
		expect(await page.evaluate<boolean>(`document.querySelector(".drop-target") === null`)).toBe(true);
		expect(await page.evaluate<boolean>(fire(".sidebar", "drop", drop))).toBe(true);
		await Bun.sleep(100);
		expect(await page.evaluate<string>(WRITTEN)).toBe("");
		expect(await page.evaluate<string>(`location.pathname`)).toBe("/timber-test.html");
	}, 30_000);

	test("dragged text is left alone", async () => {
		expect(await page.evaluate<boolean>(fire(SCREEN, "dragover", { "text/plain": "/home/me/x.txt" }))).toBe(false);
		expect(await page.evaluate<boolean>(fire(SCREEN, "drop", { "text/plain": "/home/me/x.txt" }))).toBe(false);
		expect(await page.evaluate<string>(WRITTEN)).toBe("");
	}, 30_000);

	test("an ended session is not a place to drop", async () => {
		await page.evaluate(`window.timberTestEngine.endTerminal(${JSON.stringify(session)}, 0)`);
		await page.until(`document.querySelector('${SCREEN}[data-drop-session]') === null`, "the ended session stopped taking drops");
		const drop = WEBKIT_DROP("file:///home/me/x.txt");
		await page.evaluate(fire(SCREEN, "dragover", drop));
		expect(await page.evaluate<boolean>(`document.querySelector(".drop-target") === null`)).toBe(true);
		await page.evaluate(fire(SCREEN, "drop", drop));
		expect(await page.evaluate<string>(WRITTEN)).toBe("");
	}, 30_000);

	test("a file or a folder dragged from the Files panel onto a session pastes its absolute path", async () => {
		const worktreePath = await page.evaluate<string>(`(() => {
			const { repository, worktree } = ${STORE}.getState().selection;
			return ${STORE}.getState().repositories.find(candidate => candidate.path === repository).worktrees.find(candidate => candidate.id === worktree).path;
		})()`);
		await page.click("#titlebar-files");
		await page.until(`document.querySelector('[data-row="README.md"]') !== null`, "the tree was read");
		for (const [row, path] of [["README.md", `${worktreePath}/README.md`], ["docs", `${worktreePath}/docs`]] as const) {
			await page.evaluate(`window.written = []`);
			expect(await page.evaluate<string | null>(`document.querySelector('[data-row="${row}"]').getAttribute("draggable")`)).toBe("true");
			await page.evaluate(`(() => {
				window.dragged = new DataTransfer();
				document.querySelector('[data-row="${row}"]').dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.dragged }));
			})()`);
			expect(await page.evaluate<boolean>(fire(SCREEN, "dragover", null))).toBe(true);
			expect(await page.evaluate<boolean>(fire(SCREEN, "drop", null))).toBe(true);
			await page.until(`${WRITTEN}.length > 0`, `the path of ${row} reached the session`);
			expect(await page.evaluate<string>(WRITTEN)).toBe(`${path} `);
		}
	}, 30_000);
});
