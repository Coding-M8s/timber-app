import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DBusTimeoutError } from "../src/bun/dbus";
import { createDesktopNotices, noticeArguments, plainBody, serverBody } from "../src/bun/desktop-notices";
import type { NotificationRequest, NotificationServer } from "../src/bun/notification-server";

const settle = async () => {
	for (let round = 0; round < 10; round += 1) await Bun.sleep(0);
};
const notice = (session = "s", body = "In feat: Done") => ({ session, title: "Codex is done", body });

/** A notification server the test drives: it records calls, answers ids in order, and sends signals on demand. */
function fakeServer(capabilities: string[] | null = ["actions", "body", "body-markup", "sound"]) {
	const calls: ({ kind: "notify"; request: NotificationRequest } | { kind: "close"; id: number })[] = [];
	const handlers = { action: [] as ((id: number, key: string) => void)[], token: [] as ((id: number, token: string) => void)[], closed: [] as ((id: number, reason: number) => void)[], gone: [] as (() => void)[], restart: [] as (() => void)[] };
	/** Make the next Notify fail with this error. */
	let failNext: Error | null = null;
	let next = 1;
	let disconnected = false;
	/** Hold the next Notify answer until `release` is called. */
	let hold: Promise<void> | null = null;
	const server: NotificationServer = {
		capabilities: async () => {
			if (capabilities === null) throw new Error("no answer");
			return capabilities;
		},
		async notify(request) {
			calls.push({ kind: "notify", request });
			if (hold) await hold;
			if (failNext) {
				const error = failNext;
				failNext = null;
				throw error;
			}
			return request.replacesId !== 0 ? request.replacesId : next++;
		},
		async close(id) {
			calls.push({ kind: "close", id });
		},
		onActionInvoked: handler => void handlers.action.push(handler),
		onActivationToken: handler => void handlers.token.push(handler),
		onClosed: handler => void handlers.closed.push(handler),
		onRestart: handler => void handlers.restart.push(handler),
		onDisconnect: handler => void handlers.gone.push(handler),
		disconnect: () => {
			disconnected = true;
		},
	};
	return {
		server,
		calls,
		click: (id: number, token?: string) => {
			if (token !== undefined) for (const handler of handlers.token) handler(id, token);
			for (const handler of handlers.action) handler(id, "default");
		},
		closed: (id: number) => handlers.closed.forEach(handler => handler(id, 2)),
		drop: () => handlers.gone.forEach(handler => handler()),
		restart: () => handlers.restart.forEach(handler => handler()),
		failNotify: (error: Error) => {
			failNext = error;
		},
		holdNotify: () => {
			let release!: () => void;
			hold = new Promise(resolve => {
				release = () => {
					hold = null;
					resolve();
				};
			});
			return release;
		},
		disconnected: () => disconnected,
	};
}

function setup(fake = fakeServer(), more: Partial<Parameters<typeof createDesktopNotices>[0]> = {}) {
	const clicks: [string, string | null][] = [];
	const fallbacks: { title: string; body: string }[] = [];
	const spawned: string[][] = [];
	let connects = 0;
	const notices = createDesktopNotices({
		path: "",
		platform: "linux",
		connect: async () => {
			connects += 1;
			return fake.server;
		},
		spawn: argv => void spawned.push(argv),
		fallback: shown => void fallbacks.push(shown),
		onClick: (session, token) => void clicks.push([session, token]),
		...more,
	});
	return { notices, fake, clicks, fallbacks, spawned, connects: () => connects };
}

describe("plain text in a notification", () => {
	test("&, <, and > become entities, so a program's message is never markup", () => {
		expect(plainBody("a <b>bold</b> & <a href=\"x\">link</a>")).toBe("a &lt;b&gt;bold&lt;/b&gt; &amp; &lt;a href=\"x\"&gt;link&lt;/a&gt;");
	});

	test("escaped unless the server said it reads no markup", () => {
		expect(serverBody("<b>", ["body", "body-markup"])).toBe("&lt;b&gt;");
		expect(serverBody("<b>", null)).toBe("&lt;b&gt;");
		expect(serverBody("<b>", ["body"])).toBe("<b>");
	});

	test("notify-send gets the title after --, so one that starts with - is still the title", () => {
		expect(noticeArguments("/usr/bin/notify-send", { title: "-v", body: "<i>x</i>" })).toEqual(["/usr/bin/notify-send", "--app-name=Timber", "--", "-v", "&lt;i&gt;x&lt;/i&gt;"]);
	});
});

describe("on the session bus", () => {
	test("each notification asks for a Show action, keeps the server quiet when the app plays a sound, and escapes the body", async () => {
		const { notices, fake } = setup();
		notices.show(notice("s", "In feat: <b>approve</b>"), { withSound: true });
		await settle();
		expect(fake.calls).toEqual([{
			kind: "notify",
			request: {
				appName: "Timber", replacesId: 0, icon: "", summary: "Codex is done", body: "In feat: &lt;b&gt;approve&lt;/b&gt;", actions: ["default", "Show"],
				hints: { "urgency": { signature: "y", value: 1 }, "desktop-entry": { signature: "s", value: "Timber" }, "suppress-sound": { signature: "b", value: true } },
				timeout: -1,
			},
		}]);
	});

	test("a session's next notification replaces its first, and another session gets its own", async () => {
		const { notices, fake } = setup();
		notices.show(notice("s"), { withSound: false });
		notices.show(notice("s"), { withSound: false });
		notices.show(notice("t"), { withSound: false });
		await settle();
		expect(fake.calls.map(call => call.kind === "notify" ? call.request.replacesId : -1).sort()).toEqual([0, 0, 1]);
	});

	test("a show and a withdraw right after it run in order, so the withdraw closes the id the server answered", async () => {
		const { notices, fake } = setup();
		const release = fake.holdNotify();
		notices.show(notice("s"), { withSound: false });
		notices.withdraw("s");
		await settle();
		expect(fake.calls.map(call => call.kind)).toEqual(["notify"]);
		release();
		await settle();
		expect(fake.calls.at(-1)).toEqual({ kind: "close", id: 1 });
		// Withdrawn, so the next one is new, not a replacement.
		notices.show(notice("s"), { withSound: false });
		await settle();
		expect(fake.calls.at(-1)).toMatchObject({ kind: "notify", request: { replacesId: 0 } });
	});

	test("a click shows its session with the activation token that came before it", async () => {
		const { notices, fake, clicks } = setup();
		notices.show(notice("s"), { withSound: false });
		notices.show(notice("t"), { withSound: false });
		await settle();
		fake.click(2, "token-for-t");
		fake.click(1);
		fake.click(99, "not ours");
		expect(clicks).toEqual([["t", "token-for-t"], ["s", null]]);
	});

	test("one the server closed is forgotten, so the next for its session is new", async () => {
		const { notices, fake, clicks } = setup();
		notices.show(notice("s"), { withSound: false });
		await settle();
		fake.closed(1);
		fake.click(1);
		expect(clicks).toEqual([]);
		notices.show(notice("s"), { withSound: false });
		await settle();
		expect(fake.calls.at(-1)).toMatchObject({ kind: "notify", request: { replacesId: 0 } });
	});

	test("no Show action when the server has no actions, and the body as it is when it reads no markup", async () => {
		const { notices, fake } = setup(fakeServer(["body"]));
		notices.show(notice("s", "a <b>"), { withSound: false });
		await settle();
		expect(fake.calls[0]).toMatchObject({ kind: "notify", request: { actions: [], body: "a <b>" } });
	});

	test("a lost bus is connected again on the next notification", async () => {
		const { notices, fake, connects } = setup();
		notices.show(notice("s"), { withSound: false });
		await settle();
		fake.drop();
		notices.show(notice("s"), { withSound: false });
		await settle();
		expect(connects()).toBe(2);
		expect(fake.calls.at(-1)).toMatchObject({ kind: "notify", request: { replacesId: 0 } });
	});

	test("a server that restarted gets new notifications, not replacements of ids it never gave", async () => {
		const { notices, fake, clicks } = setup();
		notices.show(notice("s"), { withSound: false });
		await settle();
		fake.restart();
		fake.click(1);
		expect(clicks).toEqual([]);
		notices.show(notice("s"), { withSound: false });
		await settle();
		expect(fake.calls.at(-1)).toMatchObject({ kind: "notify", request: { replacesId: 0 } });
	});

	test("a Notify that timed out is not shown again with notify-send, since the server may still show it", async () => {
		const { notices, fake, spawned } = setup(fakeServer(), { path: "/usr/bin" });
		fake.failNotify(new DBusTimeoutError("The D-Bus call timed out"));
		notices.show(notice("s"), { withSound: false });
		await settle();
		expect(spawned).toEqual([]);
	});

	test("quitting writes each close at once, without waiting for anything", async () => {
		const { notices, fake } = setup();
		notices.show(notice("s"), { withSound: false });
		await settle();
		void notices.stopAll();
		expect(fake.calls.at(-1)).toEqual({ kind: "close", id: 1 });
	});

	test("one the server answers only after quitting began is closed again", async () => {
		const { notices, fake } = setup();
		notices.show(notice("s"), { withSound: false });
		await settle();
		const release = fake.holdNotify();
		notices.show(notice("t"), { withSound: false });
		await settle();
		void notices.stopAll();
		release();
		await settle();
		expect(fake.calls.filter(call => call.kind === "close")).toEqual([{ kind: "close", id: 1 }, { kind: "close", id: 2 }]);
	});

	test("quitting closes every notification it showed and lets go of the bus", async () => {
		const { notices, fake } = setup();
		notices.show(notice("s"), { withSound: false });
		notices.show(notice("t"), { withSound: false });
		await settle();
		await notices.stopAll();
		expect(fake.calls.filter(call => call.kind === "close")).toEqual([{ kind: "close", id: 1 }, { kind: "close", id: 2 }]);
		expect(fake.disconnected()).toBe(true);
		notices.show(notice("s"), { withSound: false });
		await settle();
		expect(fake.calls).toHaveLength(4);
	});
});

describe("without the session bus", () => {
	test("Linux shows it with notify-send by argv, and tries the bus again only a minute later", async () => {
		const folder = mkdtempSync(join(tmpdir(), "timber-notify-"));
		try {
			// Bun.which finds a file on Windows only by an extension in PATHEXT, as a real notify-send.exe would have.
			const executable = join(folder, process.platform === "win32" ? "notify-send.exe" : "notify-send");
			writeFileSync(executable, "#!/bin/sh\nexit 0\n");
			chmodSync(executable, 0o755);
			let clock = 0;
			let tries = 0;
			const { notices, spawned, fallbacks } = setup(fakeServer(), {
				path: folder,
				now: () => clock,
				connect: async () => {
					tries += 1;
					throw new Error("no bus");
				},
			});
			notices.show(notice("s", "a <b>"), { withSound: false });
			await settle();
			notices.show(notice("s"), { withSound: false });
			await settle();
			expect(spawned).toEqual([[executable, "--app-name=Timber", "--", "Codex is done", "a &lt;b&gt;"], [executable, "--app-name=Timber", "--", "Codex is done", "In feat: Done"]]);
			expect(fallbacks).toEqual([]);
			expect(tries).toBe(1);
			clock = 60_000;
			notices.show(notice("s"), { withSound: false });
			await settle();
			expect(tries).toBe(2);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	});

	test("macOS hands it to Electrobun as it is, which cannot be withdrawn", async () => {
		const { notices, fallbacks, connects } = setup(fakeServer(), { platform: "darwin" });
		notices.show(notice("s", "a <b>"), { withSound: false });
		notices.withdraw("s");
		await settle();
		expect(fallbacks).toEqual([{ title: "Codex is done", body: "a <b>" }]);
		expect(connects()).toBe(0);
	});

	test("Windows connects to its notification server, the toast script (see windows-toasts.test.ts)", async () => {
		const { notices, fallbacks, connects } = setup(fakeServer(), { platform: "win32" });
		notices.show(notice("s", "a <b>"), { withSound: false });
		await settle();
		expect(connects()).toBe(1);
		expect(fallbacks).toEqual([]);
	});
});
