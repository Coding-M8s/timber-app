import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { NotificationsSectionView } from "../src/mainview/components/settings/NotificationsSection";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { sessionsOf } from "../src/mainview/store/state";
import { takeTerminalFocus } from "../src/mainview/terminal-focus";
import { createAppStore } from "../src/mainview/store/store";
import { describeRowSessions, describeSessionChip, describeTerminalState } from "../src/mainview/terminal-format";
import { PROBE_ANSWER } from "../src/shared/program-status";
import { type ShownStatus, agentBrand, describeShownStatus, hasStatusMark, mostUrgent, sessionInitials, shortMessage, shownStatus, summarizeStatuses } from "../src/shared/session-status";
import { createStatusNotices, onScreen } from "../src/shared/status-notices";
import type { TerminalSession } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const primaryId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === TIMBER)!.id;
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** A started store with Codex and a shell in the feature worktree, and the primary checkout selected, so the feature is not on screen. */
async function withAgent() {
	const engine = createMockEngine();
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(featureId);
	await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, agent: "Codex" });
	await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
	await settle();
	store.select(primaryId);
	await settle();
	const [agent, shell] = sessionsOf(store.getState(), featureId);
	const report = async (pairs: string, id = agent!.id) => {
		engine.agentStatus(id, pairs);
		await settle();
	};
	const current = (id = agent!.id) => store.getState().terminals.find(session => session.id === id)!;
	return { engine, store, agent: agent!, shell: shell!, report, current };
}

const session = (change: Partial<TerminalSession> = {}): TerminalSession => ({
	id: "s", kind: "agent", name: "Codex", repository: TIMBER, worktree: featureId, path: FEATURE, shell: "/usr/local/bin/codex", command: "codex",
	state: { kind: "running" }, status: null, ...change,
});
const status = (state: "idle" | "working" | "done" | "blocked" | "error", more: Partial<NonNullable<TerminalSession["status"]>> = {}) =>
	({ state, kind: null, progress: null, app: null, title: null, message: null, ...more });

describe("a session's status as shown", () => {
	test("each reported state, and the process exit over any report", () => {
		expect(shownStatus(session())).toEqual({ kind: "unknown" });
		expect(shownStatus(session({ status: status("working", { progress: 40 }) }))).toEqual({ kind: "working", progress: 40 });
		expect(shownStatus(session({ status: status("blocked", { kind: "permission" }) }))).toEqual({ kind: "needs-you", reason: "permission" });
		expect(shownStatus(session({ status: status("done") }))).toEqual({ kind: "done" });
		expect(shownStatus(session({ status: status("idle") }))).toEqual({ kind: "idle" });
		expect(shownStatus(session({ status: status("error") }))).toEqual({ kind: "error" });
		expect(shownStatus(session({ state: { kind: "exited", exitCode: 0, signal: null }, status: status("done") }))).toEqual({ kind: "stopped" });
		expect(shownStatus(session({ state: { kind: "exited", exitCode: 2, signal: null } }))).toEqual({ kind: "crashed", exitCode: 2, signal: null });
		expect(shownStatus(session({ state: { kind: "exited", exitCode: null, signal: "SIGKILL" } }))).toEqual({ kind: "crashed", exitCode: null, signal: "SIGKILL" });
	});

	test("in words", () => {
		const words = (status: ShownStatus) => describeShownStatus(status);
		expect(words({ kind: "working", progress: null })).toBe("Working");
		expect(words({ kind: "working", progress: 40 })).toBe("Working, 40%");
		expect(words({ kind: "needs-you", reason: "permission" })).toBe("Needs you: approval");
		expect(words({ kind: "needs-you", reason: "question" })).toBe("Needs you: question");
		expect(words({ kind: "needs-you", reason: "auth" })).toBe("Needs you: sign-in");
		expect(words({ kind: "needs-you", reason: null })).toBe("Needs you");
		expect(words({ kind: "done" })).toBe("Done");
		expect(words({ kind: "idle" })).toBe("Idle");
		expect(words({ kind: "error" })).toBe("Error");
		expect(words({ kind: "stopped" })).toBe("Stopped");
		expect(words({ kind: "crashed", exitCode: 1, signal: null })).toBe("Crashed, exit 1");
		expect(words({ kind: "crashed", exitCode: null, signal: "SIGSEGV" })).toBe("Crashed, SIGSEGV");
		expect(words({ kind: "unknown" })).toBe("Running");
	});

	test("agents always get a mark; other sessions only while they run with a status", () => {
		expect(hasStatusMark(session())).toBe(true);
		expect(hasStatusMark(session({ kind: "terminal" }))).toBe(false);
		expect(hasStatusMark(session({ kind: "terminal", status: status("working") }))).toBe(true);
		expect(hasStatusMark(session({ kind: "terminal", status: status("done"), state: { kind: "exited", exitCode: 0, signal: null } }))).toBe(false);
	});

	test("a summary puts Needs you first and leaves out stopped and unknown", () => {
		const statuses: ShownStatus[] = [{ kind: "working", progress: null }, { kind: "stopped" }, { kind: "needs-you", reason: null }, { kind: "working", progress: 3 }, { kind: "unknown" }];
		expect(summarizeStatuses(statuses)).toBe("1 needs you, 2 working");
		expect(mostUrgent(statuses)).toBe("needs-you");
		expect(summarizeStatuses([{ kind: "stopped" }, { kind: "unknown" }])).toBe("");
		expect(mostUrgent([])).toBeNull();
	});

	test("the chip and the state beside the chips say it, with the message", () => {
		const blocked = session({ status: status("blocked", { kind: "permission", message: "approve Write: src/a.ts" }) });
		expect(describeSessionChip(blocked, false)).toBe("Agent, codex. Needs you: approval. approve Write: src/a.ts");
		expect(describeTerminalState(blocked)).toBe("Needs you: approval");
		const crashed = session({ state: { kind: "exited", exitCode: 3, signal: null } });
		expect(describeSessionChip(crashed, false)).toBe("Agent, codex. Crashed. Exited with code 3");
		expect(describeTerminalState(crashed)).toBe("Crashed. Exited with code 3");
		expect(describeTerminalState(session({ state: { kind: "exited", exitCode: 0, signal: null } }))).toBe("Stopped");
		expect(describeSessionChip(session(), false)).toBe("Agent, codex");
		expect(describeTerminalState(session({ kind: "terminal" }))).toBe("Running");
	});

	test("marks on one row are told apart by as many first letters as it takes", () => {
		expect(sessionInitials(["Codex"])).toEqual(["C"]);
		expect(sessionInitials(["Claude Code", "Codex", "Aider"])).toEqual(["Cl", "Co", "A"]);
		expect(sessionInitials(["Codex", "Codex 2"])).toEqual(["Cod", "Cod"]);
		expect(sessionInitials([" "])).toEqual(["?"]);
	});

	test("Claude Code is known by its executable or the app it reports, and shows its icon instead of letters", () => {
		expect(agentBrand(session({ shell: "/home/me/.local/bin/claude" }))).toBe("claude");
		expect(agentBrand(session({ kind: "terminal", shell: "/bin/zsh", status: status("working", { app: "claude-code" }) }))).toBe("claude");
		expect(agentBrand(session())).toBe("codex");
		expect(agentBrand(session({ shell: "/usr/bin/aider" }))).toBeNull();
		expect(agentBrand(session({ kind: "terminal", shell: "/bin/sh", status: status("done", { app: "codex" }) }))).toBe("codex");
		expect(agentBrand(session({ kind: "terminal", shell: "/usr/bin/claude" }))).toBeNull();
		const rows = describeRowSessions([
			session({ id: "a", name: "Claude Code", shell: "/usr/local/bin/claude" }),
			session({ id: "b", name: "Codex" }),
			session({ id: "c", name: "Aider", shell: "/usr/bin/aider" }),
		]);
		expect(rows.marks.map(mark => [mark.brand, mark.initial])).toEqual([["claude", ""], ["codex", ""], [null, "A"]]);
	});

	test("the row draws Claude Code's icon in an outline, and the chip draws it in place of the star", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.select(featureId);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, agent: "Claude Code" });
		await settle();
		const markup = render(store);
		expect(markup).toMatch(/<span class="row-agent status-unknown branded" title="Claude Code: Running" aria-hidden="true"><svg class="status-glyph status-unknown"[^]*?<\/svg><svg class="agent-icon agent-icon-claude"/);
		expect(markup).toContain('<span class="session-kind branded" aria-hidden="true"><svg class="agent-icon agent-icon-claude"');
	});

	test("a long message is cut for showing", () => {
		expect(shortMessage("a".repeat(200))).toBe("a".repeat(200));
		expect(shortMessage("a".repeat(500))).toBe(`${"a".repeat(197)}...`);
		expect(describeSessionChip(session({ status: status("blocked", { message: "b".repeat(2000) }) }), false)).toHaveLength("Agent, codex. Needs you. ".length + 200);
	});

	test("a row names each agent and counts the other sessions", () => {
		const rows = describeRowSessions([
			// Agents the app has no icon for, so they are told apart by their letters.
			session({ id: "a", shell: "/usr/bin/cody", status: status("blocked", { kind: "question" }) }),
			session({ id: "b", name: "Claude Code", shell: "/usr/bin/cline", status: status("working") }),
			session({ id: "c", kind: "terminal", name: "Terminal" }),
			session({ id: "d", kind: "terminal", name: "Terminal 2", state: { kind: "exited", exitCode: 0, signal: null } }),
		]);
		expect(rows.marks.map(mark => [mark.initial, mark.status.kind])).toEqual([["Co", "needs-you"], ["Cl", "working"]]);
		expect(rows.others).toBe(1);
		expect(rows.sentence).toBe("Codex: Needs you: question. Claude Code: Working. 1 other session running.");
	});
});

describe("agent status in the app", () => {
	test("the probe is answered, and a report reaches the session without changing what it printed", async () => {
		const { engine, agent, report, current } = await withAgent();
		await report("?");
		expect(engine.probeAnswers(agent.id)).toEqual([PROBE_ANSWER]);
		await report(`state=blocked:kind=permission:msg=${b64("approve Write: src/a.ts")}`);
		expect(current().status).toMatchObject({ state: "blocked", kind: "permission", message: "approve Write: src/a.ts" });
		expect((await engine.readTerminal(agent.id))!.data).toContain(`\x1b]7501;state=blocked:kind=permission:msg=`);
	});

	test("the row shows each agent's state in a shape, its name in words, and the shell as a count", async () => {
		const { store, report } = await withAgent();
		await report("state=working:progress=30");
		const markup = render(store);
		expect(markup).toContain('<span class="row-agent status-working branded" title="Codex: Working, 30%" aria-hidden="true"><svg class="status-glyph status-working"');
		expect(markup).toContain('<span class="row-shells" title="1 other session running"><span class="row-sessions-dot"></span>1</span>');
		expect(markup).toContain("Codex: Working, 30%. 1 other session running.</span>");
	});

	test("the chip shows the state, and its message is in the tooltip", async () => {
		const { store, agent, report } = await withAgent();
		store.select(featureId);
		store.showSession(agent.id);
		await report(`state=blocked:kind=question:msg=${b64("Which branch?")}`);
		const markup = render(store);
		expect(markup).toContain('title="Agent, codex. Needs you: question. Which branch?. Double-click or F2 renames, Delete closes."');
		expect(markup).toContain('<svg class="status-glyph status-needs-you"');
		// A question gets a raised hand instead of the diamond.
		expect(markup).toContain('class="status-hand"');
		expect(markup).toContain('<span class="session-state" role="status">Needs you: question</span>');
	});

	test("an exit ends a working report: 0 is stopped, anything else crashed", async () => {
		const { engine, agent, report, current } = await withAgent();
		await report("state=working");
		engine.endTerminal(agent.id, 0);
		await settle();
		expect(current().status).toBeNull();
		expect(shownStatus(current())).toEqual({ kind: "stopped" });
	});

	test("a collapsed repository sums up its agents; an expanded one shows nothing extra", async () => {
		const { store, report } = await withAgent();
		await report("state=blocked");
		expect(render(store)).not.toContain("group-status");
		store.toggleGroup(TIMBER);
		const markup = render(store);
		expect(markup).toContain('<span class="group-status status-needs-you" aria-hidden="true">1 needs you</span>');
		expect(markup).toContain(">Agents: 1 needs you.</span>");
	});
});

describe("desktop notifications", () => {
	const away = { visible: true, focused: true, selected: { repository: TIMBER, worktree: TIMBER } };
	const here = { visible: true, focused: true, selected: { repository: TIMBER, worktree: FEATURE } };
	const change = (more: Partial<TerminalSession> = {}) => ({ id: "s", session: session(more) });

	test("one when an agent moves to Needs you, Done, Error, or crashed in a worktree not on screen", () => {
		const notices = createStatusNotices(1000);
		expect(notices.changed(change(), away, true, 0)).toBeNull();
		expect(notices.changed(change({ status: status("working") }), away, true, 0)).toBeNull();
		expect(notices.changed(change({ status: status("blocked", { kind: "permission", message: "approve Write: src/a.ts" }) }), away, true, 0))
			.toEqual({ session: "s", title: "Codex needs you", body: "In feat-github-issue-lookup: approve Write: src/a.ts" });
		expect(notices.changed(change({ status: status("done") }), away, true, 2000)).toEqual({ session: "s", title: "Codex is done", body: "In feat-github-issue-lookup: Done" });
		expect(notices.changed(change({ status: status("error") }), away, true, 4000)?.title).toBe("Codex reported an error");
		expect(notices.changed(change({ state: { kind: "exited", exitCode: 1, signal: null } }), away, true, 6000)).toEqual({ session: "s", title: "Codex crashed", body: "In feat-github-issue-lookup: Crashed, exit 1" });
	});

	test("none for the worktree on screen in a focused window, but one when the window is hidden or not focused", () => {
		expect(onScreen(session(), here)).toBe(true);
		expect(onScreen(session(), { ...here, focused: false })).toBe(false);
		expect(onScreen(session(), { ...here, visible: false })).toBe(false);
		expect(onScreen(session(), { ...here, selected: { repository: "/other", worktree: FEATURE } })).toBe(false);
		const notices = createStatusNotices(0);
		notices.changed(change({ status: status("working") }), here, true, 0);
		expect(notices.changed(change({ status: status("done") }), here, true, 0)).toBeNull();
		notices.changed(change({ status: status("working") }), here, true, 0);
		expect(notices.changed(change({ status: status("done") }), { ...here, focused: false }, true, 0)).not.toBeNull();
	});

	test("none when turned off, none for the same state again, none for a stopped agent, and none for a plain shell", () => {
		const notices = createStatusNotices(0);
		notices.changed(change({ status: status("working") }), away, true, 0);
		expect(notices.changed(change({ status: status("done") }), away, false, 0)).toBeNull();
		expect(notices.changed(change({ status: status("done") }), away, true, 0)).toBeNull();
		expect(notices.changed(change({ state: { kind: "exited", exitCode: 0, signal: null } }), away, true, 0)).toBeNull();
		const shells = createStatusNotices(0);
		shells.changed(change({ kind: "terminal" }), away, true, 0);
		expect(shells.changed(change({ kind: "terminal", state: { kind: "exited", exitCode: 1, signal: null } }), away, true, 0)).toBeNull();
	});

	test("rate limited for each session and status, and Needs you right after Done still told", () => {
		const notices = createStatusNotices(10_000);
		notices.changed(change({ status: status("working") }), away, true, 0);
		expect(notices.changed(change({ status: status("done") }), away, true, 0)).not.toBeNull();
		notices.changed(change({ status: status("working") }), away, true, 1000);
		expect(notices.changed(change({ status: status("done") }), away, true, 2000)).toBeNull();
		expect(notices.changed(change({ status: status("blocked") }), away, true, 3000)).not.toBeNull();
		notices.changed(change({ status: status("working") }), away, true, 10_500);
		expect(notices.changed(change({ status: status("done") }), away, true, 11_000)).not.toBeNull();
		const other = { id: "t", session: { ...session({ status: status("working") }), id: "t" } };
		notices.changed(other, away, true, 11_000);
		expect(notices.changed({ ...other, session: { ...other.session, status: status("done") } }, away, true, 11_000)).not.toBeNull();
	});

	test("the mock decides as the main process does, and a click selects the worktree and shows the session", async () => {
		const { engine, store, agent, report } = await withAgent();
		await report("state=working");
		await report("state=done");
		expect(engine.notices()).toEqual([{ session: agent.id, title: "Codex is done", body: "In feat-github-issue-lookup: Done" }]);
		store.showTab("changes");
		engine.clickNotice(agent.id);
		const state = store.getState();
		expect(state.selection?.worktree).toBe(featureId);
		expect(state.tab).toBe("workspace");
		expect(state.shownSessions[featureId]).toBe(agent.id);
		// Its terminal is asked to take the keyboard once it shows.
		expect(takeTerminalFocus(featureId)).toBe(true);
	});

	test("a click for a session that is gone changes nothing", async () => {
		const { engine, store } = await withAgent();
		const before = store.getState();
		engine.clickNotice("gone");
		expect(store.getState()).toBe(before);
		expect(takeTerminalFocus(featureId)).toBe(false);
	});

	test("the setting turns them off", async () => {
		const { engine, store, report } = await withAgent();
		expect((await store.savePreferences({ statusNotifications: false })).outcome).toBe("saved");
		await report("state=working");
		await report("state=done");
		expect(engine.notices()).toEqual([]);
	});
});

describe("the Notifications section of Settings", () => {
	test("a box to turn notifications off, saved with its own Save", () => {
		const save = { state: "idle" } as const;
		const markup = renderToStaticMarkup(<NotificationsSectionView enabled={false} saved={true} save={save} onEdit={() => {}} onSave={() => {}} />);
		expect(markup).toContain("Notify when an agent needs you or is done");
		expect(markup).toMatch(/<input type="checkbox"\/>/);
	});
});
