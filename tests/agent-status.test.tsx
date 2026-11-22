import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { NotificationsSectionView } from "../src/mainview/components/settings/NotificationsSection";
import { describeSoundOutcome, notificationsDraftOf, sameNotificationsDraft, pickSound, soundOptionOf, toggleState, withStateSound } from "../src/mainview/notifications-format";
import { defaultStateSounds } from "../src/shared/sound-setting";
import { defaultPreferences } from "../src/shared/preferences";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { sessionsOf } from "../src/mainview/store/state";
import { takeTerminalFocus } from "../src/mainview/terminal-focus";
import { createAppStore } from "../src/mainview/store/store";
import { describeRowSessions, describeSessionChip, describeTerminalState, shortExit } from "../src/mainview/terminal-format";
import { PROBE_ANSWER } from "../src/shared/program-status";
import { type ShownStatus, agentBrand, describeShownStatus, hasStatusMark, mostUrgent, sessionInitials, shortMessage, shownStatus, summarizeStatuses } from "../src/shared/session-status";
import { type TerminalSession, agentEndedNote, describeAgentExit } from "../src/shared/terminal";

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
	state: { kind: "running" }, status: null, children: [], ...change,
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

	test("an agent that ended and left a shell shows how it ended, until a program in the shell reports", () => {
		const ended = (exitCode: number | null, signal: string | null = null) => session({ kind: "terminal", shell: "/bin/zsh", endedAgent: { name: "Codex", agent: "Codex", program: "codex", resumable: "codex", conversation: null, command: "codex", exitCode, signal } });
		expect(shownStatus(ended(0))).toEqual({ kind: "stopped" });
		expect(shownStatus(ended(3))).toEqual({ kind: "crashed", exitCode: 3, signal: null });
		expect(shownStatus(ended(null, "SIGKILL"))).toEqual({ kind: "crashed", exitCode: null, signal: "SIGKILL" });
		// What a program in the shell reports wins, and an exited shell is its own exit.
		expect(shownStatus({ ...ended(3), status: status("working") })).toEqual({ kind: "working", progress: null });
		expect(shownStatus({ ...ended(0), state: { kind: "exited", exitCode: 2, signal: null } })).toEqual({ kind: "crashed", exitCode: 2, signal: null });
		// A clean end leaves a plain terminal, counted with the others; a crash keeps its mark while the shell runs.
		expect(hasStatusMark(ended(0))).toBe(false);
		expect(hasStatusMark(ended(3))).toBe(true);
		expect(hasStatusMark(ended(null, "SIGKILL"))).toBe(true);
		// Once the shell itself exits it is a plain ended terminal again, so its exit is never told as the agent's crash.
		expect(hasStatusMark({ ...ended(0), state: { kind: "exited", exitCode: 1, signal: null } })).toBe(false);
		expect(agentBrand(ended(0))).toBe("codex");
		expect(agentBrand(session({ kind: "terminal", shell: "/bin/zsh" }))).toBeNull();
		expect(shortExit({ kind: "running" }, ended(3).endedAgent)).toBe("exit 3");
		expect(shortExit({ kind: "running" }, ended(null, "SIGKILL").endedAgent)).toBe("SIGKILL");
		expect(shortExit({ kind: "running" })).toBeNull();
		expect(describeAgentExit({ exitCode: 3, signal: null })).toBe("Exited with code 3");
		expect(describeAgentExit({ exitCode: null, signal: "SIGKILL" })).toBe("Stopped by SIGKILL");
		expect(describeSessionChip(ended(0), false)).toBe("Terminal, zsh. Codex ended. Exited with code 0. Now a shell");
		expect(describeSessionChip(ended(3), true)).toBe("Terminal, zsh. Codex ended. Exited with code 3. Now a shell. New output since you last looked");
		expect(describeSessionChip({ ...ended(3), status: status("working") }, false)).toBe("Terminal, zsh. Codex ended. Exited with code 3. Now a shell. Working");
		expect(describeTerminalState(ended(0))).toBe("Running");
		expect(describeTerminalState(ended(3))).toBe("Crashed. Exited with code 3");
	});

	test("on the row, a shell left by a clean agent end counts with the running sessions, and one left by a crash keeps its mark", () => {
		const left = (id: string, exitCode: number) => session({ id, kind: "terminal", name: "Codex", shell: "/bin/zsh", endedAgent: { name: "Codex", agent: "Codex", program: "codex", resumable: "codex", conversation: null, command: "codex", exitCode, signal: null } });
		const clean = describeRowSessions([left("a", 0)]);
		expect(clean.marks).toEqual([]);
		expect(clean.others).toBe(1);
		const crashed = describeRowSessions([left("b", 3)]);
		expect(crashed.marks.map(mark => mark.status)).toEqual([{ kind: "crashed", exitCode: 3, signal: null }]);
		expect(crashed.others).toBe(0);
	});

	test("the note an ended agent leaves resets the terminal modes, keeps the output, and says what happened", () => {
		const note = agentEndedNote("Codex", { exitCode: 3, signal: null }, "/work/feature");
		expect(note).toBe("\x1b[?1047l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[?25h\x1b[<u\x1b[0m\r\n\x1b[2mCodex exited with code 3. This is now a shell in /work/feature.\x1b[0m\r\n");
		expect(note).not.toContain("\x1bc");
		// 1049 would also move the cursor to a saved place, the top left when none was saved.
		expect(note).not.toContain("\x1b[?1049l");
		expect(agentEndedNote("Codex", { exitCode: null, signal: "SIGKILL" }, "/w")).toContain("Codex was stopped by SIGKILL. This is now a shell in /w.");
	});

	test("an agent in the mock engine that ends goes on as a terminal in the same session", async () => {
		const { engine, store, agent, shell, current } = await withAgent();
		engine.endTerminal(agent.id, 3);
		await settle();
		expect(current()).toMatchObject({ id: agent.id, name: agent.name, kind: "terminal", state: { kind: "running" }, status: null, children: [], endedAgent: { name: "Codex", agent: "Codex", exitCode: 3, signal: null } });
		expect(current().shell).not.toBe(agent.shell);
		expect(store.getState().terminals.filter(session => session.state.kind === "running")).toHaveLength(2);
		const printed = (await engine.readTerminal(agent.id))!.data;
		expect(printed).toContain("Codex exited with code 3. This is now a shell in");
		store.select(featureId);
		await settle();
		const markup = render(store);
		expect(markup).toContain('<span class="session-exit" aria-hidden="true">exit 3</span>');
		expect(markup).toContain("Terminal, mock-shell. Codex ended. Exited with code 3. Now a shell");
		expect(engine.typedInto(agent.id)).toBe("");
		engine.writeTerminal(agent.id, "pwd\r");
		await settle();
		expect((await engine.readTerminal(agent.id))!.data).toContain(`\r\n${FEATURE}\r\n`);
		engine.writeTerminal(agent.id, "exit\r");
		await settle();
		expect(current()).toMatchObject({ kind: "terminal", state: { kind: "exited", exitCode: 0 }, endedAgent: { exitCode: 3 } });
		expect(shell.state.kind).toBe("running");
	});

	test("typing exit in a mock agent falls back the same way", async () => {
		const { engine, agent, current } = await withAgent();
		engine.writeTerminal(agent.id, "exit\r");
		await settle();
		expect(current()).toMatchObject({ kind: "terminal", state: { kind: "running" }, endedAgent: { exitCode: 0 } });
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
		expect(markup).toContain('title="Agent, codex. Needs you: question. Which branch?. Double-click or F2 renames, Delete closes, a right-click inserts a chop."');
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
	test("the mock decides as the main process does, and a click selects the worktree and shows the session", async () => {
		const { engine, store, agent, report } = await withAgent();
		await report("state=working");
		await report("state=done");
		expect(engine.notices()).toEqual([{ session: agent.id, title: "Codex is done", body: "In feat-github-issue-lookup: Done" }]);
		store.showTab("pull-request");
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

	test("a session keeps one notification, replaced by its next one and withdrawn once its worktree is on screen", async () => {
		const { engine, store, agent, report } = await withAgent();
		await report("state=working");
		await report("state=done");
		await report(`state=blocked:kind=question:msg=${b64("which branch?")}`);
		expect(engine.notices()).toEqual([{ session: agent.id, title: "Codex needs you", body: "In feat-github-issue-lookup: which branch?" }]);
		store.select(featureId);
		await settle();
		expect(engine.notices()).toEqual([]);
	});

	test("a status the person moved past is withdrawn", async () => {
		const { engine, report } = await withAgent();
		await report("state=working");
		await report("state=blocked");
		expect(engine.notices()).toHaveLength(1);
		await report("state=working");
		expect(engine.notices()).toEqual([]);
	});

	test("sounds play only for the states chosen, each its own, never for the worktree on screen", async () => {
		const { engine, store, agent, report } = await withAgent();
		const ping = { kind: "bundled" as const, name: "ping" as const };
		const bell = { kind: "custom" as const, path: "/home/me/sounds/bell.ogg" };
		await report("state=working");
		await report("state=done");
		expect(engine.alertSounds()).toEqual([]);
		expect((await store.savePreferences({ sounds: { ...defaultStateSounds(), "needs-you": ping, error: bell } })).outcome).toBe("saved");
		await report("state=blocked");
		await report("state=error");
		expect(engine.alertSounds()).toEqual([{ session: agent.id, sound: ping }, { session: agent.id, sound: bell }]);
		store.select(featureId);
		await settle();
		await report("state=working");
		await report("state=error");
		expect((await store.savePreferences({ sounds: { ...defaultStateSounds(), error: { kind: "system" } } })).outcome).toBe("saved");
		await report("state=working");
		await report("state=error");
		expect(engine.alertSounds()).toHaveLength(2);
	});
});

describe("the Notifications section of Settings", () => {
	const saved = notificationsDraftOf(defaultPreferences());
	const view = (draft = saved, more: Partial<Parameters<typeof NotificationsSectionView>[0]> = {}) => renderToStaticMarkup(
		<NotificationsSectionView draft={draft} saved={saved} save={{ state: "idle" }} problem={null} customPaths={{}} onEdit={() => {}} onChooseFile={() => {}} onPlay={() => {}} onSave={() => {}} {...more} />,
	);

	test("a main switch, and for each state a Notify box, its own sound, and Play", () => {
		const markup = view();
		expect(markup).toContain("Show desktop notifications");
		for (const state of ["Needs you", "Done", "Error", "Crashed"]) {
			expect(markup).toContain(`aria-label="Notify: ${state}" checked=""`);
			expect(markup).toContain(`aria-label="Sound: ${state}"`);
			// None by default, so Play has nothing to play.
			expect(markup).toContain(`aria-label="Play sound: ${state}" disabled=""`);
		}
		expect(markup.match(/<option value="none" selected="">None<\/option>/g)).toHaveLength(4);
		expect(markup).toContain('<option value="bundled:chime">Chime</option>');
		expect(markup).toContain('<option value="system">System sound</option>');
		expect(markup).toContain(">Your own file...</option>");
		expect(markup).toContain("None until you choose one.");
		expect(markup.match(/Your own file can be WAV/g)).toHaveLength(1);
		expect(markup).not.toContain("Choose file");
	});

	test("each row shows its own sound and its own file", () => {
		const sounds = { ...defaultStateSounds(), done: { kind: "custom" as const, path: "/home/me/sounds/bell.ogg" }, error: { kind: "bundled" as const, name: "knock" as const } };
		const markup = view({ ...saved, statusNotifications: false, sounds }, { customPaths: { done: "/home/me/sounds/bell.ogg", crashed: "/home/me/sounds/crash.wav" } });
		expect(markup).toContain('aria-label="Notify: Done" disabled="" checked=""');
		expect(markup).toContain('<option value="custom" selected="">Your own file: bell.ogg</option>');
		expect(markup).toContain('<option value="custom">Your own file: crash.wav</option>');
		expect(markup).toContain('<option value="bundled:knock" selected="">Knock</option>');
		expect(markup).toContain('aria-label="Choose file: Done"');
		expect(markup).not.toContain('aria-label="Choose file: Error"');
		expect(markup).toContain('aria-label="Play sound: Done">');
		expect(markup).toContain('aria-label="Play sound: Needs you" disabled=""');
	});

	test("a picker value sets the state's sound, or asks for a file when that state has none yet", () => {
		const bell = "/home/me/sounds/bell.ogg";
		expect(pickSound("none", undefined)).toEqual({ kind: "set", sound: null });
		expect(pickSound("bundled:ping", undefined)).toEqual({ kind: "set", sound: { kind: "bundled", name: "ping" } });
		expect(pickSound("system", bell)).toEqual({ kind: "set", sound: { kind: "system" } });
		expect(pickSound("custom", bell)).toEqual({ kind: "set", sound: { kind: "custom", path: bell } });
		expect(pickSound("custom", undefined)).toEqual({ kind: "choose-file" });
		expect(pickSound("bundled:gong", undefined)).toBeNull();
		for (const sound of [null, { kind: "bundled" as const, name: "knock" as const }, { kind: "system" as const }, { kind: "custom" as const, path: bell }]) {
			const picked = pickSound(soundOptionOf(sound), bell);
			expect(picked).toEqual({ kind: "set", sound });
		}
	});

	test("a preview that could not play says why", () => {
		expect(describeSoundOutcome({ outcome: "played" })).toBeNull();
		expect(describeSoundOutcome({ outcome: "missing" })).toContain("not there any more");
		expect(view(saved, { problem: "Nope." })).toContain('role="alert">Nope.</p>');
	});

	test("ticking keeps Settings order, and the draft compares as a set", () => {
		expect(toggleState(["crashed"], "needs-you", true)).toEqual(["needs-you", "crashed"]);
		expect(toggleState(["needs-you", "crashed"], "needs-you", false)).toEqual(["crashed"]);
		expect(sameNotificationsDraft(saved, { ...saved, notifyStates: [...saved.notifyStates].reverse() })).toBe(true);
		expect(sameNotificationsDraft(saved, { ...saved, sounds: withStateSound(saved.sounds, "done", { kind: "system" }) })).toBe(false);
		expect(withStateSound(saved.sounds, "done", { kind: "system" })).toEqual({ ...defaultStateSounds(), done: { kind: "system" } });
		expect(withStateSound({ ...defaultStateSounds(), done: { kind: "system" } }, "done", null)).toEqual(defaultStateSounds());
	});

	test("the person's own file is chosen through the engine and saved with the section", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		expect(await store.chooseSoundFile()).toEqual({ outcome: "chosen", path: "/home/me/sounds/bell.ogg" });
		engine.pickSoundFile("/home/me/notes.txt");
		expect((await store.chooseSoundFile()).outcome).toBe("refused");
		engine.pickSoundFile(null);
		expect(await store.chooseSoundFile()).toEqual({ outcome: "cancelled" });
		expect(await store.playSound({ kind: "system" })).toEqual({ outcome: "played" });
		expect(engine.previewSounds()).toEqual([{ kind: "system" }]);
		const sounds = { ...defaultStateSounds(), crashed: { kind: "custom" as const, path: "/home/me/sounds/bell.ogg" } };
		expect((await store.savePreferences({ sounds })).outcome).toBe("saved");
		expect((await engine.loadPreferences()).sounds).toEqual(sounds);
	});
});
