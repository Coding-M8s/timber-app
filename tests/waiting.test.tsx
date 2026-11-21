import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { handleWaitingKey } from "../src/mainview/components/WaitingShortcut";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { paletteEntries } from "../src/mainview/palette";
import { runPaletteEntry } from "../src/mainview/palette-run";
import { finishedSessions, initialState, sessionOnScreen, sessionsToVisit, waitingSessions } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { takeTerminalFocus } from "../src/mainview/terminal-focus";
import {
	NONE_WAITING, WAITING_LABEL, describeFinished, describeToVisit, describeWaiting, isWaitingShortcut, nextWaitingSession, waitingHint, waitingShortcut,
	withFinishedOrder, withWaitingOrder,
} from "../src/mainview/waiting";
import type { TerminalSession } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const API = "/work/api-server";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const primaryId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === TIMBER)!.id;
const apiId = sampleRepositories[1]!.worktrees.find(worktree => worktree.path === API)!.id;
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

const blocked = { state: "blocked", kind: "permission", progress: null, app: null, title: null, message: null } as const;
const working = { ...blocked, state: "working", kind: null } as const;
const done = { ...blocked, state: "done", kind: null } as const;
const session = (id: string, change: Partial<TerminalSession> = {}): TerminalSession => ({
	id, kind: "agent", name: "Codex", repository: TIMBER, worktree: featureId, path: FEATURE, shell: "/usr/local/bin/codex", command: "codex",
	state: { kind: "running" }, status: null, children: [], ...change,
});

describe("the waiting order", () => {
	test("keeps who waited first, drops who stopped waiting, and adds newcomers at the end", () => {
		const a = session("a", { status: blocked });
		const b = session("b", { status: blocked });
		const c = session("c", { status: working });
		expect(withWaitingOrder([], [a, b, c])).toEqual(["a", "b"]);
		// b waited first, so it stays first even though a started first.
		expect(withWaitingOrder(["b"], [a, b, c])).toEqual(["b", "a"]);
		// a stopped waiting, c started.
		expect(withWaitingOrder(["b", "a"], [{ ...a, status: working }, b, { ...c, status: blocked }])).toEqual(["b", "c"]);
		// An exited session is never waiting, whatever it last reported.
		expect(withWaitingOrder(["a", "b"], [{ ...a, state: { kind: "exited", exitCode: 0, signal: null } }, b])).toEqual(["b"]);
		// A session that is gone leaves.
		expect(withWaitingOrder(["a", "b"], [b])).toEqual(["b"]);
		// A plain shell that reports blocked counts too.
		expect(withWaitingOrder([], [session("t", { kind: "terminal", status: blocked })])).toEqual(["t"]);
	});

	test("answers the same order when nothing changed", () => {
		const order = ["a"];
		expect(withWaitingOrder(order, [session("a", { status: blocked }), session("b")])).toBe(order);
	});

	test("the next one cycles from the session on screen, else starts at the oldest", () => {
		expect(nextWaitingSession([], null)).toBeNull();
		expect(nextWaitingSession([], "a")).toBeNull();
		expect(nextWaitingSession(["a", "b", "c"], null)).toBe("a");
		expect(nextWaitingSession(["a", "b", "c"], "x")).toBe("a");
		expect(nextWaitingSession(["a", "b", "c"], "a")).toBe("b");
		expect(nextWaitingSession(["a", "b", "c"], "c")).toBe("a");
		expect(nextWaitingSession(["a"], "a")).toBe("a");
	});

	test("only sessions whose worktree the list has can be reached", () => {
		const state = {
			...initialState,
			repositories: sampleRepositories,
			terminals: [session("a", { status: blocked }), session("gone", { status: blocked, worktree: "not-listed" })],
			waitingOrder: ["gone", "a"],
		};
		expect(waitingSessions(state)).toEqual(["a"]);
	});

	test("a finished session joins when it finishes, and leaves once seen", () => {
		const a = session("a", { status: working });
		const b = session("b", { status: working });
		const order = (previous: readonly string[], before: TerminalSession[], now: TerminalSession[], shownBefore: string | null = null, shownNow: string | null = null) =>
			withFinishedOrder(previous, { before, now, shownBefore, shownNow });
		// b finished first, then a.
		expect(order([], [a, b], [a, { ...b, status: done }])).toEqual(["b"]);
		expect(order(["b"], [a, { ...b, status: done }], [{ ...a, status: done }, { ...b, status: done }])).toEqual(["b", "a"]);
		// The first list after a reload: every finished one joins, in start order.
		expect(order([], [], [{ ...a, status: done }, { ...b, status: done }])).toEqual(["a", "b"]);
		// One that finishes on screen is seen already.
		expect(order([], [a], [{ ...a, status: done }], "a", "a")).toEqual([]);
		// On screen it stays; once the person moves on it leaves, and stays out while still done.
		const both = [{ ...a, status: done }, { ...b, status: done }];
		expect(order(["a", "b"], both, both, null, "a")).toEqual(["a", "b"]);
		expect(order(["a", "b"], both, both, "a", "b")).toEqual(["b"]);
		expect(order(["b"], both, both, "b", "b")).toEqual(["b"]);
		expect(order(["b"], both, both, null, null)).toEqual(["b"]);
		// It joins again when it finishes again.
		expect(order(["b"], [a, both[1]!], both)).toEqual(["b", "a"]);
		// Working again, exited, or gone: it leaves.
		expect(order(["a", "b"], both, [a, both[1]!])).toEqual(["b"]);
		expect(order(["a", "b"], both, [{ ...both[0]!, state: { kind: "exited", exitCode: 0, signal: null } }, both[1]!])).toEqual(["b"]);
		expect(order(["a", "b"], both, [both[1]!])).toEqual(["b"]);
		// Nothing changed: the same array.
		const same = ["b"];
		expect(order(same, both, both)).toBe(same);
	});

	test("the sessions to visit: every Needs you one, then every finished one", () => {
		const state = {
			...initialState,
			repositories: sampleRepositories,
			terminals: [session("n", { status: blocked }), session("d", { status: done })],
			waitingOrder: ["n"],
			finishedOrder: ["d"],
		};
		expect(finishedSessions(state)).toEqual(["d"]);
		expect(sessionsToVisit(state)).toEqual(["n", "d"]);
	});

	test("words, shortcut, and keys", () => {
		expect(describeFinished(0)).toBe("");
		expect(describeFinished(3)).toBe("3 done");
		expect(describeToVisit(0, 0)).toBe("");
		expect(describeToVisit(2, 0)).toBe("2 need you");
		expect(describeToVisit(0, 1)).toBe("1 done");
		expect(describeToVisit(2, 1)).toBe("2 need you, 1 done");
		expect(describeWaiting(0)).toBe("");
		expect(describeWaiting(1)).toBe("1 needs you");
		expect(describeWaiting(2)).toBe("2 need you");
		expect(waitingShortcut(false)).toBe("Ctrl+Shift+J");
		expect(waitingShortcut(true)).toBe("Cmd+Shift+J");
		expect(waitingHint(false)).toBe(`${WAITING_LABEL} (Ctrl+Shift+J)`);
		const key = (change: Partial<KeyboardEvent>) => ({ type: "keydown", key: "J", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, ...change });
		expect(isWaitingShortcut(key({}))).toBe(true);
		expect(isWaitingShortcut(key({ ctrlKey: false, metaKey: true, key: "j" }))).toBe(true);
		expect(isWaitingShortcut(key({ shiftKey: false, key: "j" }))).toBe(false);
		expect(isWaitingShortcut(key({ altKey: true }))).toBe(false);
		expect(isWaitingShortcut(key({ type: "keyup" }))).toBe(false);
		expect(isWaitingShortcut(key({ key: "K" }))).toBe(false);
		expect(isWaitingShortcut(key({ ctrlKey: false }))).toBe(false);
	});
});

/** A started store on the mock engine with Codex in the timber feature worktree and Claude Code in api-server, and the timber primary checkout selected. */
async function inTwoRepositories() {
	const engine = createMockEngine();
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, agent: "Codex" });
	await store.openTerminal({ repository: API, worktree: API, cols: 80, rows: 24, agent: "Claude Code" });
	await settle();
	store.select(primaryId);
	await settle();
	const [codex, claude] = store.getState().terminals;
	const report = async (id: string, pairs: string) => {
		engine.agentStatus(id, pairs);
		await settle();
	};
	return { engine, store, codex: codex!, claude: claude!, report };
}

describe("the next session that needs you, across repositories", () => {
	test("none waiting: the shortcut does nothing, the title bar shows nothing, the palette says why", async () => {
		const { store } = await inTwoRepositories();
		const before = store.getState();
		expect(store.jumpToWaiting()).toBe(false);
		expect(store.getState().selection).toEqual(before.selection);
		expect(render(store)).not.toContain("titlebar-waiting");
		const entry = paletteEntries(store.getState()).find(candidate => candidate.label === WAITING_LABEL)!;
		expect(entry.disabledReason).toBe(NONE_WAITING);
	});

	test("cycles oldest first, and each one leaves once answered", async () => {
		const { store, codex, claude, report } = await inTwoRepositories();
		// Claude Code in api-server waits first, then Codex in timber.
		await report(claude.id, "state=blocked:kind=permission");
		await report(codex.id, "state=blocked:kind=question");
		expect(store.getState().waitingOrder).toEqual([claude.id, codex.id]);
		const html = render(store);
		expect(html).toContain("2 need you");
		expect(html).toContain(`title="${waitingHint(false)}"`);

		expect(store.jumpToWaiting()).toBe(true);
		let state = store.getState();
		expect(state.selection).toEqual({ repository: API, worktree: apiId });
		expect(state.tab).toBe("workspace");
		expect(sessionOnScreen(state)?.id).toBe(claude.id);
		expect(takeTerminalFocus(apiId)).toBe(true);

		expect(store.jumpToWaiting()).toBe(true);
		state = store.getState();
		expect(state.selection).toEqual({ repository: TIMBER, worktree: featureId });
		expect(sessionOnScreen(state)?.id).toBe(codex.id);
		expect(takeTerminalFocus(featureId)).toBe(true);

		// Around again to the oldest.
		expect(store.jumpToWaiting()).toBe(true);
		expect(sessionOnScreen(store.getState())?.id).toBe(claude.id);

		// Claude Code got its answer: only Codex is left, and it comes next.
		await report(claude.id, "state=working");
		expect(waitingSessions(store.getState())).toEqual([codex.id]);
		expect(render(store)).toContain("1 needs you");
		expect(store.jumpToWaiting()).toBe(true);
		expect(sessionOnScreen(store.getState())?.id).toBe(codex.id);

		// Codex got its answer too: none waits.
		await report(codex.id, "state=working");
		expect(store.getState().waitingOrder).toEqual([]);
		expect(render(store)).not.toContain("titlebar-waiting");
		expect(store.jumpToWaiting()).toBe(false);
	});

	test("a session that waits again joins at the end", async () => {
		const { store, codex, claude, report } = await inTwoRepositories();
		await report(codex.id, "state=blocked");
		await report(claude.id, "state=blocked");
		await report(codex.id, "state=working");
		await report(codex.id, "state=blocked");
		expect(store.getState().waitingOrder).toEqual([claude.id, codex.id]);
	});

	test("a jump from the Changes tab shows the Workspace tab", async () => {
		const { store, claude, report } = await inTwoRepositories();
		await report(claude.id, "state=blocked");
		store.showTab("changes");
		expect(store.jumpToWaiting()).toBe(true);
		expect(store.getState().tab).toBe("workspace");
		expect(sessionOnScreen(store.getState())?.id).toBe(claude.id);
	});

	test("the key is always taken from the page, and jumps once per press", async () => {
		const { store, claude, report } = await inTwoRepositories();
		const press = (change: Partial<KeyboardEvent> = {}) => {
			let prevented = false;
			const event = {
				type: "keydown", key: "J", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, repeat: false,
				preventDefault: () => void (prevented = true), ...change,
			};
			const taken = handleWaitingKey(event, () => store.jumpToWaiting());
			return { taken, prevented };
		};
		// None waiting: nothing happens, but the chord still never reaches the host.
		expect(press()).toEqual({ taken: true, prevented: true });
		expect(store.getState().selection?.worktree).toBe(primaryId);
		expect(press({ key: "K" })).toEqual({ taken: false, prevented: false });
		await report(claude.id, "state=blocked");
		// A held chord does not move.
		press({ repeat: true });
		expect(store.getState().selection?.worktree).toBe(primaryId);
		press();
		expect(sessionOnScreen(store.getState())?.id).toBe(claude.id);
	});

	test("finished agents come after those that need you, in the order they finished, each once", async () => {
		const { engine, store, codex, claude, report } = await inTwoRepositories();
		await store.openTerminal({ repository: TIMBER, worktree: TIMBER, cols: 80, rows: 24, agent: "Codex" });
		await settle();
		store.select(apiId);
		store.showTab("changes");
		await settle();
		const third = store.getState().terminals[2]!;
		// Claude Code in api-server finishes first, then Codex in timber; the third agent needs you.
		await report(claude.id, "state=done");
		await report(codex.id, "state=done");
		await report(third.id, "state=blocked");
		expect(store.getState().finishedOrder).toEqual([claude.id, codex.id]);
		expect(sessionsToVisit(store.getState())).toEqual([third.id, claude.id, codex.id]);
		const html = render(store);
		expect(html).toContain("1 needs you");
		expect(html).toContain("2 done");

		expect(store.jumpToWaiting()).toBe(true);
		expect(sessionOnScreen(store.getState())?.id).toBe(third.id);
		expect(store.jumpToWaiting()).toBe(true);
		expect(sessionOnScreen(store.getState())?.id).toBe(claude.id);
		// On screen it stays in the list, so the next press goes on from it.
		expect(finishedSessions(store.getState())).toEqual([claude.id, codex.id]);
		expect(store.jumpToWaiting()).toBe(true);
		expect(sessionOnScreen(store.getState())?.id).toBe(codex.id);
		// Claude Code was seen, so it is gone; around again to the one that needs you.
		expect(finishedSessions(store.getState())).toEqual([codex.id]);
		expect(store.jumpToWaiting()).toBe(true);
		expect(sessionOnScreen(store.getState())?.id).toBe(third.id);
		expect(store.getState().finishedOrder).toEqual([]);
		expect(render(store)).toContain(`class="titlebar-waiting" aria-label="1 needs you"`);

		// Answered, nothing is left.
		await report(third.id, "state=working");
		expect(store.jumpToWaiting()).toBe(false);
		// Claude Code finishing again joins again.
		engine.agentStatus(claude.id, "state=working");
		await settle();
		await report(claude.id, "state=done");
		expect(store.getState().finishedOrder).toEqual([claude.id]);
	});

	test("a finished session seen by selecting its worktree leaves", async () => {
		const { store, claude, report } = await inTwoRepositories();
		await report(claude.id, "state=done");
		expect(store.getState().finishedOrder).toEqual([claude.id]);
		store.select(apiId);
		store.showTab("workspace");
		await settle();
		expect(store.getState().finishedOrder).toEqual([claude.id]);
		store.select(primaryId);
		await settle();
		expect(store.getState().finishedOrder).toEqual([]);
	});

	test("a finished session that closes, exits, or needs you again leaves the finished order", async () => {
		const { engine, store, codex, claude, report } = await inTwoRepositories();
		await store.openTerminal({ repository: TIMBER, worktree: TIMBER, cols: 80, rows: 24, agent: "Codex" });
		await settle();
		store.select(featureId);
		store.showTab("changes");
		await settle();
		const third = store.getState().terminals[2]!;
		await report(codex.id, "state=done");
		await report(claude.id, "state=done");
		await report(third.id, "state=done");
		expect(store.getState().finishedOrder).toEqual([codex.id, claude.id, third.id]);
		await store.closeTerminal(codex.id);
		await settle();
		engine.endTerminal(claude.id, 0);
		await settle();
		await report(third.id, "state=blocked");
		const state = store.getState();
		expect(state.finishedOrder).toEqual([]);
		expect(state.waitingOrder).toEqual([third.id]);
	});

	test("the palette and the title bar name both kinds", async () => {
		const { store, codex, claude, report } = await inTwoRepositories();
		await report(codex.id, "state=blocked");
		await report(claude.id, "state=done");
		const entry = paletteEntries(store.getState()).find(candidate => candidate.label === WAITING_LABEL)!;
		expect(entry.detail).toBe("1 needs you, 1 done");
		expect(render(store)).toContain(`aria-label="1 needs you, 1 done"`);
	});

	test("a session that finishes on screen does not join", async () => {
		const { store, claude, report } = await inTwoRepositories();
		store.revealSession(claude.id);
		await report(claude.id, "state=done");
		expect(store.getState().finishedOrder).toEqual([]);
		expect(store.jumpToWaiting()).toBe(false);
	});

	test("a closed session leaves the order", async () => {
		const { store, codex, claude, report } = await inTwoRepositories();
		await report(codex.id, "state=blocked");
		await report(claude.id, "state=blocked");
		await store.closeTerminal(codex.id);
		await settle();
		expect(store.getState().waitingOrder).toEqual([claude.id]);
	});

	test("the palette entry does what the shortcut does, and closes the palette", async () => {
		const { store, claude, report } = await inTwoRepositories();
		await report(claude.id, "state=blocked");
		store.openPalette();
		const entry = paletteEntries(store.getState()).find(candidate => candidate.label === WAITING_LABEL)!;
		expect(entry.disabledReason).toBeNull();
		expect(entry.detail).toBe("1 needs you");
		runPaletteEntry(store, entry, () => ({ cols: 80, rows: 24 }));
		expect(store.getState().dialog).toBeNull();
		expect(sessionOnScreen(store.getState())?.id).toBe(claude.id);
	});

	test("nothing happens while a dialog or the quit question is open", async () => {
		const { engine, store, claude, report } = await inTwoRepositories();
		await report(claude.id, "state=blocked");
		store.openDialog({ kind: "settings" });
		expect(store.jumpToWaiting()).toBe(false);
		expect(store.getState().selection?.worktree).toBe(primaryId);
		store.closeDialog();
		engine.requestQuit();
		await settle();
		expect(store.getState().quitRequest).not.toBeNull();
		expect(store.jumpToWaiting()).toBe(false);
		expect(store.getState().selection?.worktree).toBe(primaryId);
	});

	test("nothing shows or happens while Timber is not ready", async () => {
		const engine = createMockEngine(undefined, sampleTimberStatuses["not-found"]);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		await store.openTerminal({ repository: API, worktree: API, cols: 80, rows: 24, agent: "Claude Code" });
		await settle();
		await store.openTerminal({ repository: TIMBER, worktree: TIMBER, cols: 80, rows: 24, agent: "Codex" });
		await settle();
		const [first, second] = store.getState().terminals;
		engine.agentStatus(first!.id, "state=blocked");
		engine.agentStatus(second!.id, "state=done");
		await settle();
		expect(store.getState().waitingOrder).toHaveLength(1);
		expect(store.getState().finishedOrder).toHaveLength(1);
		expect(store.jumpToWaiting()).toBe(false);
		expect(render(store)).not.toContain("titlebar-waiting");
	});
});
