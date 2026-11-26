import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStatusHookFiles } from "../src/bun/status-hook-files";
import { createMockStatusHooks } from "../src/mainview/engine/mock-status-hooks";
import { describeHookDialog, describeStatusLine } from "../src/mainview/status-hook-format";
import { type AgentId, agentById } from "../src/shared/agent-registry";
import {
	OPENCODE_PLUGIN_MARKER, OPENCODE_STATUS_PLUGIN, type StatusHookView, hookKind, parseStatusLine, planHook, reportedStates, statusFromLine,
} from "../src/shared/status-hooks";

/**
 * OpenCode's status hook: a plugin file of the app's own (see
 * docs/architecture.md, "Status hooks"). Built from OpenCode 1.19.6's source
 * and never run against OpenCode: here the plugin runs under Bun with events
 * shaped as OpenCode 1.19.6 sends them, and the installer works in a
 * temporary home folder. Skipped on Windows, where modes and links differ.
 */
const posix = process.platform !== "win32";
const root = () => process.getuid?.() === 0;

const opencode = agentById("opencode");
if (opencode.status.source !== "hook" || opencode.status.hook.format !== "opencode-plugin") throw new Error("OpenCode has a plugin in the registry");
const HOOK = opencode.status.hook;

type Hooks = { event?: (input: unknown) => Promise<void> };
type Factory = (input?: unknown) => Promise<Hooks>;

describe("the OpenCode plugin's text", () => {
	test("starts with its marker and holds no em dash", () => {
		expect(OPENCODE_STATUS_PLUGIN.startsWith(`${OPENCODE_PLUGIN_MARKER}\n`)).toBe(true);
		expect(OPENCODE_STATUS_PLUGIN).not.toContain(String.fromCharCode(0x2014));
	});

	test("the registry maps each event the plugin sends, and nothing else", () => {
		const sent = [...OPENCODE_STATUS_PLUGIN.matchAll(/report\("([^"]+)"\)/g)].map(match => match[1]!);
		// The asked events are sent by their own name.
		expect(new Set([...sent, "permission.asked", "question.asked"])).toEqual(new Set(HOOK.events.map(entry => entry.event)));
		expect(reportedStates(opencode)).toEqual(["working", "blocked", "done"]);
		expect(hookKind(HOOK)).toBe("file");
		expect(HOOK.run).toBe(true);
		expect(HOOK.caveat).toBe("Only OpenCode 1 needs the plugin, and without it those sessions show only running or exited. OpenCode 2 reports its status itself and does not load it.");
	});
});

describe.skipIf(!posix)("the OpenCode plugin, run under Bun", () => {
	let folder: string;
	let status: string;
	let saved: string | undefined;
	let count = 0;

	beforeEach(() => {
		folder = mkdtempSync(join(tmpdir(), "timber-app-opencode-"));
		status = join(folder, "session");
		writeFileSync(status, "");
		saved = process.env.TIMBER_APP_STATUS;
		process.env.TIMBER_APP_STATUS = status;
	});

	afterEach(() => {
		if (saved === undefined) delete process.env.TIMBER_APP_STATUS;
		else process.env.TIMBER_APP_STATUS = saved;
		rmSync(folder, { recursive: true, force: true });
	});

	/** The plugin as OpenCode loads it, from a file of its own, so each test starts with fresh state. */
	async function load(): Promise<Record<string, unknown>> {
		count += 1;
		const path = join(folder, `timber-app-status-${count}.js`);
		writeFileSync(path, OPENCODE_STATUS_PLUGIN);
		return await import(path) as Record<string, unknown>;
	}

	async function start(): Promise<(type: string, properties?: unknown) => Promise<void>> {
		const module = await load();
		const hooks = await (Object.values(module)[0] as Factory)({ directory: "/work" });
		return (type, properties = {}) => hooks.event!({ event: { id: "e", type, properties } });
	}

	const lines = () => readFileSync(status, "utf8").split("\n").filter(line => line !== "");
	const busy = (sessionID: string) => ["session.status", { sessionID, status: { type: "busy" } }] as const;
	const idle = (sessionID: string) => ["session.status", { sessionID, status: { type: "idle" } }] as const;

	test("its one export is a plugin function, as OpenCode 1 loads every export", async () => {
		const module = await load();
		expect(Object.keys(module)).toEqual(["TimberAppStatus"]);
		expect(typeof module.TimberAppStatus).toBe("function");
		// OpenCode may call it without its context.
		const hooks = await (module.TimberAppStatus as Factory)();
		expect(typeof hooks.event).toBe("function");
	});

	test("a turn with a subsession and two waiting permissions reports working, needs you, and done once each", async () => {
		const send = await start();
		await send(...busy("root"));
		await send(...busy("child"));
		await send("session.status", { sessionID: "child", status: { type: "retry", attempt: 1, message: "", next: 0 } });
		await send(...idle("child"));
		// The deprecated event that comes with every idle is not followed.
		await send("session.idle", { sessionID: "child" });
		await send("permission.asked", { id: "p1", sessionID: "root", permission: "bash", patterns: [], metadata: {}, always: [] });
		await send("permission.asked", { id: "p2", sessionID: "root", permission: "edit", patterns: [], metadata: {}, always: [] });
		await send("permission.replied", { sessionID: "root", requestID: "p1", reply: "once" });
		expect(lines()).toEqual(["agent=opencode:event=busy", "agent=opencode:event=permission.asked", "agent=opencode:event=permission.asked"]);
		await send("permission.replied", { sessionID: "root", requestID: "p2", reply: "always" });
		await send("question.asked", { id: "q1", sessionID: "root", questions: [] });
		await send("question.rejected", { sessionID: "root", requestID: "q1" });
		await send(...idle("root"));
		expect(lines()).toEqual([
			"agent=opencode:event=busy", "agent=opencode:event=permission.asked", "agent=opencode:event=permission.asked",
			"agent=opencode:event=answered", "agent=opencode:event=question.asked", "agent=opencode:event=answered", "agent=opencode:event=idle",
		]);
		// Each line is one the main process reads, with the state the registry gives it.
		expect(lines().map(line => statusFromLine(parseStatusLine(line)!)?.state)).toEqual(["working", "blocked", "blocked", "working", "blocked", "working", "done"]);
	});

	test("a question answered, and a session deleted while busy, end as they should", async () => {
		const send = await start();
		await send(...busy("a"));
		await send("question.asked", { id: "q", sessionID: "a", questions: [] });
		await send("question.replied", { sessionID: "a", requestID: "q", answers: [] });
		await send("session.deleted", { sessionID: "a", info: {} });
		expect(lines()).toEqual(["agent=opencode:event=busy", "agent=opencode:event=question.asked", "agent=opencode:event=answered", "agent=opencode:event=idle"]);
	});

	test("a session that goes idle while it waits drops its question, so the next turn's answer is not missed", async () => {
		const send = await start();
		await send(...busy("a"));
		await send("permission.asked", { id: "p", sessionID: "a" });
		await send(...idle("a"));
		await send(...busy("a"));
		await send("permission.asked", { id: "p2", sessionID: "a" });
		await send("permission.replied", { sessionID: "a", requestID: "p2", reply: "once" });
		expect(lines().at(-1)).toBe("agent=opencode:event=answered");
	});

	test("a subsession that ends while its question waits gives working back, as no answer comes", async () => {
		const send = await start();
		await send(...busy("root"));
		await send(...busy("child"));
		await send("permission.asked", { id: "p", sessionID: "child" });
		await send(...idle("child"));
		expect(lines()).toEqual(["agent=opencode:event=busy", "agent=opencode:event=permission.asked", "agent=opencode:event=answered"]);
		await send(...idle("root"));
		expect(lines().at(-1)).toBe("agent=opencode:event=idle");
	});

	test("what was seen is forgotten when OpenCode disposes of the plugin, so a missed idle does not stick", async () => {
		const module = await load();
		const factory = Object.values(module)[0] as Factory;
		const first = await factory({}) as Hooks & { dispose?: () => Promise<void> };
		await first.event!({ event: { type: "session.status", properties: { sessionID: "a", status: { type: "busy" } } } });
		await first.event!({ event: { type: "permission.asked", properties: { id: "p", sessionID: "a" } } });
		// OpenCode stopped listening before the turn's idle came.
		await first.dispose!();
		const second = await factory({});
		await second.event!({ event: { type: "session.status", properties: { sessionID: "b", status: { type: "busy" } } } });
		await second.event!({ event: { type: "session.status", properties: { sessionID: "b", status: { type: "idle" } } } });
		expect(lines()).toEqual(["agent=opencode:event=busy", "agent=opencode:event=permission.asked", "agent=opencode:event=busy", "agent=opencode:event=idle"]);
	});

	test("two starts of the plugin in one process share what they know", async () => {
		const module = await load();
		const factory = Object.values(module)[0] as Factory;
		const one = await factory({});
		const two = await factory({});
		const event = (type: string, properties: unknown) => ({ event: { type, properties } });
		await one.event!(event("session.status", { sessionID: "s", status: { type: "busy" } }));
		await two.event!(event("session.status", { sessionID: "s", status: { type: "busy" } }));
		await one.event!(event("session.status", { sessionID: "s", status: { type: "idle" } }));
		await two.event!(event("session.status", { sessionID: "s", status: { type: "idle" } }));
		expect(lines()).toEqual(["agent=opencode:event=busy", "agent=opencode:event=idle"]);
	});

	test("outside the app's sessions, and with its file gone, it writes nothing and never throws", async () => {
		const send = await start();
		delete process.env.TIMBER_APP_STATUS;
		await send(...busy("a"));
		expect(lines()).toEqual([]);
		process.env.TIMBER_APP_STATUS = join(folder, "gone");
		await send(...idle("a"));
		await send(...busy("b"));
		expect(existsSync(join(folder, "gone"))).toBe(false);
		process.env.TIMBER_APP_STATUS = status;
		const module = await load();
		const hooks = await (Object.values(module)[0] as Factory)();
		for (const input of [undefined, null, {}, { event: null }, { event: { type: "session.status" } }, { event: { type: "session.status", properties: null } }, { event: { type: "permission.asked", properties: { id: 5 } } }]) {
			await hooks.event!(input);
		}
	});
});

describe("planning the OpenCode plugin", () => {
	const plan = (text: string | null) => planHook(text, HOOK, "/unused", "opencode");

	test("no file is off, and Turn on writes the plugin whole", () => {
		expect(plan(null)).toMatchObject({ state: { kind: "off" }, installed: OPENCODE_STATUS_PLUGIN, removed: undefined, entries: OPENCODE_STATUS_PLUGIN, present: [] });
	});

	test("the plugin as written is on, and Remove deletes it", () => {
		expect(plan(OPENCODE_STATUS_PLUGIN)).toMatchObject({ state: { kind: "on" }, installed: null, removed: null, present: [OPENCODE_STATUS_PLUGIN] });
	});

	test("the app's plugin edited, or from another build, is changed, and Remove still deletes it", () => {
		const edited = `${OPENCODE_STATUS_PLUGIN}// mine\n`;
		expect(plan(edited)).toMatchObject({ state: { kind: "changed", reason: "The app's plugin is not as this version of the app writes it." }, installed: null, removed: null, present: [edited] });
	});

	test("a file of that name that is not the app's is broken, never written or deleted, and never shown", () => {
		const result = plan("export const Mine = async () => ({})\n");
		expect(result).toMatchObject({ state: { kind: "broken", reason: "A file of that name is there, but the app did not write it." }, installed: null, removed: undefined, present: [] });
	});
});

describe.skipIf(!posix)("the OpenCode plugin in a temporary home folder", () => {
	let home: string;
	let script: string;
	let plugins: string;
	let file: string;
	let rows: { name: string; agent: AgentId | null }[];
	/** Another tool's plugin, which must stay as it is. */
	const OTHER = "export const Other = async () => ({})\n";

	beforeEach(() => {
		home = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-opencode-home-")));
		mkdirSync(join(home, ".config", "timber-app"), { recursive: true });
		script = join(home, ".config", "timber-app", "status-hook");
		plugins = join(home, ".config", "opencode", "plugins");
		file = join(plugins, "timber-app-status.js");
		rows = [{ name: "OpenCode", agent: "opencode" }, { name: "Cursor CLI", agent: "cursor" }];
	});

	afterEach(() => {
		if (existsSync(plugins)) chmodSync(plugins, 0o755);
		rmSync(home, { recursive: true, force: true });
	});

	const files = (xdgConfigHome?: string) => createStatusHookFiles({ home, scriptPath: script, savedPrograms: async () => rows, xdgConfigHome });
	const hookOf = (views: StatusHookView[]) => views.find(view => view.agent === "opencode")!.hook!;

	test("Turn on writes only the plugin, and Remove deletes only it, leaving the folder and another tool's plugin", async () => {
		mkdirSync(plugins, { recursive: true });
		writeFileSync(join(plugins, "other.js"), OTHER);
		const hooks = files();
		const view = (await hooks.list()).find(row => row.agent === "opencode")!;
		expect(view).toMatchObject({ source: "hook", reports: ["working", "blocked", "done"] });
		const off = view.hook!;
		expect(off).toMatchObject({
			agent: "opencode", agentName: "OpenCode", file: "~/.config/opencode/plugins/timber-app-status.js", exists: false, state: { kind: "off" },
			byHand: null, kind: "file", script: null, scriptPath: null, run: true, entries: OPENCODE_STATUS_PLUGIN,
		});
		const on = await hooks.install({ agent: "opencode", token: off.token });
		expect(on).toMatchObject({ outcome: "done", message: "The OpenCode status hook is on, in ~/.config/opencode/plugins/timber-app-status.js." });
		expect(readFileSync(file, "utf8")).toBe(OPENCODE_STATUS_PLUGIN);
		expect(statSync(file).mode & 0o777).toBe(0o644);
		// The plugin needs no script, so none is written.
		expect(existsSync(script)).toBe(false);
		const onHook = hookOf(on.hooks);
		expect(onHook.state).toEqual({ kind: "on" });
		expect(describeStatusLine({ ...view, hook: onHook })?.text).toBe("On, in ~/.config/opencode/plugins/timber-app-status.js. Reports working, needs you, and done.");
		const removed = await hooks.remove({ agent: "opencode", token: onHook.token });
		expect(removed).toMatchObject({ outcome: "done", message: "The OpenCode status hook is off: the app's plugin, ~/.config/opencode/plugins/timber-app-status.js, was deleted." });
		expect(readdirSync(plugins)).toEqual(["other.js"]);
		expect(readFileSync(join(plugins, "other.js"), "utf8")).toBe(OTHER);
		expect(hookOf(removed.hooks).state).toEqual({ kind: "off" });
	});

	test("Turn on makes the folders when OpenCode has none yet", async () => {
		const hooks = files();
		expect((await hooks.install({ agent: "opencode", token: "missing" })).outcome).toBe("done");
		expect(readFileSync(file, "utf8")).toBe(OPENCODE_STATUS_PLUGIN);
	});

	test("a file of that name that is not the app's is never written or deleted", async () => {
		mkdirSync(plugins, { recursive: true });
		writeFileSync(file, OTHER);
		const hooks = files();
		const broken = hookOf(await hooks.list());
		expect(broken.state).toEqual({ kind: "broken", reason: "~/.config/opencode/plugins/timber-app-status.js is there, but the app did not write it." });
		expect(broken.present).toEqual([]);
		expect(await hooks.install({ agent: "opencode", token: broken.token })).toMatchObject({ outcome: "refused" });
		expect(await hooks.remove({ agent: "opencode", token: broken.token })).toMatchObject({ outcome: "refused", message: "~/.config/opencode/plugins/timber-app-status.js is not the app's plugin. Nothing was deleted." });
		expect(readFileSync(file, "utf8")).toBe(OTHER);
	});

	test("an edited plugin of the app's is shown as changed, not rewritten, and Remove deletes it", async () => {
		mkdirSync(plugins, { recursive: true });
		const edited = `${OPENCODE_STATUS_PLUGIN}// mine\n`;
		writeFileSync(file, edited);
		const hooks = files();
		const changed = hookOf(await hooks.list());
		expect(changed.state.kind).toBe("changed");
		expect(await hooks.install({ agent: "opencode", token: changed.token })).toMatchObject({ outcome: "refused", message: "The OpenCode status hook is not off. Nothing was written." });
		expect(readFileSync(file, "utf8")).toBe(edited);
		expect((await hooks.remove({ agent: "opencode", token: changed.token })).outcome).toBe("done");
		expect(existsSync(file)).toBe(false);
	});

	test("a plugin that changed after it was shown is not deleted", async () => {
		const hooks = files();
		const on = hookOf((await hooks.install({ agent: "opencode", token: "missing" })).hooks);
		writeFileSync(file, `${OPENCODE_STATUS_PLUGIN}// later\n`);
		expect(await hooks.remove({ agent: "opencode", token: on.token })).toMatchObject({ outcome: "changed-since" });
		expect(existsSync(file)).toBe(true);
	});

	test("with XDG_CONFIG_HOME a full path, the plugin goes where OpenCode reads it; otherwise in ~/.config", async () => {
		const xdg = join(home, "xdg");
		const hooks = files(xdg);
		const off = hookOf(await hooks.list());
		expect(off.file).toBe("~/xdg/opencode/plugins/timber-app-status.js");
		expect((await hooks.install({ agent: "opencode", token: off.token })).outcome).toBe("done");
		expect(readFileSync(join(xdg, "opencode", "plugins", "timber-app-status.js"), "utf8")).toBe(OPENCODE_STATUS_PLUGIN);
		expect(existsSync(file)).toBe(false);
		expect(hookOf(await files("relative/xdg").list()).file).toBe("~/.config/opencode/plugins/timber-app-status.js");
	});

	test("an XDG_CONFIG_HOME outside the home folder is shown in full, and a linked folder in it is added by hand", async () => {
		const outside = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-xdg-")));
		const dotfiles = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-dotfiles-")));
		try {
			const hooks = files(outside);
			expect(hookOf(await hooks.list())).toMatchObject({ file: join(outside, "opencode", "plugins", "timber-app-status.js"), byHand: null });
			const plugin = join(outside, "opencode", "plugins", "timber-app-status.js");
			const on = await hooks.install({ agent: "opencode", token: "missing" });
			expect(readFileSync(plugin, "utf8")).toBe(OPENCODE_STATUS_PLUGIN);
			expect((await hooks.remove({ agent: "opencode", token: hookOf(on.hooks).token })).outcome).toBe("done");
			expect(existsSync(plugin)).toBe(false);
			rmSync(join(outside, "opencode"), { recursive: true });
			symlinkSync(dotfiles, join(outside, "opencode"));
			const linked = hookOf(await hooks.list());
			expect(linked.byHand).toBe(`${join(outside, "opencode")} is a link to ${dotfiles}, so the app does not write in it: it may be in a repository.`);
			expect((await hooks.install({ agent: "opencode", token: linked.token })).outcome).toBe("refused");
			expect(readdirSync(dotfiles)).toEqual([]);
		} finally {
			rmSync(outside, { recursive: true, force: true });
			rmSync(dotfiles, { recursive: true, force: true });
		}
	});

	test("a plugin that is a link is removed by hand, and once it is gone Turn on writes the plugin and no script", async () => {
		mkdirSync(plugins, { recursive: true });
		const target = join(home, "dotfiles-plugin.js");
		writeFileSync(target, OPENCODE_STATUS_PLUGIN);
		symlinkSync(target, file);
		const hooks = files();
		const on = hookOf(await hooks.list());
		expect(on.state).toEqual({ kind: "on" });
		expect(on.byHand).toBe(`~/.config/opencode/plugins/timber-app-status.js is a link to ${target}, so the app does not write it: it may be in a repository.`);
		expect(describeStatusLine({ name: "OpenCode", agent: "opencode", source: "hook", reports: ["working", "blocked", "done"], hook: on })?.actions).toEqual([{ action: "remove-by-hand", label: "Show the file to delete…" }]);
		expect((await hooks.remove({ agent: "opencode", token: on.token })).outcome).toBe("refused");
		expect(readFileSync(target, "utf8")).toBe(OPENCODE_STATUS_PLUGIN);
		rmSync(file);
		expect((await hooks.install({ agent: "opencode", token: "missing" })).outcome).toBe("done");
		expect(existsSync(script)).toBe(false);
	});

	test("a folder where the plugin goes is broken, and never deleted", async () => {
		mkdirSync(file, { recursive: true });
		const hooks = files();
		const broken = hookOf(await hooks.list());
		expect(broken.state).toEqual({ kind: "broken", reason: "It is not a file." });
		expect((await hooks.remove({ agent: "opencode", token: broken.token })).outcome).toBe("refused");
		expect(statSync(file).isDirectory()).toBe(true);
	});

	test("on Windows nothing is offered or written", async () => {
		const hooks = createStatusHookFiles({ home, scriptPath: script, savedPrograms: async () => rows, platform: "win32" });
		expect((await hooks.list()).find(view => view.agent === "opencode")).toMatchObject({ source: "hook", hook: null });
		expect(await hooks.install({ agent: "opencode", token: "missing" })).toMatchObject({ outcome: "refused" });
		expect(existsSync(file)).toBe(false);
	});

	test.skipIf(root())("a plugins folder that cannot be written is added to by hand", async () => {
		mkdirSync(plugins, { recursive: true });
		chmodSync(plugins, 0o555);
		const hooks = files();
		const off = hookOf(await hooks.list());
		expect(off.byHand).toBe("~/.config/opencode/plugins cannot be written, so the app does not make the file.");
		const dialog = describeHookDialog(off, ["working", "blocked", "done"], "add-by-hand");
		expect(dialog).toMatchObject({ title: "Add the OpenCode status hook by hand", confirm: null, copy: OPENCODE_STATUS_PLUGIN, cancel: "Close" });
		expect(await hooks.install({ agent: "opencode", token: off.token })).toMatchObject({ outcome: "refused" });
		expect(readdirSync(plugins)).toEqual([]);
		expect(existsSync(script)).toBe(false);
	});
});

describe("the OpenCode dialogs", () => {
	const off = {
		agent: "opencode" as const, agentName: "OpenCode", file: "~/.config/opencode/plugins/timber-app-status.js", exists: false, state: { kind: "off" as const },
		byHand: null, token: "missing", entries: OPENCODE_STATUS_PLUGIN, present: [], kind: "file" as const, script: null, scriptPath: null,
		checked: "OpenCode 1.19.6, run on 2026-11-25", run: true,
	};
	const reports = ["working", "blocked", "done"] as const;

	test("Turn on shows the whole plugin and says only OpenCode 1 needs it", () => {
		expect(describeHookDialog(off, [...reports], "install")).toEqual({
			title: "Turn on the OpenCode status hook?",
			lead: "This adds a plugin of the app's, so its sessions in the app show working, needs you, and done, with their notifications and sounds. OpenCode loads it in every terminal; outside the app it does nothing.",
			note: "Makes ~/.config/opencode/plugins/timber-app-status.js. Nothing else in ~/.config/opencode/plugins/ changes. Only OpenCode 1 needs the plugin, and without it those sessions show only running or exited. OpenCode 2 reports its status itself and does not load it.",
			blocks: [{ label: "~/.config/opencode/plugins/timber-app-status.js", text: OPENCODE_STATUS_PLUGIN }],
			confirm: { label: "Turn on", danger: false, running: "Turning on…" },
			copy: null,
			cancel: "Cancel",
			next: null,
		});
	});

	test("the Off line says which OpenCode needs the plugin", () => {
		expect(describeStatusLine({ name: "OpenCode", agent: "opencode", source: "hook", reports: [...reports], hook: off })?.text).toBe("Off. Only OpenCode 1 needs the plugin, and without it those sessions show only running or exited. OpenCode 2 reports its status itself and does not load it.");
	});

	test("Remove shows the file it deletes", () => {
		const on = { ...off, exists: true, state: { kind: "on" as const }, present: [OPENCODE_STATUS_PLUGIN] };
		expect(describeHookDialog(on, [...reports], "remove")).toMatchObject({
			lead: "Deletes ~/.config/opencode/plugins/timber-app-status.js, the app's plugin. Your other plugins stay as they are. Sessions that need it then show only running or exited.",
			blocks: [{ label: "Deleted: ~/.config/opencode/plugins/timber-app-status.js", text: OPENCODE_STATUS_PLUGIN }],
			confirm: { label: "Remove", danger: true, running: "Removing…" },
		});
	});

	test("a changed plugin offers what differs and Remove", () => {
		const changed = { ...off, exists: true, state: { kind: "changed" as const, reason: "The app's plugin is not as this version of the app writes it." }, present: ["old"] };
		const view: StatusHookView = { name: "OpenCode", agent: "opencode", source: "hook", reports: [...reports], hook: changed };
		expect(describeStatusLine(view)?.actions.map(action => action.label)).toEqual(["Show what differs…", "Remove…"]);
		expect(describeHookDialog(changed, [...reports], "differs").blocks).toEqual([
			{ label: "In ~/.config/opencode/plugins/timber-app-status.js now", text: "old" },
			{ label: "As the app writes it", text: OPENCODE_STATUS_PLUGIN },
		]);
	});

	test("a file that is not the app's says to fix it by hand, with no button", () => {
		const broken = { ...off, exists: true, state: { kind: "broken" as const, reason: "A file of that name is there, but the app did not write it." } };
		expect(describeStatusLine({ name: "OpenCode", agent: "opencode", source: "hook", reports: [...reports], hook: broken })).toEqual({
			label: "Status hook broken",
			text: "A file of that name is there, but the app did not write it. Fix it by hand, then open Settings, Agents again.",
			tone: "error",
			actions: [],
		});
	});
});

describe("OpenCode's hook in the mock engine", () => {
	test("Turn on and Remove answer as the main process does", async () => {
		const hooks = createMockStatusHooks(() => [{ name: "OpenCode", command: "opencode" }]);
		const off = (await hooks.statusHooks())[0]!.hook!;
		expect(off).toMatchObject({ kind: "file", script: null, scriptPath: null, run: true, state: { kind: "off" } });
		const on = await hooks.installStatusHook({ agent: "opencode", token: off.token });
		expect(on).toMatchObject({ outcome: "done", message: "The OpenCode status hook is on, in ~/.config/opencode/plugins/timber-app-status.js." });
		expect(hooks.statusHookFile("opencode").text).toBe(OPENCODE_STATUS_PLUGIN);
		const removed = await hooks.removeStatusHook({ agent: "opencode", token: on.hooks[0]!.hook!.token });
		expect(removed).toMatchObject({ outcome: "done", message: "The OpenCode status hook is off: the app's plugin, ~/.config/opencode/plugins/timber-app-status.js, was deleted." });
		expect(hooks.statusHookFile("opencode").text).toBeNull();
		hooks.setStatusHookFile("opencode", { text: "mine\n" });
		expect((await hooks.statusHooks())[0]!.hook!.state).toEqual({ kind: "broken", reason: "~/.config/opencode/plugins/timber-app-status.js is there, but the app did not write it." });
	});
});
