import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StatusFolder, openStatusFolder } from "../src/bun/status-files";
import { type TerminalChange, type TerminalOutput } from "../src/shared/terminal";
import { agentBrand } from "../src/shared/session-status";
import type { StatusKind, StatusState } from "../src/shared/program-status";
import { type TerminalSessions, createTerminalSessions, sessionEnvironment } from "../src/bun/terminals";
import { OPENCODE_STATUS_PLUGIN, STATUS_FILE_LIMIT, STATUS_HOOK_SCRIPT, STATUS_VARIABLE, type StatusLine } from "../src/shared/status-hooks";
import type { AgentSetting } from "../src/shared/agent";
import type { Repository } from "../src/shared/model";
import { until } from "./support/runtime";

const posix = process.platform !== "win32";

describe("a session's environment", () => {
	test("names its own status file, never one from the app's environment", () => {
		const inherited = { PATH: "/bin", [STATUS_VARIABLE]: "/run/other/session" };
		expect(sessionEnvironment(inherited, null, "/run/now/abc")[STATUS_VARIABLE]).toBe("/run/now/abc");
		expect(STATUS_VARIABLE in sessionEnvironment(inherited, null, null)).toBe(false);
		expect(STATUS_VARIABLE in sessionEnvironment(inherited, null)).toBe(false);
	});
});

describe.skipIf(!posix)("the status folder", () => {
	let parent: string;
	let folder: StatusFolder;
	let lines: [string, StatusLine][];

	beforeAll(() => {
		parent = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-status-test-")));
	});
	afterAll(() => rmSync(parent, { recursive: true, force: true }));
	afterEach(() => folder?.close());

	async function open() {
		lines = [];
		folder = await openStatusFolder({ parent, onLine: (session, line) => lines.push([session, line]), pollMilliseconds: 0 });
		return folder;
	}

	test("is private; a session's file is made empty, read a whole line at a time, and deleted", async () => {
		await open();
		expect(statSync(folder.path).mode & 0o777).toBe(0o700);
		const file = folder.add("s-1")!;
		expect(file).toBe(join(folder.path, "s-1"));
		expect(statSync(file).size).toBe(0);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		appendFileSync(file, "agent=cursor:event=sessionStart\nagent=cursor:event=st");
		await folder.scan();
		expect(lines).toEqual([["s-1", { agent: "cursor", event: "sessionStart" }]]);
		appendFileSync(file, "op\nnot a line\nagent=cursor:event=beforeSubmitPrompt\n");
		await folder.scan();
		expect(lines.slice(1)).toEqual([["s-1", { agent: "cursor", event: "stop" }], ["s-1", { agent: "cursor", event: "beforeSubmitPrompt" }]]);
		// Read from where it stopped: nothing twice.
		await folder.scan();
		expect(lines).toHaveLength(3);
		folder.remove("s-1");
		expect(await until(() => !existsSync(file))).toBe(true);
	});

	test("a change is seen without being asked, through the watch", async () => {
		await open();
		const file = folder.add("s-2")!;
		appendFileSync(file, "agent=cursor:event=stop\n");
		expect(await until(() => lines.length === 1)).toBe(true);
	});

	test("a file the app does not know, and anything not a regular file, is deleted unread", async () => {
		await open();
		folder.add("known");
		writeFileSync(join(folder.path, "stranger"), "agent=cursor:event=stop\n");
		symlinkSync("/etc/hostname", join(folder.path, "known-link"));
		await folder.scan();
		expect(lines).toEqual([]);
		expect(readdirSync(folder.path)).toEqual(["known"]);
		// A session whose file was swapped for a link reads nothing, and the link goes.
		rmSync(join(folder.path, "known"));
		symlinkSync("/etc/hostname", join(folder.path, "known"));
		await folder.scan();
		expect(lines).toEqual([]);
		expect(existsSync(join(folder.path, "known"))).toBe(false);
	});

	test("a line over the limit is dropped whole; past the file limit, or once it shrank, nothing more is read", async () => {
		await open();
		const file = folder.add("long")!;
		appendFileSync(file, `${"x".repeat(300)}`);
		await folder.scan();
		appendFileSync(file, "agent=cursor:event=stop\nagent=cursor:event=sessionStart\n");
		await folder.scan();
		expect(lines).toEqual([["long", { agent: "cursor", event: "sessionStart" }]]);
		const big = folder.add("big")!;
		appendFileSync(big, `${"agent=cursor:event=stop\n".repeat(Math.ceil(STATUS_FILE_LIMIT / 24) + 10)}`);
		await folder.scan();
		const before = lines.length;
		appendFileSync(big, "agent=cursor:event=sessionStart\n");
		await folder.scan();
		expect(lines.length).toBe(before);
		const shrunk = folder.add("shrunk")!;
		appendFileSync(shrunk, "agent=cursor:event=stop\n");
		await folder.scan();
		writeFileSync(shrunk, "");
		appendFileSync(shrunk, "a\nagent=cursor:event=sessionStart\n");
		await folder.scan();
		expect(lines.filter(([session]) => session === "shrunk")).toHaveLength(1);
	});

	test("a name that is not a session's gets no file, and closing removes the folder", async () => {
		await open();
		expect(folder.add("../escape")).toBeNull();
		expect(folder.add("a/b")).toBeNull();
		const path = folder.path;
		folder.close();
		expect(existsSync(path)).toBe(false);
		expect(folder.add("late")).toBeNull();
	});
});

/**
 * The hook end to end, in real sessions: the script the app writes runs in a
 * session's shell, appends to the session's file, and the session takes the
 * line as its status, by the rules of docs/decision-agent-status-hooks.md.
 */
describe.skipIf(!posix)("status hook lines in a real session", () => {
	let root: string;
	let repository: string;
	let script: string;
	let sessions: TerminalSessions;
	let folder: StatusFolder | null;
	let outputs: TerminalOutput[];
	let changes: TerminalChange[];

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-status-session-")));
		repository = join(root, "repo");
		mkdirSync(join(root, "bin"), { recursive: true });
		mkdirSync(repository);
		script = join(root, "status-hook");
		writeFileSync(script, STATUS_HOOK_SCRIPT, { mode: 0o755 });
		// A stand-in for Claude Code: a shell, so a test can type a hook's command into a session whose program is another agent.
		// With `quit` among its arguments it ends at once, so the person's shell takes over.
		writeFileSync(join(root, "bin", "claude"), '#!/bin/sh\nfor a; do [ "$a" = quit ] && exit 0; done\nexec /bin/sh\n', { mode: 0o755 });
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	afterEach(() => {
		sessions?.killAll();
		folder?.close();
	});

	const listed = (): Repository => ({
		path: repository, name: "repo", available: true, failure: null, setup: "repository", fallbackBase: null,
		worktrees: [{
			id: "id:repo", path: repository, canonicalPath: repository, branch: "main", head: null, primary: true, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
		}],
	});

	async function start(agents: AgentSetting[] = []) {
		outputs = [];
		changes = [];
		folder = await openStatusFolder({ parent: root, onLine: (session, line) => sessions.hookLine(session, line), pollMilliseconds: 50 });
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: output => outputs.push(output),
			onChange: change => changes.push(change),
			agents: async () => agents,
			statusFolder: async () => folder,
			environment: { PATH: `${join(root, "bin")}:${process.env.PATH}`, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8", [STATUS_VARIABLE]: "/inherited/file" },
			closeMilliseconds: 300,
		});
	}

	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");
	const statusOf = (id: string) => changes.filter(change => change.id === id).at(-1)?.session?.status ?? null;

	async function run(id: string, line: string, expected: string) {
		sessions.write(id, `${line}\r`);
		if (!await until(() => printed(id).includes(expected))) throw new Error(`Did not see ${expected}. Printed: ${JSON.stringify(printed(id))}`);
	}

	async function opened(agent?: string) {
		const result = await sessions.open({ repository, worktree: repository, cols: 80, rows: 24, ...(agent ? { agent } : {}) });
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		return result.session;
	}

	test("the session's own file is in its environment, and the hook's events set its status with the agent's mark", async () => {
		await start();
		const session = await opened();
		const file = join(folder!.path, session.id);
		await run(session.id, 'echo "status:$TIMBER_APP_STATUS:end"', `status:${file}:end`);
		await run(session.id, `'${script}' cursor sessionStart; echo ran1`, "ran1\r\n");
		expect(await until(() => statusOf(session.id)?.state === "idle")).toBe(true);
		await run(session.id, `'${script}' cursor beforeSubmitPrompt; echo ran2`, "ran2\r\n");
		expect(await until(() => statusOf(session.id)?.state === "working")).toBe(true);
		expect(statusOf(session.id)).toEqual({ state: "working", kind: null, progress: null, app: "cursor", title: null, message: null });
		await run(session.id, `'${script}' cursor stop; echo ran3`, "ran3\r\n");
		expect(await until(() => statusOf(session.id)?.state === "done")).toBe(true);
		// The script printed nothing, and an event the registry does not map changes nothing.
		await run(session.id, `'${script}' cursor preToolUse; echo ran4`, "ran4\r\n");
		await Bun.sleep(150);
		expect(statusOf(session.id)?.state).toBe("done");
		// Done stays through the exit, as for a report from the stream, and the file goes with the session.
		sessions.write(session.id, "exit 0\r");
		expect(await until(() => changes.at(-1)?.session?.state.kind === "exited")).toBe(true);
		expect(changes.at(-1)!.session!.status?.state).toBe("done");
		expect(await until(() => !existsSync(file))).toBe(true);
	});

	test("Gemini CLI's events set idle, working, needs you, working, and done, with its mark", async () => {
		await start();
		const session = await opened();
		const steps: [string, string][] = [["SessionStart", "idle"], ["BeforeAgent", "working"], ["Notification", "blocked"], ["AfterTool", "working"], ["AfterAgent", "done"]];
		for (const [index, [event, state]] of steps.entries()) {
			// As Gemini CLI's entry runs it: whatever happens, nothing printed.
			await run(session.id, `'${script}' gemini ${event} 2>/dev/null || true; echo gem${index}`, `gem${index}\r\n`);
			expect(await until(() => statusOf(session.id)?.state === state)).toBe(true);
			expect(statusOf(session.id)?.app).toBe("gemini");
		}
		// BeforeTool runs before Gemini CLI asks, and is not mapped.
		await run(session.id, `'${script}' gemini BeforeTool; echo gem9`, "gem9\r\n");
		await Bun.sleep(150);
		expect(statusOf(session.id)?.state).toBe("done");
	});

	test("outside the app's sessions, the script does nothing and exits 0", () => {
		const ran = Bun.spawnSync([script, "cursor", "stop"], { env: { PATH: process.env.PATH } });
		expect(ran.exitCode).toBe(0);
		expect(ran.stdout.length + ran.stderr.length).toBe(0);
	});

	test("a line is dropped while the program reports through its own stream, and taken again after a new prompt", async () => {
		await start();
		const session = await opened();
		await run(session.id, "printf '\\033]7501;state=working:app=claude\\007'; echo sent1", "sent1\r\n");
		expect(await until(() => statusOf(session.id)?.app === "claude")).toBe(true);
		await run(session.id, `'${script}' cursor stop; echo ran1`, "ran1\r\n");
		await Bun.sleep(200);
		expect(statusOf(session.id)).toMatchObject({ state: "working", app: "claude" });
		await run(session.id, "printf '\\033]133;A\\007'; echo sent2", "sent2\r\n");
		await run(session.id, `'${script}' cursor stop; echo ran2`, "ran2\r\n");
		expect(await until(() => statusOf(session.id)?.app === "cursor")).toBe(true);
		expect(statusOf(session.id)?.state).toBe("done");
	});

	test("a line of another agent is dropped in a session that runs a different one", async () => {
		await start([{ name: "Claude Code", command: "claude" }]);
		const session = await opened("Claude Code");
		expect(session.program).toBe("claude");
		await run(session.id, `'${script}' cursor beforeSubmitPrompt; echo ran1`, "ran1\r\n");
		await Bun.sleep(200);
		expect(statusOf(session.id)).toBeNull();
	});

	test("the shell that takes over from an ended agent keeps the file and takes any agent's lines; an ended session takes none", async () => {
		await start([{ name: "Claude Code", command: "claude quit" }]);
		const session = await opened("Claude Code");
		const file = join(folder!.path, session.id);
		expect(await until(() => changes.at(-1)?.session?.kind === "terminal")).toBe(true);
		expect(existsSync(file)).toBe(true);
		await run(session.id, `'${script}' cursor stop; echo ran1`, "ran1\r\n");
		expect(await until(() => statusOf(session.id)?.app === "cursor")).toBe(true);
		sessions.write(session.id, "exit 0\r");
		expect(await until(() => changes.at(-1)?.session?.state.kind === "exited")).toBe(true);
		const count = changes.length;
		sessions.hookLine(session.id, { agent: "cursor", event: "beforeSubmitPrompt" });
		await Bun.sleep(50);
		expect(changes.length).toBe(count);
	});

	test("GitHub Copilot CLI's own reports, as 1.0.116 writes them with no probe, set the session's status with its mark", async () => {
		// Copilot itself is not run: a stand-in writes what it was seen to write, one report for each line typed.
		writeFileSync(join(root, "bin", "copilot"), String.raw`#!/bin/sh
stty -echo
report() { printf '\033]7501;state=%s:app=copilot%s\033\\' "$1" "$2"; }
report idle
while read -r state kind; do report "$state" "$kind"; done
`, { mode: 0o755 });
		await start([{ name: "GitHub Copilot CLI", command: "copilot" }]);
		const session = await opened("GitHub Copilot CLI");
		expect(session.program).toBe("copilot");
		expect(await until(() => statusOf(session.id)?.state === "idle")).toBe(true);
		const steps: [StatusState, StatusKind | null][] = [["working", null], ["blocked", "permission"], ["working", null], ["blocked", "question"], ["working", null], ["done", null], ["working", null], ["error", null]];
		for (const [state, kind] of steps) {
			sessions.write(session.id, `${state}${kind === null ? "" : ` :kind=${kind}`}\r`);
			expect(await until(() => statusOf(session.id)?.state === state)).toBe(true);
			expect(statusOf(session.id)).toEqual({ state, kind, progress: null, app: "copilot", title: null, message: null });
		}
		// The same in a shell the person typed copilot in: the mark comes from the report.
		expect(agentBrand({ kind: "terminal", shell: "/bin/sh", status: statusOf(session.id) })).toBe("copilot");
	});

	test("OpenCode 2's own reports, as 2.4.1 writes them, end a turn in done with OpenCode's mark", async () => {
		// OpenCode is not run here: a stand-in writes what 2.4.1 was seen to write, one report for each line typed.
		writeFileSync(join(root, "bin", "opencode"), String.raw`#!/bin/sh
stty -echo
report() { printf '\033]7501;state=%s:app=opencode%s\033\\' "$1" "$2"; }
report idle
while read -r state kind; do report "$state" "$kind"; done
`, { mode: 0o755 });
		await start([{ name: "OpenCode", command: "opencode" }]);
		const session = await opened("OpenCode");
		expect(await until(() => statusOf(session.id)?.state === "idle")).toBe(true);
		const steps: [string, StatusState][] = [["working", "working"], ["blocked :kind=permission", "blocked"], ["working", "working"], ["idle", "done"]];
		for (const [line, state] of steps) {
			sessions.write(session.id, `${line}\r`);
			expect(await until(() => statusOf(session.id)?.state === state)).toBe(true);
		}
		expect(agentBrand({ kind: "terminal", shell: "/bin/sh", status: statusOf(session.id) })).toBe("opencode");
	});

	test("OpenCode's plugin, driven as OpenCode 1.19.6 would, sets the session's status with OpenCode's mark", async () => {
		// OpenCode is not run here: a Bun program loads the plugin as OpenCode 1 does and replays events shaped as its source sends them.
		writeFileSync(join(root, "timber-app-status.js"), OPENCODE_STATUS_PLUGIN);
		writeFileSync(join(root, "opencode-events.mjs"), [
			`const plugin = Object.values(await import(${JSON.stringify(join(root, "timber-app-status.js"))}))[0];`,
			"const hooks = await plugin({ directory: process.cwd() });",
			"const events = {",
			"\tbusy: id => ({ type: \"session.status\", properties: { sessionID: id, status: { type: \"busy\" } } }),",
			"\tidle: id => ({ type: \"session.status\", properties: { sessionID: id, status: { type: \"idle\" } } }),",
			"\task: id => ({ type: \"permission.asked\", properties: { id, sessionID: \"r\", permission: \"bash\" } }),",
			"\treply: id => ({ type: \"permission.replied\", properties: { sessionID: \"r\", requestID: id, reply: \"once\" } }),",
			"};",
			"for (const step of process.argv.slice(2)) {",
			"\tconst [kind, id] = step.split(\":\");",
			"\tawait hooks.event({ event: events[kind](id) });",
			"}",
			"",
		].join("\n"));
		const driver = `${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, "opencode-events.mjs"))}`;
		await start();
		const session = await opened();
		await run(session.id, `${driver} busy:r; echo ran1`, "ran1\r\n");
		expect(await until(() => statusOf(session.id)?.state === "working")).toBe(true);
		await run(session.id, `${driver} busy:r ask:p; echo ran2`, "ran2\r\n");
		expect(await until(() => statusOf(session.id)?.state === "blocked")).toBe(true);
		expect(statusOf(session.id)).toEqual({ state: "blocked", kind: null, progress: null, app: "opencode", title: null, message: null });
		await run(session.id, `${driver} busy:r ask:p reply:p idle:r; echo ran3`, "ran3\r\n");
		expect(await until(() => statusOf(session.id)?.state === "done")).toBe(true);
		// The plugin printed nothing.
		expect(printed(session.id)).not.toContain("agent=opencode");
	});

	test("closing a session deletes its file", async () => {
		await start();
		const session = await opened();
		const file = join(folder!.path, session.id);
		expect(existsSync(file)).toBe(true);
		await sessions.close(session.id);
		expect(await until(() => !existsSync(file))).toBe(true);
	});
});
