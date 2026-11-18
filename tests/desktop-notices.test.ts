import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NoticeProcess, createDesktopNotices, noticeArguments, plainBody } from "../src/bun/desktop-notices";

const notice = { session: "s1", title: "Codex needs you", body: "In feat: approve <b>Write</b> & go" };

/** A pretend `notify-send` the test ends by hand, with what it prints and its exit code. */
function pretend() {
	const started: { argv: string[]; end: (output: string, exitCode?: number) => void; killed: boolean }[] = [];
	const spawn = (argv: string[]): NoticeProcess => {
		let end: (result: { output: string; exitCode: number | null }) => void = () => {};
		const result = new Promise<{ output: string; exitCode: number | null }>(resolve => {
			end = resolve;
		});
		const entry = { argv, end: (output: string, exitCode = 0) => end({ output, exitCode }), killed: false };
		started.push(entry);
		return { result, kill: () => {
			entry.killed = true;
			end({ output: "", exitCode: null });
		} };
	};
	return { started, spawn };
}

describe("desktop notifications", () => {
	let bin: string;

	beforeAll(() => {
		bin = mkdtempSync(join(tmpdir(), "timber-app-notify-"));
		writeFileSync(join(bin, "notify-send"), "#!/bin/sh\nexit 0\n");
		chmodSync(join(bin, "notify-send"), 0o755);
	});

	afterAll(() => {
		rmSync(bin, { recursive: true, force: true });
	});

	test("the body is plain text, never markup or links", () => {
		expect(plainBody("a <a href=\"x\">link</a> & more")).toBe("a &lt;a href=\"x\"&gt;link&lt;/a&gt; &amp; more");
	});

	test("notify-send gets the title and body as arguments after --, and waits for a click", () => {
		expect(noticeArguments("/usr/bin/notify-send", { title: "-x Codex", body: "a & b" }))
			.toEqual(["/usr/bin/notify-send", "--app-name=Timber", "--wait", "--action=default=Show", "--", "-x Codex", "a &amp; b"]);
	});

	test("a click on the notification shows its session", async () => {
		const { started, spawn } = pretend();
		const clicked: string[] = [];
		const fallbacks: unknown[] = [];
		const notices = createDesktopNotices({ path: bin, platform: "linux", spawn, fallback: shown => fallbacks.push(shown), onClick: id => clicked.push(id) });
		notices.show(notice);
		expect(started[0]!.argv[0]).toBe(join(bin, "notify-send"));
		started[0]!.end("default\n");
		await Bun.sleep(0);
		expect(clicked).toEqual(["s1"]);
		expect(fallbacks).toEqual([]);
	});

	test("a notification closed without a click does nothing", async () => {
		const { started, spawn } = pretend();
		const clicked: string[] = [];
		const notices = createDesktopNotices({ path: bin, platform: "linux", spawn, fallback: () => {}, onClick: id => clicked.push(id) });
		notices.show(notice);
		started[0]!.end("");
		await Bun.sleep(0);
		expect(clicked).toEqual([]);
	});

	test("without notify-send, or off Linux, Electrobun shows it, and it cannot answer a click", () => {
		for (const [path, platform] of [["/nowhere", "linux"], [bin, "darwin"]] as const) {
			const { started, spawn } = pretend();
			const fallbacks: unknown[] = [];
			createDesktopNotices({ path, platform, spawn, fallback: shown => fallbacks.push(shown), onClick: () => {} }).show(notice);
			expect(started).toEqual([]);
			expect(fallbacks).toEqual([{ title: notice.title, body: notice.body }]);
		}
	});

	test("a notify-send that fails later, after it showed the notification, is not shown again and is still used", async () => {
		const { started, spawn } = pretend();
		let clock = 0;
		const fallbacks: unknown[] = [];
		const notices = createDesktopNotices({ path: bin, platform: "linux", spawn, now: () => clock, fallback: shown => fallbacks.push(shown), onClick: () => {} });
		notices.show(notice);
		clock = 60_000;
		started[0]!.end("", 1);
		await Bun.sleep(0);
		expect(fallbacks).toEqual([]);
		notices.show(notice);
		expect(started).toHaveLength(2);
	});

	test("a notify-send that fails, such as one too old for --wait, is not used again", async () => {
		const { started, spawn } = pretend();
		const fallbacks: unknown[] = [];
		const notices = createDesktopNotices({ path: bin, platform: "linux", spawn, fallback: shown => fallbacks.push(shown), onClick: () => {} });
		notices.show(notice);
		started[0]!.end("", 1);
		await Bun.sleep(0);
		expect(fallbacks).toHaveLength(1);
		notices.show(notice);
		expect(started).toHaveLength(1);
		expect(fallbacks).toHaveLength(2);
	});

	test("at most 16 wait for a click, and quitting stops them all", async () => {
		const { started, spawn } = pretend();
		const clicked: string[] = [];
		const fallbacks: unknown[] = [];
		const notices = createDesktopNotices({ path: bin, platform: "linux", spawn, fallback: shown => fallbacks.push(shown), onClick: id => clicked.push(id) });
		for (let count = 0; count < 17; count += 1) notices.show({ ...notice, session: `s${count}` });
		expect(started[0]!.killed).toBe(true);
		expect(started.slice(1).every(entry => !entry.killed)).toBe(true);
		await Bun.sleep(0);
		// One that stopped waiting because there were too many is not a failure.
		expect(fallbacks).toEqual([]);
		notices.stopAll();
		expect(started.every(entry => entry.killed)).toBe(true);
		notices.show(notice);
		expect(started).toHaveLength(17);
		expect(clicked).toEqual([]);
	});
});
