import { describe, expect, test } from "bun:test";
import { createDesktopNotices } from "../src/bun/desktop-notices";
import type { NotificationServer } from "../src/bun/notification-server";
import { TOAST_SCRIPT, TOAST_VARIABLES, type ToastProcess, connectToastHost, dismissalEndsToast, parseToastLine, showLine, toastArguments, withdrawLine } from "../src/bun/windows-toasts";

const settle = async () => {
	for (let round = 0; round < 10; round += 1) await Bun.sleep(0);
};
const fromBase64 = (text: string) => Buffer.from(text, "base64").toString("utf8");

/** A toast script the test drives: it records what the app wrote and prints what the test says. */
function fakeProcess() {
	const written: string[] = [];
	const handlers: ((line: string) => void)[] = [];
	let exit!: (code: number | null) => void;
	let killed = false;
	let errors = "";
	const process: ToastProcess = {
		write: text => void written.push(text),
		onLine: handler => void handlers.push(handler),
		exited: new Promise<number | null>(resolve => {
			exit = resolve;
		}),
		errorOutput: () => errors,
		kill: () => {
			killed = true;
			exit(null);
		},
	};
	return {
		process,
		written,
		print: (line: string) => handlers.forEach(handler => handler(line)),
		exit: (code: number | null = 0, errorOutput = "") => {
			errors = errorOutput;
			exit(code);
		},
		killed: () => killed,
	};
}

function start(fake = fakeProcess(), readyMilliseconds?: number, problems: string[] = []) {
	const spawned: { argv: string[]; environment: Record<string, string> }[] = [];
	const connecting = connectToastHost({
		onProblem: message => void problems.push(message),
		...(readyMilliseconds === undefined ? {} : { readyMilliseconds }),
		powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
		aumid: "com.example.app",
		displayName: "Example",
		iconFile: "C:\\App\\Resources\\app.ico",
		spawn: (argv, environment) => {
			spawned.push({ argv, environment });
			return fake.process;
		},
	});
	return { fake, spawned, connecting };
}

async function ready(fake = fakeProcess()) {
	const started = start(fake);
	fake.print("ready");
	return { ...started, server: await started.connecting };
}

const request = (replacesId = 0, summary = "Codex is done", body = "In feat: Done", silent = false): Parameters<NotificationServer["notify"]>[0] => ({
	appName: "Timber",
	replacesId,
	icon: "",
	summary,
	body,
	actions: ["default", "Show"],
	hints: silent ? { "suppress-sound": { signature: "b", value: true } } : {},
	timeout: -1,
});

describe("toast lines", () => {
	test("a toast's texts go as base64 of UTF-8, so spaces, newlines, and markup reach it as written", () => {
		const line = showLine(7, "Needs you: Claude", "In feat: <b>x</b> & y\nnext ✓", true);
		expect(line.endsWith("\n")).toBe(true);
		const parts = line.trimEnd().split(" ");
		expect(parts.slice(0, 3)).toEqual(["show", "7", "1"]);
		expect(parts).toHaveLength(5);
		expect(fromBase64(parts[3]!)).toBe("Needs you: Claude");
		expect(fromBase64(parts[4]!)).toBe("In feat: <b>x</b> & y\nnext ✓");
		expect(showLine(1, "", "", false)).toBe("show 1 0  \n");
		expect(withdrawLine(12)).toBe("withdraw 12\n");
	});

	test("only the lines the script prints are read", () => {
		expect(parseToastLine("ready")).toEqual({ kind: "ready" });
		expect(parseToastLine("ready\r")).toEqual({ kind: "ready" });
		expect(parseToastLine("error")).toEqual({ kind: "error" });
		expect(parseToastLine("activated 3")).toEqual({ kind: "activated", tag: 3 });
		expect(parseToastLine("dismissed 3 2")).toEqual({ kind: "dismissed", tag: 3, reason: 2 });
		expect(parseToastLine("dismissed 3 -1")).toEqual({ kind: "dismissed", tag: 3, reason: -1 });
		for (const line of ["", "activated", "activated 0", "activated x", "activated 3 4", "dismissed 3", "dismissed 3 x", "hello 3", "ready now"]) {
			expect(parseToastLine(line)).toBeNull();
		}
	});

	test("a toast that timed out stays in the notification center; one closed or hidden is gone", () => {
		expect(dismissalEndsToast(0)).toBe(true);
		expect(dismissalEndsToast(1)).toBe(true);
		expect(dismissalEndsToast(2)).toBe(false);
	});

	test("the script goes in encoded and its identity in the environment, never in its text", () => {
		const argv = toastArguments("powershell.exe");
		expect(argv.slice(0, 7)).toEqual(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
		expect(Buffer.from(argv[7]!, "base64").toString("utf16le")).toBe(TOAST_SCRIPT);
		for (const variable of Object.values(TOAST_VARIABLES)) expect(TOAST_SCRIPT).toContain(`$env:${variable}`);
		// Texts become XML text nodes, never markup.
		expect(TOAST_SCRIPT).toContain("CreateTextNode");
		expect(TOAST_SCRIPT).not.toContain("Invoke-Expression");
		expect(TOAST_SCRIPT).not.toContain("\u2014");
	});
});

describe("connectToastHost", () => {
	test("starts the script with the app's identity and resolves once it is ready", async () => {
		const { fake, spawned, connecting } = start();
		let resolved = false;
		void connecting.then(() => {
			resolved = true;
		});
		await settle();
		expect(resolved).toBe(false);
		fake.print("ready");
		const server = await connecting;
		expect(spawned).toHaveLength(1);
		expect(spawned[0]!.environment).toEqual({ [TOAST_VARIABLES.aumid]: "com.example.app", [TOAST_VARIABLES.name]: "Example", [TOAST_VARIABLES.icon]: "C:\\App\\Resources\\app.ico" });
		expect(await server.capabilities()).toEqual(["actions", "body"]);
	});

	test("rejects when the script ends before it is ready, saying how it ended", async () => {
		const { fake, connecting } = start();
		fake.exit(1, "Add-Type : Cannot add type.\r\n  At line:9\r\n");
		await expect(connecting).rejects.toThrow("The toast script ended before it was ready (exit code 1: Add-Type : Cannot add type. At line:9)");
	});

	test("a script that ends while in use, or cannot show a toast, is reported as a problem", async () => {
		const fake = fakeProcess();
		const problems: string[] = [];
		const started = start(fake, undefined, problems);
		fake.print("ready");
		await started.connecting;
		fake.print("error");
		fake.exit(255, "");
		await settle();
		expect(problems).toEqual(["The toast script could not show or withdraw a toast", "The toast script ended (exit code 255)"]);
	});

	test("rejects and stops the script when it takes too long", async () => {
		const { fake, connecting } = start(fakeProcess(), 5);
		await expect(connecting).rejects.toThrow("did not start in time");
		expect(fake.killed()).toBe(true);
	});

	test("a new notification gets a new tag, and one that replaces another keeps its tag", async () => {
		const { fake, server } = await ready();
		expect(await server.notify(request())).toBe(1);
		expect(await server.notify(request())).toBe(2);
		expect(await server.notify(request(1, "Again", "Body", true))).toBe(1);
		expect(fake.written).toEqual([showLine(1, "Codex is done", "In feat: Done", false), showLine(2, "Codex is done", "In feat: Done", false), showLine(1, "Again", "Body", true)]);
		await server.close(2);
		expect(fake.written.at(-1)).toBe(withdrawLine(2));
	});

	test("a click is the default action, and a dismissal that ends the toast closes it", async () => {
		const { fake, server } = await ready();
		const actions: [number, string][] = [];
		const closed: number[] = [];
		server.onActionInvoked((id, key) => actions.push([id, key]));
		server.onClosed(id => closed.push(id));
		fake.print("activated 4");
		fake.print("dismissed 5 2");
		fake.print("dismissed 6 0");
		fake.print("activated nope");
		expect(actions).toEqual([[4, "default"]]);
		expect(closed).toEqual([6]);
	});

	test("the script ending tells the app, unless the app stopped it", async () => {
		const first = await ready();
		let gone = 0;
		first.server.onDisconnect(() => (gone += 1));
		first.fake.exit();
		await settle();
		expect(gone).toBe(1);
		await expect(first.server.notify(request())).rejects.toThrow("not running");

		const second = await ready();
		let goneAgain = 0;
		second.server.onDisconnect(() => (goneAgain += 1));
		second.server.disconnect();
		expect(second.fake.written.at(-1)).toBe("stop\n");
		second.fake.exit();
		await settle();
		expect(goneAgain).toBe(0);
		// Nothing more is written once it was asked to stop.
		await second.server.close(1);
		second.server.disconnect();
		expect(second.fake.written).toEqual(["stop\n"]);
	});
});

describe("desktop notices on Windows", () => {
	function windows() {
		const fake = fakeProcess();
		const clicks: [string, string | null][] = [];
		const fallbacks: { title: string; body: string }[] = [];
		const notices = createDesktopNotices({
			path: "",
			platform: "win32",
			connect: () => {
				const started = start(fake);
				fake.print("ready");
				return started.connecting;
			},
			fallback: notice => void fallbacks.push(notice),
			onClick: (session, token) => void clicks.push([session, token]),
		});
		return { fake, clicks, fallbacks, notices };
	}

	test("each session has one toast, replaced in place, withdrawn, and clicked through to its session", async () => {
		const { fake, clicks, fallbacks, notices } = windows();
		notices.show({ session: "a", title: "Codex is done", body: "In feat: <b>x</b>" }, { withSound: false });
		notices.show({ session: "b", title: "Needs you", body: "In b" }, { withSound: true });
		await settle();
		notices.show({ session: "a", title: "Error", body: "In feat" }, { withSound: false });
		await settle();
		// The body is not escaped: a toast never reads markup.
		expect(fake.written).toEqual([showLine(1, "Codex is done", "In feat: <b>x</b>", false), showLine(2, "Needs you", "In b", true), showLine(1, "Error", "In feat", false)]);
		fake.print("activated 2");
		expect(clicks).toEqual([["b", null]]);
		notices.withdraw("b");
		notices.withdraw("a");
		await settle();
		// b was clicked, so it is already gone; only a is withdrawn.
		expect(fake.written.slice(3)).toEqual([withdrawLine(1)]);
		expect(fallbacks).toEqual([]);
	});

	test("a toast that timed out can still be clicked; one the person closed is forgotten", async () => {
		const { fake, clicks, notices } = windows();
		notices.show({ session: "a", title: "t", body: "b" }, { withSound: false });
		notices.show({ session: "b", title: "t", body: "b" }, { withSound: false });
		await settle();
		fake.print("dismissed 1 2");
		fake.print("dismissed 2 0");
		fake.print("activated 1");
		fake.print("activated 2");
		expect(clicks).toEqual([["a", null]]);
		notices.show({ session: "b", title: "t", body: "b" }, { withSound: false });
		await settle();
		expect(fake.written.at(-1)).toBe(showLine(3, "t", "b", false));
	});

	test("Electrobun shows it when the script cannot start", async () => {
		const fallbacks: { title: string; body: string }[] = [];
		const notices = createDesktopNotices({
			path: "",
			platform: "win32",
			connect: () => Promise.reject(new Error("Windows PowerShell was not found")),
			fallback: notice => void fallbacks.push(notice),
			onClick: () => {},
		});
		notices.show({ session: "a", title: "Codex is done", body: "In feat" }, { withSound: false });
		await settle();
		expect(fallbacks).toEqual([{ title: "Codex is done", body: "In feat" }]);
	});

	test("quitting asks the script to stop, which takes the app's toasts away", async () => {
		const { fake, notices } = windows();
		notices.show({ session: "a", title: "t", body: "b" }, { withSound: false });
		await settle();
		await notices.stopAll();
		expect(fake.written.slice(1)).toEqual([withdrawLine(1), "stop\n"]);
	});
});
