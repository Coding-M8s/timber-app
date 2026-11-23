import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStatusHookFiles } from "../src/bun/status-hook-files";
import type { AgentId } from "../src/shared/agent-registry";
import { STATUS_HOOK_SCRIPT, type StatusHookView } from "../src/shared/status-hooks";

/**
 * Status hooks in a temporary home folder, as Cursor CLI's `~/.cursor/hooks.json`.
 * Every other key and value must parse the same after a write, and reading
 * never writes. Skipped on Windows, where modes and links differ: not tried there.
 */
const posix = process.platform !== "win32";
const root = () => process.getuid?.() === 0;

/** A shared hooks file shaped as another tool writes one. The commands are made up. */
const SHARED = {
	hooks: {
		beforeSubmitPrompt: [{ command: "/bin/sh -c 'other-tool submit'", timeout: 10 }],
		stop: [{ command: "/bin/sh -c 'other-tool stop'", timeout: 10 }],
		preToolUse: [{ command: "/bin/sh -c 'other-tool tool'", timeout: 10 }],
	},
	version: 1,
	other: { kept: ["as", "is"] },
};

describe.skipIf(!posix)("status hooks in a temporary home folder", () => {
	let home: string;
	let settings: string;
	let script: string;
	let file: string;
	let rows: { name: string; agent: AgentId | null }[];

	beforeEach(() => {
		home = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-hooks-")));
		settings = join(home, ".config", "timber-app");
		mkdirSync(settings, { recursive: true });
		script = join(settings, "status-hook");
		file = join(home, ".cursor", "hooks.json");
		mkdirSync(join(home, ".cursor"));
		rows = [{ name: "Claude Code", agent: "claude" }, { name: "Cursor CLI", agent: "cursor" }, { name: "Odd", agent: null }];
	});

	afterEach(() => {
		chmodSync(join(home, ".cursor"), 0o755);
		rmSync(home, { recursive: true, force: true });
	});

	const hooks = () => createStatusHookFiles({ home, scriptPath: script, savedPrograms: async () => rows });
	const cursorOf = (views: StatusHookView[]) => views.find(view => view.agent === "cursor")!.hook!;
	const own = (event: string) => ({ command: `'${script}' cursor ${event}`, timeout: 5 });
	/** Every file in the home folder, with its bytes, to check that reading changed nothing. */
	const snapshot = (folder = home): Record<string, string> => Object.fromEntries(readdirSync(folder, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile() || entry.isSymbolicLink())
		.map(entry => {
			const path = join(entry.parentPath, entry.name);
			return [path, entry.isSymbolicLink() ? "link" : `${statSync(path).mode}:${readFileSync(path, "utf8")}`];
		}));

	test("each saved row says how its agent reports; reading writes nothing", async () => {
		writeFileSync(file, JSON.stringify(SHARED));
		const before = snapshot();
		const views = await hooks().list();
		expect(views.map(view => [view.name, view.source, view.reports])).toEqual([
			["Claude Code", "osc-7501", ["working", "blocked", "done"]],
			["Cursor CLI", "hook", ["working", "done"]],
			["Odd", "none", []],
		]);
		expect(views[0]!.hook).toBeNull();
		const hook = cursorOf(views);
		expect(hook).toMatchObject({ agent: "cursor", agentName: "Cursor CLI", file: "~/.cursor/hooks.json", exists: true, state: { kind: "off" }, byHand: null, script: STATUS_HOOK_SCRIPT, scriptPath: "~/.config/timber-app/status-hook" });
		// The rest of the file, which can hold secrets, is never in the answer.
		expect(JSON.stringify(views)).not.toContain("other-tool");
		expect(snapshot()).toEqual(before);
	});

	test("turning on a new file makes it and the script, and removing deletes the file it made", async () => {
		rmSync(join(home, ".cursor"), { recursive: true });
		const files = hooks();
		const off = cursorOf(await files.list());
		expect(off).toMatchObject({ exists: false, state: { kind: "off" }, token: "missing" });
		const result = await files.install({ agent: "cursor", token: off.token });
		expect(result).toMatchObject({ outcome: "done", message: "The Cursor CLI status hook is on, in ~/.cursor/hooks.json." });
		expect(readFileSync(file, "utf8")).toBe(off.entries);
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, hooks: { sessionStart: [own("sessionStart")], beforeSubmitPrompt: [own("beforeSubmitPrompt")], stop: [own("stop")] } });
		expect(statSync(file).mode & 0o777).toBe(0o644);
		expect(readFileSync(script, "utf8")).toBe(STATUS_HOOK_SCRIPT);
		expect(statSync(script).mode & 0o777).toBe(0o755);
		const on = cursorOf(result.hooks);
		expect(on.state).toEqual({ kind: "on" });
		const removed = await files.remove({ agent: "cursor", token: on.token });
		expect(removed).toMatchObject({ outcome: "done", message: "The Cursor CLI status hook is off, and ~/.cursor/hooks.json, left empty, was deleted." });
		expect(existsSync(file)).toBe(false);
		// The script stays, for another install of the app that may use it.
		expect(existsSync(script)).toBe(true);
		expect(readdirSync(join(home, ".cursor"))).toEqual([]);
	});

	test("in a shared file, only the app's entries come and go; every other key parses the same, and the mode stays", async () => {
		writeFileSync(file, JSON.stringify(SHARED, null, 4), { mode: 0o600 });
		chmodSync(file, 0o600);
		const files = hooks();
		const result = await files.install({ agent: "cursor", token: cursorOf(await files.list()).token });
		expect(result.outcome).toBe("done");
		const on = JSON.parse(readFileSync(file, "utf8"));
		expect(on.other).toEqual(SHARED.other);
		expect(on.version).toBe(1);
		expect(on.hooks.stop).toEqual([...SHARED.hooks.stop, own("stop")]);
		expect(on.hooks.preToolUse).toEqual(SHARED.hooks.preToolUse);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		const removed = await files.remove({ agent: "cursor", token: cursorOf(result.hooks).token });
		expect(removed).toMatchObject({ outcome: "done", message: "The Cursor CLI status hook is off. The app's entries were taken out of ~/.cursor/hooks.json." });
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(SHARED);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		// No temporary file or backup copy is left beside it.
		expect(readdirSync(join(home, ".cursor"))).toEqual(["hooks.json"]);
	});

	test("a file that changed after it was shown is not written", async () => {
		writeFileSync(file, JSON.stringify(SHARED));
		const files = hooks();
		const shown = cursorOf(await files.list());
		writeFileSync(file, JSON.stringify({ ...SHARED, added: true }));
		const result = await files.install({ agent: "cursor", token: shown.token });
		expect(result).toMatchObject({ outcome: "changed-since", message: "~/.cursor/hooks.json changed since it was shown. Nothing was written; look at it again." });
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ...SHARED, added: true });
		expect(existsSync(script)).toBe(false);
	});

	test("only an agent a saved row runs, and only one with a hook", async () => {
		const files = hooks();
		const token = cursorOf(await files.list()).token;
		rows = [{ name: "Claude Code", agent: "claude" }];
		expect(await files.install({ agent: "cursor", token })).toMatchObject({ outcome: "refused", message: "No saved agent in Settings, Agents runs that agent. Nothing was written." });
		expect(await files.install({ agent: "claude", token })).toMatchObject({ outcome: "refused", message: "That agent has no status hook. Nothing was written." });
		expect(existsSync(file)).toBe(false);
	});

	test("a link is never written: its entries are added by hand, and Turn on only puts the script in place", async () => {
		const target = join(home, "dotfiles", "hooks.json");
		mkdirSync(join(home, "dotfiles"));
		writeFileSync(target, JSON.stringify(SHARED));
		symlinkSync(target, file);
		const files = hooks();
		const off = cursorOf(await files.list());
		expect(off.byHand).toBe(`~/.cursor/hooks.json is a link to ${target}, so the app does not write it: it may be in a repository.`);
		expect(off.state).toEqual({ kind: "off" });
		const result = await files.install({ agent: "cursor", token: off.token });
		expect(result).toMatchObject({ outcome: "done", message: "The script is in place at ~/.config/timber-app/status-hook. Add the entries to ~/.cursor/hooks.json by hand." });
		expect(lstatSync(file).isSymbolicLink()).toBe(true);
		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(SHARED);
		expect(readFileSync(script, "utf8")).toBe(STATUS_HOOK_SCRIPT);
		// Pasted by hand, it reads as on; Remove is by hand too.
		const pasted = { ...SHARED, hooks: { ...SHARED.hooks, sessionStart: [own("sessionStart")], beforeSubmitPrompt: [...SHARED.hooks.beforeSubmitPrompt, own("beforeSubmitPrompt")], stop: [...SHARED.hooks.stop, own("stop")] } };
		writeFileSync(target, JSON.stringify(pasted));
		const on = cursorOf(await files.list());
		expect(on.state).toEqual({ kind: "on" });
		expect(await files.remove({ agent: "cursor", token: on.token })).toMatchObject({ outcome: "refused" });
		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(pasted);
	});

	test("a folder on the way that is a link, as stow makes, is never written in", async () => {
		const dotfiles = join(home, "dotfiles", "cursor");
		mkdirSync(dotfiles, { recursive: true });
		rmSync(join(home, ".cursor"), { recursive: true });
		symlinkSync(dotfiles, join(home, ".cursor"));
		const files = hooks();
		const off = cursorOf(await files.list());
		expect(off.byHand).toBe(`~/.cursor is a link to ${dotfiles}, so the app does not write in it: it may be in a repository.`);
		await files.install({ agent: "cursor", token: off.token });
		expect(readdirSync(dotfiles)).toEqual([]);
		writeFileSync(join(dotfiles, "hooks.json"), JSON.stringify(SHARED));
		expect(cursorOf(await files.list()).byHand).toBe(`~/.cursor is a link to ${dotfiles}, so the app does not write in it: it may be in a repository.`);
		rmSync(join(home, ".cursor"));
		mkdirSync(join(home, ".cursor"));
	});

	test("a home folder reached through a link is still the home folder", async () => {
		const linkedHome = join(home, "..", `${home.split("/").at(-1)}-link`);
		symlinkSync(home, linkedHome);
		try {
			const files = createStatusHookFiles({ home: linkedHome, scriptPath: script, savedPrograms: async () => rows });
			expect(cursorOf(await files.list()).byHand).toBeNull();
		} finally {
			rmSync(linkedHome);
		}
	});

	test("a stale view removes nothing", async () => {
		const files = hooks();
		const on = cursorOf((await files.install({ agent: "cursor", token: "missing" })).hooks);
		writeFileSync(file, readFileSync(file, "utf8").replace("\n}", ', "mine": true\n}'));
		const after = readFileSync(file, "utf8");
		expect(await files.remove({ agent: "cursor", token: on.token })).toMatchObject({ outcome: "changed-since" });
		expect(readFileSync(file, "utf8")).toBe(after);
	});

	test("on Windows nothing is offered or written", async () => {
		const files = createStatusHookFiles({ home, scriptPath: script, savedPrograms: async () => rows, platform: "win32" });
		const views = await files.list();
		expect(views.find(view => view.agent === "cursor")).toMatchObject({ source: "hook", hook: null });
		expect(await files.install({ agent: "cursor", token: "missing" })).toMatchObject({ outcome: "refused", message: "Status hooks are not built for Windows yet. Nothing was written." });
		expect(existsSync(file)).toBe(false);
		expect(existsSync(script)).toBe(false);
	});

	test("a file with comments is never written", async () => {
		writeFileSync(file, '{\n  // mine\n  "version": 1,\n  "hooks": {}\n}\n');
		const files = hooks();
		const off = cursorOf(await files.list());
		expect(off.byHand).toBe("~/.cursor/hooks.json holds comments, which the app would drop if it wrote the file.");
		await files.install({ agent: "cursor", token: off.token });
		expect(readFileSync(file, "utf8")).toBe('{\n  // mine\n  "version": 1,\n  "hooks": {}\n}\n');
		// Remove asked for directly writes nothing either.
		expect((await files.remove({ agent: "cursor", token: off.token })).outcome).toBe("refused");
		expect(readFileSync(file, "utf8")).toBe('{\n  // mine\n  "version": 1,\n  "hooks": {}\n}\n');
	});

	test.skipIf(root())("a file or folder that cannot be written is added to by hand", async () => {
		writeFileSync(file, JSON.stringify(SHARED));
		chmodSync(file, 0o444);
		expect(cursorOf(await hooks().list()).byHand).toBe("~/.cursor/hooks.json cannot be written, so the app does not change it.");
		rmSync(file);
		chmodSync(join(home, ".cursor"), 0o555);
		expect(cursorOf(await hooks().list()).byHand).toBe("~/.cursor cannot be written, so the app does not make the file.");
	});

	test("a missing script is broken, a script not as the app writes it is changed, and neither is rewritten", async () => {
		const files = hooks();
		const on = cursorOf((await files.install({ agent: "cursor", token: "missing" })).hooks);
		expect(on.state).toEqual({ kind: "on" });
		rmSync(script);
		expect(cursorOf(await files.list()).state).toEqual({ kind: "broken", reason: "The script its entries run, ~/.config/timber-app/status-hook, is missing." });
		writeFileSync(script, STATUS_HOOK_SCRIPT, { mode: 0o644 });
		chmodSync(script, 0o644);
		expect(cursorOf(await files.list()).state).toEqual({ kind: "broken", reason: "The script its entries run, ~/.config/timber-app/status-hook, cannot be read or run." });
		writeFileSync(script, "#!/bin/sh\necho changed\n");
		const changed = cursorOf(await files.list());
		expect(changed.state).toEqual({ kind: "changed", reason: "The script its entries run, ~/.config/timber-app/status-hook, is not as the app writes it.", script: true });
		expect(readFileSync(script, "utf8")).toBe("#!/bin/sh\necho changed\n");
		// Remove still takes the entries out.
		expect((await files.remove({ agent: "cursor", token: changed.token })).outcome).toBe("done");
		expect(existsSync(file)).toBe(false);
		// And Turn on does not replace the script.
		expect(await files.install({ agent: "cursor", token: "missing" })).toMatchObject({ outcome: "refused", message: "~/.config/timber-app/status-hook is there but not as the app writes it, so the app does not replace it. Nothing was written." });
	});

	test("changed or broken entries are shown, not rewritten", async () => {
		writeFileSync(file, JSON.stringify({ version: 1, hooks: { stop: [{ ...own("stop"), timeout: 30 }] } }));
		writeFileSync(script, STATUS_HOOK_SCRIPT, { mode: 0o755 });
		const files = hooks();
		const changed = cursorOf(await files.list());
		expect(changed.state.kind).toBe("changed");
		expect(changed.present).toEqual([`"stop": ${JSON.stringify({ ...own("stop"), timeout: 30 })}`]);
		expect(await files.install({ agent: "cursor", token: changed.token })).toMatchObject({ outcome: "refused", message: "The Cursor CLI status hook is not off. Nothing was written." });
		writeFileSync(file, "{ not json");
		const broken = cursorOf(await files.list());
		expect(broken.state).toEqual({ kind: "broken", reason: "It is not valid JSON." });
		expect((await files.remove({ agent: "cursor", token: broken.token })).outcome).toBe("refused");
		expect(readFileSync(file, "utf8")).toBe("{ not json");
	});
});

describe.skipIf(!posix)("Gemini CLI's status hook in a temporary home folder", () => {
	let home: string;
	let script: string;
	let file: string;
	const rows = [{ name: "Gemini CLI", agent: "gemini" as const }, { name: "Cursor CLI", agent: "cursor" as const }];

	/** Settings as a person keeps them, with another tool's hooks and Gemini's own hook settings. The commands are made up. */
	const SETTINGS = {
		security: { auth: { selectedType: "oauth-personal" } },
		hooks: {
			disabled: ["other-tool-log"],
			BeforeAgent: [{ hooks: [{ type: "command", name: "other-tool-log", command: "other-tool log" }] }],
			AfterAgent: [{ matcher: "*", hooks: [{ type: "command", command: "other-tool done", timeout: 1000 }] }],
		},
		mcpServers: { tool: { command: "other-tool", args: ["serve"] } },
	};

	beforeEach(() => {
		home = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-gemini-hooks-")));
		mkdirSync(join(home, ".config", "timber-app"), { recursive: true });
		script = join(home, ".config", "timber-app", "status-hook");
		file = join(home, ".gemini", "settings.json");
	});
	afterEach(() => rmSync(home, { recursive: true, force: true }));

	const hooks = () => createStatusHookFiles({ home, scriptPath: script, savedPrograms: async () => rows });
	const geminiOf = (views: StatusHookView[]) => views.find(view => view.agent === "gemini")!.hook!;

	test("each row says how its agent reports; Gemini CLI's file is ~/.gemini/settings.json, and reading writes nothing", async () => {
		const views = await hooks().list();
		expect(views.map(view => [view.name, view.source, view.reports])).toEqual([
			["Gemini CLI", "hook", ["working", "blocked", "done"]],
			["Cursor CLI", "hook", ["working", "done"]],
		]);
		expect(geminiOf(views)).toMatchObject({ agentName: "Gemini CLI", file: "~/.gemini/settings.json", exists: false, state: { kind: "off" }, byHand: null, checked: "Gemini CLI 0.70.0's source, read on 2026-11-22, not run" });
		expect(existsSync(join(home, ".gemini"))).toBe(false);
	});

	test("turning on a new file makes the folder, the file, and the script; removing deletes the file it made", async () => {
		const files = hooks();
		const off = geminiOf(await files.list());
		const result = await files.install({ agent: "gemini", token: off.token });
		expect(result).toMatchObject({ outcome: "done", message: "The Gemini CLI status hook is on, in ~/.gemini/settings.json." });
		expect(readFileSync(file, "utf8")).toBe(off.entries);
		expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).hooks)).toEqual(["SessionStart", "BeforeAgent", "Notification", "AfterTool", "AfterAgent"]);
		expect(readFileSync(script, "utf8")).toBe(STATUS_HOOK_SCRIPT);
		const on = geminiOf(result.hooks);
		expect(on.state).toEqual({ kind: "on" });
		expect(await files.remove({ agent: "gemini", token: on.token })).toMatchObject({ outcome: "done", message: "The Gemini CLI status hook is off, and ~/.gemini/settings.json, left empty, was deleted." });
		expect(existsSync(file)).toBe(false);
		expect(existsSync(script)).toBe(true);
	});

	test("in shared settings, only the app's entries come and go; every other key parses the same, and the mode stays", async () => {
		mkdirSync(join(home, ".gemini"));
		writeFileSync(file, JSON.stringify(SETTINGS, null, 2), { mode: 0o600 });
		chmodSync(file, 0o600);
		const files = hooks();
		const result = await files.install({ agent: "gemini", token: geminiOf(await files.list()).token });
		expect(result.outcome).toBe("done");
		const on = JSON.parse(readFileSync(file, "utf8"));
		expect(on.security).toEqual(SETTINGS.security);
		expect(on.mcpServers).toEqual(SETTINGS.mcpServers);
		expect(on.hooks.disabled).toEqual(SETTINGS.hooks.disabled);
		expect(on.hooks.BeforeAgent.slice(0, 1)).toEqual(SETTINGS.hooks.BeforeAgent);
		expect(on.hooks.AfterAgent.slice(0, 1)).toEqual(SETTINGS.hooks.AfterAgent);
		expect(on.hooks.Notification).toEqual([{ matcher: "ToolPermission", hooks: [{ type: "command", name: "timber-app-status", command: `'${script}' gemini Notification 2>/dev/null || true`, timeout: 5000 }] }]);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		const removed = await files.remove({ agent: "gemini", token: geminiOf(result.hooks).token });
		expect(removed).toMatchObject({ outcome: "done", message: "The Gemini CLI status hook is off. The app's entries were taken out of ~/.gemini/settings.json." });
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(SETTINGS);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(readdirSync(join(home, ".gemini"))).toEqual(["settings.json"]);
		// Cursor's file was never touched.
		expect(existsSync(join(home, ".cursor"))).toBe(false);
	});

	test("the entries as written append the event in a session, and stay silent with exit 0 once the script is gone", async () => {
		const files = hooks();
		await files.install({ agent: "gemini", token: geminiOf(await files.list()).token });
		const settings = JSON.parse(readFileSync(file, "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
		const status = join(home, "status");
		writeFileSync(status, "");
		for (const event of ["SessionStart", "BeforeAgent", "Notification", "AfterTool", "AfterAgent"]) {
			// Gemini CLI 0.70.0 runs a command with `bash -c` and its input on stdin.
			const ran = Bun.spawnSync(["bash", "-c", settings.hooks[event]![0]!.hooks[0]!.command], { stdin: Buffer.from('{"hook_event_name":"x"}'), env: { PATH: process.env.PATH, TIMBER_APP_STATUS: status } });
			expect(ran.exitCode).toBe(0);
			expect(ran.stdout.length + ran.stderr.length).toBe(0);
		}
		expect(readFileSync(status, "utf8")).toBe("agent=gemini:event=SessionStart\nagent=gemini:event=BeforeAgent\nagent=gemini:event=Notification\nagent=gemini:event=AfterTool\nagent=gemini:event=AfterAgent\n");
		rmSync(script);
		const gone = Bun.spawnSync(["bash", "-c", settings.hooks.BeforeAgent![0]!.hooks[0]!.command], { env: { PATH: process.env.PATH, TIMBER_APP_STATUS: status } });
		expect(gone.exitCode).toBe(0);
		expect(gone.stdout.length + gone.stderr.length).toBe(0);
	});

	test("settings with no hooks, as most are, parse the same after on and off", async () => {
		mkdirSync(join(home, ".gemini"));
		writeFileSync(file, JSON.stringify({ ui: { theme: "Default" }, general: { vimMode: true } }));
		const files = hooks();
		const result = await files.install({ agent: "gemini", token: geminiOf(await files.list()).token });
		expect((await files.remove({ agent: "gemini", token: geminiOf(result.hooks).token })).outcome).toBe("done");
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ui: { theme: "Default" }, general: { vimMode: true } });
	});

	test("settings with comments are never written: the entries are added by hand", async () => {
		mkdirSync(join(home, ".gemini"));
		const text = `{\n  // mine\n  "ui": { "theme": "Default" }\n}\n`;
		writeFileSync(file, text);
		const files = hooks();
		const shown = geminiOf(await files.list());
		expect(shown).toMatchObject({ state: { kind: "off" }, byHand: "~/.gemini/settings.json holds comments, which the app would drop if it wrote the file." });
		const result = await files.install({ agent: "gemini", token: shown.token });
		expect(result).toMatchObject({ outcome: "done", message: "The script is in place at ~/.config/timber-app/status-hook. Add the entries to ~/.gemini/settings.json by hand." });
		expect(readFileSync(file, "utf8")).toBe(text);
	});
});
