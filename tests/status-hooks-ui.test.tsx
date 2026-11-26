import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { agentDraftsOf, editAgentDraft } from "../src/mainview/agent-format";
import { AgentsSectionView } from "../src/mainview/components/settings/AgentsSection";
import { NotificationsSectionView } from "../src/mainview/components/settings/NotificationsSection";
import { createMockEngine } from "../src/mainview/engine/mock";
import { notificationsDraftOf } from "../src/mainview/notifications-format";
import { describeHookDialog, describeStatusLine } from "../src/mainview/status-hook-format";
import { defaultPreferences } from "../src/shared/preferences";
import { createAppStore } from "../src/mainview/store/store";
import type { AgentSetting } from "../src/shared/agent";
import { type HookDetails, STATUS_HOOK_SCRIPT, type StatusHookView } from "../src/shared/status-hooks";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};

const SAVED: AgentSetting[] = [{ name: "Claude Code", command: "claude" }, { name: "Codex", command: "codex" }, { name: "Cursor CLI", command: "cursor-agent" }, { name: "Gemini CLI", command: "gemini" }];
const ENTRIES = '{\n  "hooks": {\n    "stop": [\n      { "command": "\'/home/you/.config/timber-app/status-hook\' cursor stop", "timeout": 5 }\n    ]\n  }\n}\n';

const hook = (more: Partial<HookDetails> = {}): HookDetails => ({
	agent: "cursor", agentName: "Cursor CLI", file: "~/.cursor/hooks.json", exists: true, state: { kind: "off" }, byHand: null, token: "t",
	entries: ENTRIES, present: [], script: STATUS_HOOK_SCRIPT, scriptPath: "~/.config/timber-app/status-hook", kind: "entries", checked: "Cursor CLI 2026.11.22 on 2026-11-22", run: true, ...more,
});
const cursor = (more: Partial<HookDetails> = {}): StatusHookView => ({ name: "Cursor CLI", agent: "cursor", source: "hook", reports: ["working", "done"], hook: hook(more) });
const VIEWS: StatusHookView[] = [
	{ name: "Claude Code", agent: "claude", source: "osc-7501", reports: ["working", "blocked", "done"], hook: null },
	{ name: "Codex", agent: "codex", source: "osc-7501", reports: ["working", "done"], hook: null },
	cursor(),
	{ name: "OpenCode", agent: "opencode", source: "none", reports: [], hook: null },
];

describe("an agent row's status line", () => {
	test("an agent that reports itself says which states, with no button", () => {
		expect(describeStatusLine(VIEWS[0]!)).toEqual({ label: "Status", text: "Reports working, needs you, and done itself.", tone: "hint", actions: [] });
		expect(describeStatusLine(VIEWS[1]!)?.text).toBe("Reports working and done itself.");
		expect(describeStatusLine({ ...VIEWS[0]!, reports: [] })?.text).toBe("Reports its status itself.");
	});

	test("GitHub Copilot CLI reports itself (issue 354), in the mock engine as in the main process, so no hook is offered", async () => {
		const engine = createMockEngine();
		await engine.savePreferences({ agents: [{ name: "Copilot", command: "copilot" }] });
		const view = (await engine.statusHooks()).find(each => each.agent === "copilot")!;
		expect(describeStatusLine(view)).toEqual({ label: "Status", text: "Reports working, needs you, and done itself.", tone: "hint", actions: [] });
		expect(await engine.installStatusHook({ agent: "copilot", token: "missing" })).toMatchObject({ outcome: "refused" });
	});

	test("an agent that cannot report, or one not known, shows none", () => {
		expect(describeStatusLine(VIEWS[3]!)).toBeNull();
		expect(describeStatusLine({ name: "Odd", agent: null, source: "none", reports: [], hook: null })).toBeNull();
	});

	test("a hook says off, on, changed, or broken, with what can be done about it", () => {
		expect(describeStatusLine(cursor())).toEqual({ label: "Status hook", text: "Off. Its sessions show only running or exited.", tone: "hint", actions: [{ action: "install", label: "Turn on…" }] });
		expect(describeStatusLine(cursor({ state: { kind: "on" } }))).toEqual({
			label: "Status hook", text: "On, in ~/.cursor/hooks.json. Reports working and done; not needs you.", tone: "hint", actions: [{ action: "remove", label: "Remove…" }],
		});
		const gemini: StatusHookView = { name: "Gemini CLI", agent: "gemini", source: "hook", reports: ["working", "blocked", "done"], hook: hook({ agent: "gemini", agentName: "Gemini CLI", file: "~/.gemini/settings.json", state: { kind: "on" } }) };
		expect(describeStatusLine(gemini)?.text).toBe("On, in ~/.gemini/settings.json. Reports working, needs you, and done.");
		expect(describeStatusLine(cursor({ state: { kind: "changed", reason: "An entry of the app's is not as the app writes it." } }))).toEqual({
			label: "Status hook changed",
			text: "An entry of the app's is not as the app writes it. Checked against Cursor CLI 2026.11.22 on 2026-11-22. The app does not rewrite it.",
			tone: "error",
			actions: [{ action: "differs", label: "Show what differs…" }, { action: "remove", label: "Remove…" }],
		});
		expect(describeStatusLine(cursor({ state: { kind: "broken", reason: "It is not valid JSON." } }))).toEqual({
			label: "Status hook broken", text: "It is not valid JSON. Fix it by hand, then open Settings, Agents again.", tone: "error", actions: [],
		});
		// Only the script is missing: the app's entries can still be taken out.
		expect(describeStatusLine(cursor({ state: { kind: "broken", reason: "The script is missing." }, present: ["a"] }))).toMatchObject({
			text: "The script is missing. Remove takes out the app's entries, or fix it by hand, then open Settings, Agents again.", actions: [{ action: "remove", label: "Remove…" }],
		});
		// A script not as written: nothing differs among the entries, so only Remove.
		expect(describeStatusLine(cursor({ state: { kind: "changed", reason: "The script is not as the app writes it.", script: true }, present: ["a"] }))?.actions).toEqual([{ action: "remove", label: "Remove…" }]);
	});

	test("a file the app does not write offers the entries to add or take out by hand", () => {
		const byHand = "~/.cursor/hooks.json is a link to /home/you/dotfiles/hooks.json, so the app does not write it: it may be in a repository.";
		expect(describeStatusLine(cursor({ byHand }))).toMatchObject({ text: `Off. ${byHand}`, actions: [{ action: "add-by-hand", label: "Show the entries to add…" }] });
		expect(describeStatusLine(cursor({ byHand, state: { kind: "on" } }))?.actions).toEqual([{ action: "remove-by-hand", label: "Show the entries to remove…" }]);
	});
});

describe("the status hook dialogs", () => {
	test("Turn on shows the file, whether it is there, the exact entries, and the whole script, before anything is written", () => {
		const model = describeHookDialog(hook(), ["working", "done"], "install");
		expect(model.title).toBe("Turn on the Cursor CLI status hook?");
		expect(model.lead).toBe("Cursor CLI does not report its status. This adds an entry to its hooks file, so its sessions in the app show working and done, with their notifications and sounds. Cursor CLI runs them in every terminal; outside the app they do nothing.");
		expect(model.note).toBe("Adds to ~/.cursor/hooks.json. Nothing else in it changes.");
		expect(model.blocks).toEqual([
			{ label: "Added to ~/.cursor/hooks.json", text: ENTRIES },
			{ label: "The script they run, ~/.config/timber-app/status-hook", text: STATUS_HOOK_SCRIPT },
		]);
		expect(model.confirm).toEqual({ label: "Turn on", danger: false, running: "Turning on…" });
		expect(describeHookDialog(hook({ exists: false }), ["working", "done"], "install")).toMatchObject({ note: "Makes ~/.cursor/hooks.json, which is not there yet.", blocks: [{ label: "~/.cursor/hooks.json" }, {}] });
		// Gemini CLI's dialog says, before anything is written, that it runs hooks only in a folder it trusts.
		expect(describeHookDialog(hook({ agent: "gemini", agentName: "Gemini CLI", file: "~/.gemini/settings.json" }), ["working", "blocked", "done"], "install").note).toBe(
			"Adds to ~/.gemini/settings.json. Nothing else in it changes. Gemini CLI runs hooks only in a folder it trusts, so a session in a new worktree reports nothing until you trust that folder, or one above it, in Gemini CLI.",
		);
	});

	test("Remove shows exactly what goes, and its button is the dangerous one", () => {
		const model = describeHookDialog(hook({ state: { kind: "on" }, present: ['"stop": {"command":"x","timeout":5}'] }), ["working", "done"], "remove");
		expect(model.title).toBe("Remove the Cursor CLI status hook?");
		expect(model.blocks).toEqual([{ label: "Removed from ~/.cursor/hooks.json", text: '"stop": {"command":"x","timeout":5}' }]);
		expect(model.confirm).toEqual({ label: "Remove", danger: true, running: "Removing…" });
	});

	test("by hand, the entries can be copied, and what differs leads on to Remove", () => {
		const byHand = "~/.cursor/hooks.json holds comments, which the app would drop if it wrote the file.";
		const add = describeHookDialog(hook({ byHand }), ["working", "done"], "add-by-hand");
		expect(add).toMatchObject({ title: "Add the Cursor CLI status hook by hand", copy: ENTRIES, confirm: { label: "Done" }, note: "Done puts the script they run at ~/.config/timber-app/status-hook, in the app's own folder." });
		expect(add.lead.startsWith(byHand)).toBe(true);
		expect(describeHookDialog(hook({ byHand, present: ["a"] }), [], "remove-by-hand")).toMatchObject({ copy: "a", confirm: null, cancel: "Close" });
		const differs = describeHookDialog(hook({ state: { kind: "changed", reason: "Changed." }, present: ["a"] }), [], "differs");
		expect(differs.blocks.map(block => block.label)).toEqual(["In ~/.cursor/hooks.json now", "As the app writes them"]);
		expect(differs.next).toEqual({ action: "remove", label: "Remove…" });
	});
});

describe("Settings, Agents with status hooks", () => {
	const noop = () => {};
	const view = (drafts = agentDraftsOf(SAVED), hooks: StatusHookView[] | null = VIEWS) =>
		renderToStaticMarkup(<AgentsSectionView drafts={drafts} saved={SAVED} locations={null} save={{ state: "idle" }} onAdd={noop} onEdit={noop} onRemove={noop} onSave={noop} hooks={hooks} />);

	test("each saved row shows its status line", () => {
		const markup = view();
		expect(markup).toContain('<span class="agent-status-label">Status</span> Reports working, needs you, and done itself.');
		expect(markup).toContain('<span class="agent-status-label">Status hook</span> Off. Its sessions show only running or exited.');
		expect(markup).toContain('aria-label="Turn on for Cursor CLI">Turn on…</button>');
		expect(markup.match(/agent-status-label/g)).toHaveLength(3);
	});

	test("a row being edited, or rows not read yet, show none", () => {
		const drafts = agentDraftsOf(SAVED);
		const edited = editAgentDraft(drafts, drafts[2]!.key, { command: "cursor-agent --model x" });
		expect(view(edited)).not.toContain("Status hook");
		expect(view(drafts, null)).not.toContain("agent-status");
	});

	test("Settings, Notifications says where hooks are turned on", () => {
		const draft = notificationsDraftOf(defaultPreferences());
		const markup = renderToStaticMarkup(
			<NotificationsSectionView draft={draft} saved={draft} save={{ state: "idle" }} problem={null} customPaths={{}} onEdit={() => {}} onChooseFile={() => {}} onPlay={() => {}} onSave={() => {}} />,
		);
		expect(markup).toContain("Agents that do not report their status themselves, such as Cursor CLI and OpenCode 1, need a status hook, turned on in Settings, Agents.");
	});
});

describe("status hooks through the store, over the mock engine", () => {
	test("a session of a hooked agent starting reads the hooks again; another agent's does not", async () => {
		const engine = createMockEngine();
		let reads = 0;
		const counted = { ...engine, statusHooks: () => { reads += 1; return engine.statusHooks(); } };
		const store = createAppStore(counted, () => () => {});
		store.start();
		await settle();
		await store.savePreferences({ agents: SAVED });
		await settle();
		const worktree = store.getState().repositories[0]!.worktrees[0]!;
		const before = reads;
		await store.openTerminal({ repository: store.getState().repositories[0]!.path, worktree: worktree.path, cols: 80, rows: 24, agent: "Claude Code" });
		await settle();
		expect(reads).toBe(before);
		await store.openTerminal({ repository: store.getState().repositories[0]!.path, worktree: worktree.path, cols: 80, rows: 24, agent: "Cursor CLI" });
		await settle();
		expect(reads).toBe(before + 1);
	});

	test("Turn on writes the entries, Remove takes them out, and a stale view writes nothing", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		await store.savePreferences({ agents: SAVED });
		await store.loadStatusHooks();
		const shown = store.getState().statusHooks!.find(row => row.agent === "cursor")!.hook!;
		expect(shown.state).toEqual({ kind: "off" });
		engine.setStatusHookFile("cursor", { text: '{"version":1,"hooks":{}}' });
		expect(await store.installStatusHook({ agent: "cursor", token: shown.token })).toMatchObject({ outcome: "changed-since" });
		const again = store.getState().statusHooks!.find(row => row.agent === "cursor")!.hook!;
		const on = await store.installStatusHook({ agent: "cursor", token: again.token });
		expect(on.outcome).toBe("done");
		expect(store.getState().statusHooks!.find(row => row.agent === "cursor")!.hook!.state).toEqual({ kind: "on" });
		expect(JSON.parse(engine.statusHookFile("cursor").text!).hooks.stop).toHaveLength(1);
		const token = store.getState().statusHooks!.find(row => row.agent === "cursor")!.hook!.token;
		expect((await store.removeStatusHook({ agent: "cursor", token })).outcome).toBe("done");
		// Nothing else was in the file, so it goes.
		expect(engine.statusHookFile("cursor").text).toBeNull();
	});
});
