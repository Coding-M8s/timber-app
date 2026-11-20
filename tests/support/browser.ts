import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";

/**
 * A real browser for the few tests that need one: focus, typing, and pointer
 * drags, which a test without a window cannot act out. It uses the Chrome or
 * Chromium that is installed, over its debugging protocol, so the project
 * needs no browser package. Where there is none, `browserPath` is null and
 * those tests are skipped, as the tests on real repositories are without Timber.
 */
export const browserPath: string | null = (() => {
	const named = process.env.CHROME_BIN;
	if (named) return named;
	for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
		const found = Bun.which(name);
		if (found) return found;
	}
	return null;
})();

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
	Enter: { code: "Enter", keyCode: 13, text: "\r" },
	Escape: { code: "Escape", keyCode: 27 },
	" ": { code: "Space", keyCode: 32, text: " " },
	ArrowUp: { code: "ArrowUp", keyCode: 38 },
	ArrowDown: { code: "ArrowDown", keyCode: 40 },
	Home: { code: "Home", keyCode: 36 },
	End: { code: "End", keyCode: 35 },
	F10: { code: "F10", keyCode: 121 },
};

const MODIFIERS = { alt: 1, shift: 8 } as const;

export interface BrowserPage {
	/** Load the test page again, with the app as it starts. */
	reload(): Promise<void>;
	/** Run an expression in the page and answer its value. A promise is waited for. */
	evaluate<Value>(expression: string): Promise<Value>;
	/** Wait until an expression is true in the page. Throws with `what` when it never is. */
	until(expression: string, what: string): Promise<void>;
	/** The middle of the first element that matches, scrolled into view first. */
	middle(selector: string): Promise<{ x: number; y: number; top: number; bottom: number }>;
	/** A real click on the first element that matches. */
	click(selector: string): Promise<void>;
	/** Press at one point, move in steps to another, and stop there, still pressed. */
	dragTo(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
	/** Let go of the pointer where it is. */
	release(): Promise<void>;
	/** Press and release a key, as the keyboard would. */
	press(key: keyof typeof KEYS, modifier?: keyof typeof MODIFIERS): Promise<void>;
	/** Type text into whatever has the keyboard. */
	type(text: string): Promise<void>;
	close(): Promise<void>;
}

/** Start the page server and the browser, and open the test page. */
export async function openSidebarPage(): Promise<BrowserPage> {
	if (browserPath === null) throw new Error("No browser is installed.");
	const root = resolve(import.meta.dirname, "../..");
	const entry = `/@fs/${resolve(import.meta.dirname, "sidebar-page.tsx").replaceAll("\\", "/").replace(/^\//, "")}`;
	const html = `<!doctype html><html><head><meta charset="utf-8"><title>Timber test</title></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`;
	const server = await createServer({
		configFile: join(root, "vite.config.ts"),
		logLevel: "silent",
		clearScreen: false,
		server: { port: 0, host: "127.0.0.1", strictPort: false, fs: { allow: [root] } },
		plugins: [{
			name: "timber-test-page",
			configureServer(dev) {
				dev.middlewares.use("/timber-test.html", (request, response) => {
					void dev.transformIndexHtml(request.url ?? "/", html).then(page => {
						response.setHeader("content-type", "text/html");
						response.end(page);
					});
				});
			},
		}],
	});
	await server.listen();
	const address = server.httpServer?.address();
	if (!address || typeof address === "string") throw new Error("The page server did not start.");
	const url = `http://127.0.0.1:${address.port}/timber-test.html`;

	const profile = await mkdtemp(join(tmpdir(), "timber-app-browser-"));
	const browser = spawn(browserPath, [
		"--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1300,900",
		"--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
		"--disable-sync", "--disable-extensions", "--no-sandbox", "about:blank",
	], { stdio: ["ignore", "ignore", "pipe"] });
	const debugUrl = await new Promise<string>((found, failed) => {
		let seen = "";
		const timer = setTimeout(() => failed(new Error(`The browser did not start: ${seen.slice(0, 300)}`)), 20_000);
		browser.stderr.on("data", (chunk: Buffer) => {
			seen += chunk.toString();
			const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
			if (!match) return;
			clearTimeout(timer);
			found(match[1]!);
		});
		browser.once("exit", () => failed(new Error(`The browser ended early: ${seen.slice(0, 300)}`)));
	});
	const port = new URL(debugUrl).port;
	const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((opened, failed) => {
		socket.addEventListener("open", () => opened(), { once: true });
		socket.addEventListener("error", () => failed(new Error("Could not reach the browser.")), { once: true });
	});

	let lastId = 0;
	const waiting = new Map<number, { done: (value: unknown) => void; failed: (error: Error) => void }>();
	socket.addEventListener("message", event => {
		const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
		if (message.id === undefined) return;
		const entry = waiting.get(message.id);
		if (!entry) return;
		waiting.delete(message.id);
		if (message.error) entry.failed(new Error(message.error.message));
		else entry.done(message.result);
	});
	const send = <Result = unknown>(method: string, params: Record<string, unknown> = {}) => new Promise<Result>((done, failed) => {
		lastId += 1;
		waiting.set(lastId, { done: done as (value: unknown) => void, failed });
		socket.send(JSON.stringify({ id: lastId, method, params }));
	});

	async function evaluate<Value>(expression: string): Promise<Value> {
		const answer = await send<{ result: { value: Value }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
			"Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true },
		);
		if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
		return answer.result.value;
	}

	async function until(expression: string, what: string): Promise<void> {
		for (let round = 0; round < 200; round += 1) {
			if (await evaluate<boolean>(`Boolean(${expression})`)) return;
			await Bun.sleep(25);
		}
		throw new Error(`Never happened: ${what}`);
	}

	async function load(): Promise<void> {
		await send("Page.navigate", { url });
		await until(`document.querySelector(".group-header") && window.timberTestStore && window.timberTestStore.getState().loaded`, "the sidebar showed its repositories");
	}

	const mouse = (type: string, at: { x: number; y: number }, pressed: boolean) =>
		send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: type === "mouseMoved" && !pressed ? "none" : "left", buttons: pressed ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "mouse" });
	let pointer = { x: 0, y: 0 };

	async function middle(selector: string) {
		const box = await evaluate<{ x: number; y: number; top: number; bottom: number } | null>(`(() => {
			const element = document.querySelector(${JSON.stringify(selector)});
			if (!element) return null;
			element.scrollIntoView({ block: "nearest" });
			const box = element.getBoundingClientRect();
			return { x: box.left + Math.min(box.width / 2, 60), y: box.top + box.height / 2, top: box.top, bottom: box.bottom };
		})()`);
		if (!box) throw new Error(`Nothing matches ${selector}`);
		// A scroll puts an open menu away, so let its event be handled before anything is opened.
		await Bun.sleep(30);
		return box;
	}

	await send("Page.enable");
	await send("Runtime.enable");
	await load();

	return {
		reload: load,
		evaluate,
		until,
		middle,
		async click(selector) {
			const at = await middle(selector);
			await mouse("mouseMoved", at, false);
			await mouse("mousePressed", at, true);
			await mouse("mouseReleased", at, false);
			pointer = at;
		},
		async dragTo(from, to) {
			await mouse("mouseMoved", from, false);
			await mouse("mousePressed", from, true);
			for (let step = 1; step <= 6; step += 1) {
				await mouse("mouseMoved", { x: from.x + (to.x - from.x) * step / 6, y: from.y + (to.y - from.y) * step / 6 }, true);
			}
			pointer = to;
		},
		async release() {
			await mouse("mouseReleased", pointer, false);
		},
		async press(key, modifier) {
			const { code, keyCode, text } = KEYS[key]!;
			const modifiers = modifier ? MODIFIERS[modifier] : 0;
			const typed = modifiers === 0 ? text : undefined;
			await send("Input.dispatchKeyEvent", { type: typed === undefined ? "rawKeyDown" : "keyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(typed === undefined ? {} : { text: typed }) });
			await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
		},
		async type(text) {
			await send("Input.insertText", { text });
		},
		async close() {
			socket.close();
			browser.kill();
			await server.close();
			await rm(profile, { recursive: true, force: true }).catch(() => {});
		},
	};
}
