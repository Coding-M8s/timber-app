import { describe, expect, test } from "bun:test";
import { createMockEngine } from "../src/mainview/engine/mock";
import { HANDOFF_NO_AGENT } from "../src/mainview/handoff-format";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { takeTerminalFocus } from "../src/mainview/terminal-focus";

const settle = async () => {
	for (let round = 0; round < 8; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";

/** The store on the mock engine, with a terminal already open in another worktree: the one `timber new` is typed in. */
async function started() {
	const engine = createMockEngine();
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	const typedIn = store.getState().repositories.find(repository => repository.path === TIMBER)!.worktrees[0]!;
	await store.openTerminal({ repository: TIMBER, worktree: typedIn.path, cols: 80, rows: 24 });
	await settle();
	const typing = store.getState().terminals[0]!;
	store.showTab("changes");
	return { engine, store, typedIn, typing };
}

describe("timber new typed in an app terminal", () => {
	test("with Timber's agent on, selects the new worktree, shows the Workspace tab, and starts the first saved agent there", async () => {
		const { engine, store, typedIn, typing } = await started();
		const handoff = engine.typeTimberNew(TIMBER, "feat/handoff", true)!;
		await settle();
		const selected = selectedWorktree(store.getState())!.worktree;
		expect(selected.path).toBe(handoff.worktree);
		expect(selected.branch).toBe("feat/handoff");
		expect(store.getState().tab).toBe("workspace");
		const opened = store.getState().terminals.filter(session => session.worktree === selected.id);
		expect(opened.map(session => [session.kind, session.name, session.path])).toEqual([["agent", "Claude Code", handoff.worktree]]);
		expect(store.getState().shownSessions[selected.id]).toBe(opened[0]!.id);
		expect(takeTerminalFocus(selected.id)).toBe(true);
		// The session it was typed in is left as it was, in its own worktree.
		expect(store.getState().terminals.find(session => session.id === typing.id)).toMatchObject({ worktree: typedIn.id, state: { kind: "running" } });
		expect(store.getState().toasts).toEqual([]);
	});

	test("with Timber's agent off, opens a shell in the new worktree", async () => {
		const { engine, store } = await started();
		const handoff = engine.typeTimberNew(TIMBER, "feat/shell", false)!;
		await settle();
		const selected = selectedWorktree(store.getState())!.worktree;
		expect(selected.path).toBe(handoff.worktree);
		expect(store.getState().terminals.filter(session => session.worktree === selected.id).map(session => session.kind)).toEqual(["terminal"]);
		expect(store.getState().tab).toBe("workspace");
	});

	test("with no saved agent, opens a shell and says where to add one", async () => {
		const { engine, store } = await started();
		await store.savePreferences({ agents: [] });
		engine.typeTimberNew(TIMBER, "feat/no-agent", true);
		await settle();
		const selected = selectedWorktree(store.getState())!.worktree;
		expect(store.getState().terminals.filter(session => session.worktree === selected.id).map(session => session.kind)).toEqual(["terminal"]);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([HANDOFF_NO_AGENT]);
	});

	test("in a repository that is not in the list, opens nothing, keeps the selection, and says how to start the agent", async () => {
		const { engine, store, typedIn } = await started();
		store.select(typedIn.id);
		const before = store.getState().terminals.length;
		engine.typeTimberNew("/elsewhere/repo", "feat/outside", true);
		await settle();
		expect(store.getState().terminals).toHaveLength(before);
		expect(selectedWorktree(store.getState())!.worktree.id).toBe(typedIn.id);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([
			"timber new made /elsewhere/repo-worktrees/feat/outside, but it is not in the list, so no session opened. Add its repository, then start the agent with: timber open --agent --no-editor -- '/elsewhere/repo-worktrees/feat/outside'",
		]);
	});
});
