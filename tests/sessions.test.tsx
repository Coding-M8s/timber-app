import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { runningSessionCount, sessionsOf, shownSession, withTerminal } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import {
	chipAfterKey, chipCommand, describeDoneSessionsWarning, describeOrphanTerminal, describeRunningSessions, describeSessionChip, sessionKey, shortExit,
} from "../src/mainview/terminal-format";
import { type TerminalSession, cleanSessionName, defaultSessionName } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const primaryId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === TIMBER)!.id;

/** A started store with the feature worktree selected and three sessions in it. */
async function withThreeSessions() {
	const engine = createMockEngine();
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(featureId);
	for (let count = 0; count < 3; count += 1) await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
	await settle();
	const [one, two, three] = sessionsOf(store.getState(), featureId);
	return { engine, store, one: one!, two: two!, three: three! };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

describe("naming sessions", () => {
	test("a new session takes the kind's name, then the first free number", () => {
		expect(defaultSessionName("Terminal", [])).toBe("Terminal");
		expect(defaultSessionName("Terminal", ["Terminal"])).toBe("Terminal 2");
		expect(defaultSessionName("Terminal", ["Terminal", "Terminal 3"])).toBe("Terminal 2");
		expect(defaultSessionName("Terminal", ["Terminal 2"])).toBe("Terminal");
		expect(defaultSessionName("Terminal", ["build", "Terminal", "Terminal 2"])).toBe("Terminal 3");
	});

	test("a typed name is cleaned up, cut to 40 characters, and refused when nothing is left", () => {
		expect(cleanSessionName("  dev   server ")).toBe("dev server");
		expect(cleanSessionName("a\tb\nc\u0000d\u001b[31m")).toBe("a b c d [31m");
		expect(cleanSessionName("y".repeat(50))).toBe("y".repeat(40));
		expect(cleanSessionName("😀".repeat(41))).toBe("😀".repeat(40));
		expect(cleanSessionName(" \n\t ")).toBeNull();
		expect(cleanSessionName(7)).toBeNull();
	});
});

describe("keys for chips and sessions", () => {
	const ids = ["a", "b", "c"];
	test("the arrows step and wrap, Home and End jump, anything else is not a move", () => {
		expect(chipAfterKey(ids, "a", "ArrowRight")).toBe("b");
		expect(chipAfterKey(ids, "c", "ArrowRight")).toBe("a");
		expect(chipAfterKey(ids, "a", "ArrowLeft")).toBe("c");
		expect(chipAfterKey(ids, "b", "Home")).toBe("a");
		expect(chipAfterKey(ids, "b", "End")).toBe("c");
		expect(chipAfterKey(ids, "b", "Enter")).toBeNull();
		expect(chipAfterKey(ids, "x", "ArrowRight")).toBeNull();
	});

	test("Delete closes and F2 renames, as for closable tabs", () => {
		expect(chipCommand("Delete")).toBe("close");
		expect(chipCommand("F2")).toBe("rename");
		expect(chipCommand("Backspace")).toBeNull();
	});

	test("a terminal leaves the keys that switch sessions and reach the chips to the app", () => {
		const key = (key: string, modifiers: Partial<Record<"ctrlKey" | "shiftKey" | "metaKey" | "altKey", boolean>> = {}, type = "keydown") =>
			({ type, key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...modifiers });
		expect(sessionKey(key("PageUp", { ctrlKey: true }), false)).toBe("previous");
		expect(sessionKey(key("PageDown", { ctrlKey: true }), false)).toBe("next");
		expect(sessionKey(key("S", { ctrlKey: true, shiftKey: true }), false)).toBe("chips");
		expect(sessionKey(key("PageDown", { ctrlKey: true }, "keyup"), false)).toBeNull();
		// Plain PageDown, Ctrl+S, and Alt combinations stay the program's.
		expect(sessionKey(key("PageDown"), false)).toBeNull();
		expect(sessionKey(key("s", { ctrlKey: true }), false)).toBeNull();
		expect(sessionKey(key("PageDown", { ctrlKey: true, altKey: true }), false)).toBeNull();
		expect(sessionKey(key("{", { metaKey: true, shiftKey: true }), true)).toBe("previous");
		expect(sessionKey(key("}", { metaKey: true, shiftKey: true }), true)).toBe("next");
		expect(sessionKey(key("s", { metaKey: true, shiftKey: true }), true)).toBe("chips");
		expect(sessionKey(key("PageDown", { ctrlKey: true }), true)).toBeNull();
	});
});

describe("words for sessions", () => {
	const session = (state: TerminalSession["state"]) => ({ kind: "terminal" as const, name: "Terminal 2", shell: "/bin/zsh", state });
	test("a chip describes its kind, how it ended, and new output", () => {
		expect(describeSessionChip(session({ kind: "running" }), false)).toBe("Terminal, zsh");
		expect(describeSessionChip(session({ kind: "exited", exitCode: 1, signal: null }), true)).toBe("Terminal, zsh. Exited with code 1. New output since you last looked");
		expect(shortExit({ kind: "running" })).toBeNull();
		expect(shortExit({ kind: "exited", exitCode: 0, signal: null })).toBe("exit 0");
		expect(shortExit({ kind: "exited", exitCode: null, signal: "SIGKILL" })).toBe("SIGKILL");
	});

	test("counts are worded for one and for several", () => {
		expect(describeRunningSessions(1)).toBe("1 session running");
		expect(describeRunningSessions(3)).toBe("3 sessions running");
		expect(describeDoneSessionsWarning(1)).toContain("A session is running");
		expect(describeDoneSessionsWarning(2)).toContain("2 sessions are running in this worktree. Removing the worktree ends them");
		expect(describeOrphanTerminal("/w", 2)).toBe("Ended 2 sessions in /w, because Timber no longer lists that worktree");
	});
});

describe("several sessions in one worktree", () => {
	test("a session that changes keeps its place among the others", () => {
		const make = (id: string, name: string): TerminalSession =>
			({ id, kind: "terminal", name, repository: TIMBER, worktree: featureId, path: FEATURE, shell: "/bin/sh", command: "/bin/sh", state: { kind: "running" }, status: null });
		const list = [make("a", "A"), make("b", "B"), make("c", "C")];
		expect(withTerminal(list, "a", make("a", "A2")).map(session => session.name)).toEqual(["A2", "B", "C"]);
		expect(withTerminal(list, "d", make("d", "D")).map(session => session.id)).toEqual(["a", "b", "c", "d"]);
		expect(withTerminal(list, "b", null).map(session => session.id)).toEqual(["a", "c"]);
	});

	test("three sessions run at once, each with its own output, and the newest shows", async () => {
		const { engine, store, one, two, three } = await withThreeSessions();
		expect([one.name, two.name, three.name]).toEqual(["Terminal", "Terminal 2", "Terminal 3"]);
		expect(shownSession(store.getState(), featureId)!.id).toBe(three.id);
		store.writeTerminal(one.id, "echo one\r");
		store.writeTerminal(two.id, "echo two\r");
		await settle();
		expect(engine.typedInto(one.id)).toBe("echo one\r");
		expect(engine.typedInto(two.id)).toBe("echo two\r");
		expect(engine.typedInto(three.id)).toBe("");
		expect((await engine.readTerminal(one.id))!.data).not.toContain("echo two");
		expect(runningSessionCount(store.getState(), featureId)).toBe(3);
	});

	test("switching chips shows another session and leaves every session running", async () => {
		const { engine, store, one, two, three } = await withThreeSessions();
		const before = (await engine.readTerminal(one.id))!;
		store.showSession(one.id);
		expect(shownSession(store.getState(), featureId)!.id).toBe(one.id);
		store.stepSession(one.id, -1);
		expect(shownSession(store.getState(), featureId)!.id).toBe(three.id);
		store.stepSession(three.id, 1);
		store.showSession(two.id);
		await settle();
		expect(store.getState().terminals.map(session => session.state.kind)).toEqual(["running", "running", "running"]);
		// Nothing was started again or typed: the first session still holds what it printed, and nothing more.
		expect(await engine.readTerminal(one.id)).toEqual(before);
		expect((await engine.listTerminals()).map(session => session.id)).toEqual([one.id, two.id, three.id]);
	});

	test("closing one session leaves the others, and the chip beside a closed shown one shows", async () => {
		const { engine, store, one, two, three } = await withThreeSessions();
		store.showSession(two.id);
		await store.closeTerminal(two.id);
		await settle();
		expect(sessionsOf(store.getState(), featureId).map(session => session.id)).toEqual([one.id, three.id]);
		expect(shownSession(store.getState(), featureId)!.id).toBe(three.id);
		expect(await engine.readTerminal(two.id)).toBeNull();
		expect(await engine.readTerminal(one.id)).not.toBeNull();
		await store.closeTerminal(three.id);
		await settle();
		// The last one closed: the one before it shows.
		expect(shownSession(store.getState(), featureId)!.id).toBe(one.id);
		// Closing one that does not show leaves the choice alone.
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		const newest = shownSession(store.getState(), featureId)!;
		await store.closeTerminal(one.id);
		await settle();
		expect(shownSession(store.getState(), featureId)!.id).toBe(newest.id);
	});

	test("a session that prints while it is not on screen is marked until it shows", async () => {
		const { store, one, two, three } = await withThreeSessions();
		// What a new session printed before its chip showed counts as seen.
		expect(store.getState().unseenSessions).toEqual([]);
		store.writeTerminal(three.id, "pwd\r");
		await settle();
		expect(store.getState().unseenSessions).toEqual([]);
		store.writeTerminal(one.id, "pwd\r");
		await settle();
		expect(store.getState().unseenSessions).toEqual([one.id]);
		expect(render(store)).toContain('class="session-chip running unseen"');
		store.showSession(one.id);
		expect(store.getState().unseenSessions).toEqual([]);
		// Another worktree on screen: every session here can be marked, and coming back clears the one that shows.
		store.select(primaryId);
		store.writeTerminal(one.id, "x");
		store.writeTerminal(two.id, "x");
		await settle();
		expect([...store.getState().unseenSessions].sort()).toEqual([one.id, two.id].sort());
		store.select(featureId);
		expect(store.getState().unseenSessions).toEqual([two.id]);
		// The Changes tab hides the sessions too.
		store.showTab("changes");
		store.writeTerminal(one.id, "y");
		await settle();
		expect(store.getState().unseenSessions).toContain(one.id);
		store.showTab("workspace");
		expect(store.getState().unseenSessions).toEqual([two.id]);
		await store.closeTerminal(two.id);
		expect(store.getState().unseenSessions).toEqual([]);
	});

	test("a session can be renamed, and an empty name keeps the old one", async () => {
		const { store, two } = await withThreeSessions();
		expect(await store.renameTerminal(two.id, "  dev server ")).toBe(true);
		await settle();
		expect(sessionsOf(store.getState(), featureId).map(session => session.name)).toEqual(["Terminal", "dev server", "Terminal 3"]);
		expect(await store.renameTerminal(two.id, "   ")).toBe(false);
		expect(await store.renameTerminal("gone", "x")).toBe(false);
		expect(sessionsOf(store.getState(), featureId)[1]!.name).toBe("dev server");
		expect(render(store)).toContain('<span class="session-name">dev server</span>');
	});

	test("the chips are a tablist with one tab stop, and only the shown session's panel is drawn", async () => {
		const { store, one, three } = await withThreeSessions();
		const markup = render(store);
		expect(markup).toContain('role="tablist" aria-label="Sessions in this worktree"');
		const tabs = [...markup.matchAll(/<button type="button" role="tab" id="session-chip-([^"]+)"[^>]*>/g)];
		expect(tabs.map(match => match[1])).toEqual(sessionsOf(store.getState(), featureId).map(session => session.id));
		const selected = tabs.filter(match => match[0].includes('aria-selected="true"'));
		expect(selected).toHaveLength(1);
		expect(selected[0]![1]).toBe(three.id);
		expect(selected[0]![0]).toContain('tabindex="0"');
		expect(tabs.filter(match => match[0].includes('tabindex="-1"'))).toHaveLength(2);
		expect(markup).toContain('aria-keyshortcuts="Delete F2"');
		expect(markup).toContain(`role="tabpanel" id="session-panel" aria-labelledby="session-chip-${three.id}"`);
		expect(markup.match(/class="terminal-screen"/g)).toHaveLength(1);
		expect(markup).toContain('aria-label="New session" aria-haspopup="menu" aria-expanded="false"');
		// The chip's close control is for the pointer, out of the tab order; the keyboard has Delete and the Close beside the chips.
		expect(markup).toMatch(/<button type="button" class="session-chip-close" tabindex="-1" aria-label="Close Terminal 3 and end its processes"/);
		expect(markup).toContain(">Rename</button>");
		store.showSession(one.id);
		expect(render(store)).toContain(`aria-labelledby="session-chip-${one.id}"`);
	});

	test("an exited session is marked on its chip and leaves the running count", async () => {
		const { engine, store, two } = await withThreeSessions();
		engine.endTerminal(two.id, 4);
		await settle();
		const markup = render(store);
		expect(markup).toContain('class="session-chip exited"');
		expect(markup).toContain('<span class="session-exit" aria-hidden="true">exit 4</span>');
		expect(runningSessionCount(store.getState(), featureId)).toBe(2);
		expect(markup).toContain("2 sessions running.");
	});

	test("the sidebar row says how many sessions run, and nothing when none do", async () => {
		const { store, one, two, three } = await withThreeSessions();
		const row = (markup: string) => markup.slice(markup.indexOf(`title="${FEATURE} (`), markup.indexOf("</li>", markup.indexOf(`title="${FEATURE} (`)));
		expect(row(render(store))).toContain('<span class="row-sessions" aria-hidden="true"><span class="row-shells" title="3 sessions running"><span class="row-sessions-dot"></span>3</span></span>');
		expect(row(render(store))).toContain("3 sessions running.</span>");
		await store.closeTerminal(one.id);
		await store.closeTerminal(two.id);
		expect(row(render(store))).toContain('title="1 session running"');
		await store.closeTerminal(three.id);
		expect(row(render(store))).not.toContain("row-sessions");
	});

	test("a worktree that is no longer listed ends all its sessions with one toast", async () => {
		const { engine, store } = await withThreeSessions();
		engine.setRepositories(sampleRepositories.map(repository => repository.path === TIMBER
			? { ...repository, worktrees: repository.worktrees.filter(worktree => worktree.path !== FEATURE) }
			: repository));
		await store.reloadRepository(TIMBER);
		await settle();
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([describeOrphanTerminal(FEATURE, 3)]);
	});

	test("Done ends every session of the removed worktree", async () => {
		const { engine, store, one, two, three } = await withThreeSessions();
		const preview = await store.previewDone({ repository: TIMBER, path: FEATURE, options: { keepBranch: false, keepIgnored: false, base: null } });
		if (preview.outcome !== "previewed") throw new Error("No preview");
		await store.applyDone({ repository: TIMBER, path: FEATURE, preview: preview.id });
		await settle();
		expect(store.getState().terminals).toEqual([]);
		for (const session of [one, two, three]) expect(await engine.readTerminal(session.id)).toBeNull();
	});

	test("a session that fails to start beside others says why next to the chips", async () => {
		const { engine, store } = await withThreeSessions();
		engine.failTerminals({ outcome: "failed", message: "No pseudo terminal left." });
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		const markup = render(store);
		expect(markup).toContain("No pseudo terminal left.");
		expect(markup).toContain('role="tablist"');
		expect(sessionsOf(store.getState(), featureId)).toHaveLength(3);
	});
});

describe("review fixes", () => {
	test("invisible characters are dropped from a name, so a chip is never blank", () => {
		expect(cleanSessionName("​​")).toBeNull();
		expect(cleanSessionName("dev​server⁠")).toBe("devserver");
	});

	test("a chip being closed is dimmed, says so, and its close control is disabled", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.select(featureId);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		const [one] = sessionsOf(store.getState(), featureId);
		// Hold the close open, as the main process does while processes end.
		let finish = () => {};
		engine.closeTerminal = () => new Promise<void>(resolve => {
			finish = resolve;
		});
		const closing = store.closeTerminal(one!.id);
		const markup = render(store);
		expect(markup).toContain('class="session-chip running closing"');
		expect(markup).toContain(`aria-busy="true"`);
		expect(markup).toMatch(/<button type="button" class="session-chip-close" tabindex="-1" aria-label="Close Terminal and end its processes" title="[^"]+" disabled=""/);
		expect(markup).toContain("Terminal, mock-shell. Closing");
		finish();
		await closing;
	});
});
