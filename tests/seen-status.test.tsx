import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { paletteEntries } from "../src/mainview/palette";
import { SEEABLE_KINDS, canBeSeen, isSeen, unseenStatuses, withSeenStatuses } from "../src/mainview/seen-status";
import { sessionOnScreen } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { describeRowSessions, describeSessionChip } from "../src/mainview/terminal-format";
import { BUILT_IN_THEMES } from "../src/shared/builtin-themes";
import { contrastRatio, formatColor, over, parseColor } from "../src/shared/color";
import { mostUrgent, summarizeStatuses } from "../src/shared/session-status";
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

const blocked = { state: "blocked", kind: "permission", progress: null, app: null, title: null, message: null } as const;
const working = { ...blocked, state: "working", kind: null } as const;
const done = { ...blocked, state: "done", kind: null } as const;
const failed = { ...blocked, state: "error", kind: null } as const;
const session = (id: string, change: Partial<TerminalSession> = {}): TerminalSession => ({
	id, kind: "agent", name: "Codex", repository: TIMBER, worktree: featureId, path: FEATURE, shell: "/usr/local/bin/codex", command: "codex",
	state: { kind: "running" }, status: null, children: [], ...change,
});
const crashed = (id: string) => session(id, { state: { kind: "exited", exitCode: 2, signal: null } });

describe("seen statuses", () => {
	test("only Done, Error, and crashed can be seen", () => {
		expect(SEEABLE_KINDS).toEqual(["done", "error", "crashed"]);
		for (const kind of ["working", "needs-you", "idle", "stopped", "unknown"] as const) expect(canBeSeen(kind)).toBe(false);
	});

	test("the session on screen is seen in the state it shows", () => {
		expect(withSeenStatuses({}, [session("a", { status: done })], "a")).toEqual({ a: "done" });
		expect(withSeenStatuses({}, [session("a", { status: failed })], "a")).toEqual({ a: "error" });
		expect(withSeenStatuses({}, [crashed("a")], "a")).toEqual({ a: "crashed" });
	});

	test("Needs you, Working, and nothing on screen mark nothing", () => {
		const seen = {};
		expect(withSeenStatuses(seen, [session("a", { status: blocked })], "a")).toBe(seen);
		expect(withSeenStatuses(seen, [session("a", { status: working })], "a")).toBe(seen);
		expect(withSeenStatuses(seen, [session("a", { status: done })], null)).toBe(seen);
		expect(withSeenStatuses(seen, [session("a", { status: done })], "gone")).toBe(seen);
	});

	test("a new state forgets it, so the next Done is unseen again", () => {
		const seen = withSeenStatuses({}, [session("a", { status: done })], "a");
		const workingAgain = withSeenStatuses(seen, [session("a", { status: working })], null);
		expect(workingAgain).toEqual({});
		const doneAgain = session("a", { status: done });
		expect(isSeen(withSeenStatuses(workingAgain, [doneAgain], null), doneAgain)).toBe(false);
	});

	test("a new report in the same state stays seen, and a session that is gone is forgotten", () => {
		const seen = withSeenStatuses({}, [session("a", { status: done })], "a");
		expect(withSeenStatuses(seen, [session("a", { status: { ...done, message: "all set" } })], null)).toBe(seen);
		expect(withSeenStatuses(seen, [], null)).toEqual({});
	});

	test("answers the same object when nothing changed", () => {
		const seen = withSeenStatuses({}, [session("a", { status: done })], "a");
		expect(withSeenStatuses(seen, [session("a", { status: done })], "a")).toBe(seen);
	});

	test("isSeen holds only while the state is the one seen", () => {
		const seen = { a: "done" } as const;
		expect(isSeen(seen, session("a", { status: done }))).toBe(true);
		expect(isSeen(seen, session("a", { status: failed }))).toBe(false);
		expect(isSeen(seen, session("b", { status: done }))).toBe(false);
		// Needs you never shows as seen, even with a stale mark.
		expect(isSeen({ a: "needs-you" }, session("a", { status: blocked }))).toBe(false);
	});

	test("a summary leaves out seen states, and its color follows what is left", () => {
		const sessions = [session("a", { status: done }), session("b", { status: failed }), session("c", { status: working }), session("t", { kind: "terminal" })];
		const statuses = unseenStatuses(sessions, { b: "error" });
		expect(summarizeStatuses(statuses)).toBe("1 working, 1 done");
		expect(mostUrgent(statuses)).toBe("working");
		expect(summarizeStatuses(unseenStatuses(sessions, { a: "done", b: "error" }))).toBe("1 working");
	});

	test("a seen Done whose task needs you still counts as needing you", () => {
		const child = { id: "review", ...blocked };
		const agent = session("a", { status: done, children: [child] });
		expect(summarizeStatuses(unseenStatuses([agent], { a: "done" }))).toBe("1 needs you");
	});

	test("words: the row's mark and the chip say seen", () => {
		const row = describeRowSessions([session("a", { status: done }), session("b", { name: "Claude", status: done })], { a: "done" });
		expect(row.marks.map(mark => mark.seen)).toEqual([true, false]);
		expect(row.marks[0]!.words).toBe("Codex: Done, seen");
		expect(row.sentence).toBe("Codex: Done, seen. Claude: Done.");
		expect(describeSessionChip(session("a", { status: done }), false, true)).toBe("Agent, codex. Done, seen");
		expect(describeSessionChip(crashed("a"), false, true)).toBe("Agent, codex. Crashed, seen. Exited with code 2");
	});

	test("the quiet color keeps at least 3:1 on every surface of every built-in theme, light and dark", () => {
		const appearances = new Set(BUILT_IN_THEMES.map(theme => theme.appearance));
		expect(appearances).toEqual(new Set(["light", "dark"]));
		for (const theme of BUILT_IN_THEMES) {
			const ui = theme.ui as unknown as Record<string, string>;
			const surfaces = ["bgApp", "bgMain", "bgPane", "bgRaised"].map(key => ui[key]!);
			// Hover and selection fills are translucent: lay them over each surface.
			const fills = ["fillHover", "fillSelected"].flatMap(key => surfaces.map(surface => formatColor(over(parseColor(ui[key]!)!, parseColor(surface)!))));
			for (const background of [...surfaces, ...fills]) {
				expect(contrastRatio(ui.text3!, background, ui.bgApp)).toBeGreaterThanOrEqual(3);
			}
		}
	});
});

/** A started store on the mock engine with Codex in the timber feature worktree and Claude Code in api-server, and the timber primary checkout selected. */
async function started() {
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
	const render = () => renderToStaticMarkup(<App store={store} />);
	return { engine, store, codex: codex!, claude: claude!, report, render };
}

const seen = (store: ReturnType<typeof createAppStore>, id: string) => isSeen(store.getState().seenStatuses, store.getState().terminals.find(candidate => candidate.id === id)!);

describe("seen statuses in the app, on the mock engine", () => {
	test("visiting a finished session in a focused window marks it seen, and its row and chip change", async () => {
		const { store, codex, report, render } = await started();
		await report(codex.id, "state=done");
		expect(seen(store, codex.id)).toBe(false);
		expect(render()).not.toMatch(/row-agent status-done[^"]* seen/);
		store.select(featureId);
		await settle();
		expect(seen(store, codex.id)).toBe(true);
		const html = render();
		expect(html).toMatch(/row-agent status-done[^"]* seen/);
		expect(html).toContain("status-glyph status-done seen");
		expect(html).toContain("Codex: Done, seen");
		// It stays seen after the person moves on.
		store.select(primaryId);
		await settle();
		expect(seen(store, codex.id)).toBe(true);
	});

	test("a Done that arrives on screen in a focused window is seen at once", async () => {
		const { store, codex, report } = await started();
		store.select(featureId);
		await settle();
		await report(codex.id, "state=done");
		expect(seen(store, codex.id)).toBe(true);
	});

	test("a selected worktree in an unfocused window marks nothing, until the focus comes back", async () => {
		const { store, codex, report } = await started();
		store.windowChanged({ visible: true, focused: false });
		await report(codex.id, "state=error");
		store.select(featureId);
		await settle();
		expect(seen(store, codex.id)).toBe(false);
		store.windowChanged({ visible: false, focused: true });
		expect(seen(store, codex.id)).toBe(false);
		let heard = 0;
		const stop = store.subscribe(() => heard += 1);
		store.windowChanged({ visible: true, focused: true });
		stop();
		expect(seen(store, codex.id)).toBe(true);
		// Listeners hear it, so the icon repaints.
		expect(heard).toBeGreaterThan(0);
	});

	test("closing a seen session forgets it", async () => {
		const { store, codex, report } = await started();
		store.select(featureId);
		await settle();
		await report(codex.id, "state=done");
		expect(store.getState().seenStatuses).toEqual({ [codex.id]: "done" });
		await store.closeTerminal(codex.id);
		await settle();
		expect(store.getState().seenStatuses).toEqual({});
	});

	test("another tab on screen marks nothing", async () => {
		const { store, codex, report } = await started();
		store.select(featureId);
		store.showTab("pull-request");
		await settle();
		await report(codex.id, "state=done");
		expect(sessionOnScreen(store.getState())).toBeNull();
		expect(seen(store, codex.id)).toBe(false);
	});

	test("Needs you never shows as seen", async () => {
		const { store, codex, report, render } = await started();
		store.select(featureId);
		await settle();
		await report(codex.id, "state=blocked");
		expect(seen(store, codex.id)).toBe(false);
		expect(store.getState().seenStatuses).toEqual({});
		expect(render()).not.toContain(" seen\"");
	});

	test("a new state from the agent shows unseen again", async () => {
		const { engine, store, codex, report } = await started();
		store.select(featureId);
		await settle();
		await report(codex.id, "state=done");
		expect(seen(store, codex.id)).toBe(true);
		store.select(primaryId);
		await settle();
		await report(codex.id, "state=working");
		await report(codex.id, "state=done");
		expect(seen(store, codex.id)).toBe(false);
		// A crash is a new state too.
		store.select(featureId);
		await settle();
		expect(seen(store, codex.id)).toBe(true);
		store.select(primaryId);
		await settle();
		engine.endTerminal(codex.id, 1);
		await settle();
		expect(seen(store, codex.id)).toBe(false);
	});

	test("with two agents in a worktree, only the one shown is seen", async () => {
		const { store, codex, report } = await started();
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, agent: "Codex" });
		await settle();
		const second = store.getState().terminals[2]!;
		await report(codex.id, "state=done");
		await report(second.id, "state=done");
		store.revealSession(codex.id);
		await settle();
		expect(seen(store, codex.id)).toBe(true);
		expect(seen(store, second.id)).toBe(false);
	});

	test("a collapsed repository leaves seen states out of its summary", async () => {
		const { store, codex, claude, report, render } = await started();
		await report(codex.id, "state=done");
		await report(claude.id, "state=done");
		store.toggleGroup(TIMBER);
		store.toggleGroup(API);
		await settle();
		expect(render()).toContain(">1 done<");
		store.select(apiId);
		await settle();
		const html = render();
		// api-server's Done was seen, so its summary is empty; timber's still says it.
		expect(html.match(/>1 done</g)).toHaveLength(1);
	});

	test("the palette's marks say seen too", async () => {
		const { store, codex, report } = await started();
		await report(codex.id, "state=done");
		store.select(featureId);
		await settle();
		const entry = paletteEntries(store.getState()).find(candidate => candidate.action.kind === "select" && candidate.action.worktree === featureId)!;
		expect(entry.sessions?.[0]?.seen).toBe(true);
		expect(entry.sessionWords).toContain("Done, seen");
	});

	test("the chip's glyph and tooltip say seen", async () => {
		const { store, codex, report, render } = await started();
		store.select(featureId);
		await settle();
		await report(codex.id, "state=done");
		const html = render();
		expect(html).toContain("Agent, codex. Done, seen");
		expect(html.match(/status-glyph status-done seen/g)!.length).toBeGreaterThanOrEqual(2);
	});
});
