import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { sessionMenuChoice, sessionMenuItems } from "../src/mainview/agent-format";
import { CHOPS_NOT_READ, NO_CHOPS_FOR_SESSION, SESSION_ENDED_FOR_CHOP, chopEntries, sessionChipMenuChop, sessionChipMenuItems } from "../src/mainview/chop-format";
import { ApproveChopView } from "../src/mainview/components/ApproveChopDialog";
import { BEING_REMOVED_REASON } from "../src/mainview/done-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { FOLDER_MISSING_FOR_SESSION, NO_WORKTREE_SELECTED, STARTING_SESSION, matchEntries, paletteEntries } from "../src/mainview/palette";
import { runPaletteEntry } from "../src/mainview/palette-run";
import { createAppStore } from "../src/mainview/store/store";
import {
	CHOP_APPROVAL_LIMIT, type ChopList, type ListedChop, chopDigestInput, commandChops, findListedChop, isChopApproved, readChopApprovals, withChopApproval,
} from "../src/shared/chops";
import { parseSettings, serializeSettings } from "../src/shared/settings";
import { PASTE_NOT_READY, bracketedPaste, chopRunBytes, pasteBytes } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const TIMBER_ID = sampleRepositories[0]!.worktrees[0]!.id;
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const size = () => ({ cols: 80, rows: 24 });

const listed = (chops: ListedChop[]): ChopList => ({ outcome: "listed", file: { state: "read" }, path: "/r/.timber/chops.json", chops, overridden: [] });
const chop = (name: string, more: Partial<ListedChop> = {}): ListedChop => ({ name, kind: "command", text: `run ${name}`, description: "", agent: null, source: "repository-file", ...more });

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

describe("approvals of repository chops", () => {
	test("a personal chop never asks; a file chop asks until its digest is approved for this repository", () => {
		expect(isChopApproved({}, "/r", { source: "personal-every" }, DIGEST)).toBe(true);
		expect(isChopApproved({}, "/r", { source: "personal-repository" }, DIGEST)).toBe(true);
		expect(isChopApproved({}, "/r", { source: "repository-file" }, DIGEST)).toBe(false);
		const approvals = withChopApproval({}, "/r", DIGEST);
		expect(isChopApproved(approvals, "/r", { source: "repository-file" }, DIGEST)).toBe(true);
		// Per repository, and per text.
		expect(isChopApproved(approvals, "/other", { source: "repository-file" }, DIGEST)).toBe(false);
		expect(isChopApproved(approvals, "/r", { source: "repository-file" }, OTHER_DIGEST)).toBe(false);
	});

	test("keeps each digest once, newest last, and at most the limit per repository", () => {
		let approvals = withChopApproval({}, "/r", DIGEST);
		approvals = withChopApproval(approvals, "/r", OTHER_DIGEST);
		approvals = withChopApproval(approvals, "/r", DIGEST);
		expect(approvals["/r"]).toEqual([OTHER_DIGEST, DIGEST]);
		for (let index = 0; index < CHOP_APPROVAL_LIMIT + 5; index += 1) approvals = withChopApproval(approvals, "/r", index.toString(16).padStart(64, "0"));
		expect(approvals["/r"]).toHaveLength(CHOP_APPROVAL_LIMIT);
		expect(approvals["/r"]).not.toContain(DIGEST);
	});

	test("the digest input names the kind, so an approved prompt never runs as a command", () => {
		expect(chopDigestInput({ kind: "command", text: "x" })).not.toBe(chopDigestInput({ kind: "prompt", text: "x" }));
	});

	test("reading drops what is not a digest, and the settings file keeps them across a save", () => {
		expect(readChopApprovals({ "/r": [DIGEST, "nope", 3, DIGEST.toUpperCase(), DIGEST], "": [DIGEST], "/s": "x", "/t": [] })).toEqual({ "/r": [DIGEST] });
		expect(readChopApprovals("nope")).toEqual({});
		const text = serializeSettings({ repositories: [], chopApprovals: { "/r": [DIGEST] } });
		expect(parseSettings(text)?.chopApprovals).toEqual({ "/r": [DIGEST] });
		expect(serializeSettings({ repositories: [] })).not.toContain("chopApprovals");
		// A damaged part costs nothing else.
		const damaged = JSON.stringify({ version: 1, repositories: [{ path: "/r", commonDir: "/r/.git" }], chopApprovals: "nope" });
		expect(parseSettings(damaged)).toEqual({ repositories: [{ path: "/r", commonDir: "/r/.git" }] });
	});
});

describe("the bytes typed for a chop", () => {
	test("running: one bracketed paste and Enter when the shell asks, line by line otherwise, never a tab without it", () => {
		expect(chopRunBytes("make\nmake check", true)).toBe(`${bracketedPaste("make\nmake check")}\r`);
		expect(chopRunBytes("make\nmake check", false)).toBe("make\rmake check\r");
		expect(chopRunBytes("printf 'a\tb'", false)).toBeNull();
		expect(chopRunBytes("printf 'a\tb'", true)).toBe(`${bracketedPaste("printf 'a\tb'")}\r`);
	});

	test("inserting: never Enter; a line break only inside a bracketed paste", () => {
		expect(pasteBytes("make\nmake check", true)).toBe(bracketedPaste("make\nmake check"));
		expect(pasteBytes("make check", false)).toBe("make check");
		expect(pasteBytes("make\nmake check", false)).toBeNull();
		expect(pasteBytes("make", true)?.endsWith("\r")).toBe(false);
	});
});

describe("menu entries for chops", () => {
	test("only command chops are offered, in listed order, with the description or the first line as the tooltip", () => {
		const list = listed([
			chop("Test", { description: "Every test" }),
			chop("Review", { kind: "prompt", agent: "Codex" }),
			chop("Two", { text: "one\ntwo", source: "personal-every" }),
		]);
		expect(commandChops(list).map(entry => entry.name)).toEqual(["Test", "Two"]);
		expect(chopEntries(list)).toEqual([
			{ name: "Test", title: "Every test", source: "repository-file" },
			{ name: "Two", title: "one ...", source: "personal-every" },
		]);
		expect(chopEntries(null)).toEqual([]);
		expect(chopEntries({ outcome: "failed", message: "x" })).toEqual([]);
		expect(findListedChop(commandChops(list), "test")?.name).toBe("Test");
	});

	test("the \"+\" menu lists the chops after the agents and before Set up agents", () => {
		const items = sessionMenuItems([{ name: "Codex", command: "codex" }]);
		const chops = [{ name: "Test" }, { name: "Lint" }];
		expect(sessionMenuChoice(items, 0, chops)).toEqual({ kind: "start", agent: null });
		expect(sessionMenuChoice(items, 1, chops)).toEqual({ kind: "start", agent: "Codex" });
		expect(sessionMenuChoice(items, 2, chops)).toEqual({ kind: "chop", name: "Test" });
		expect(sessionMenuChoice(items, 3, chops)).toEqual({ kind: "chop", name: "Lint" });
		expect(sessionMenuChoice(items, 4, chops)).toEqual({ kind: "set-up" });
		expect(sessionMenuChoice(items, 5, chops)).toBeNull();
		expect(sessionMenuChoice(items, 2)).toEqual({ kind: "set-up" });
	});

	test("a session's menu offers Insert chop for each command, disabled with the reason once it ended", () => {
		const list = listed([chop("Test"), chop("Lint")]);
		const running = sessionChipMenuItems(true, list);
		expect(running.map(item => [item.label, item.disabled])).toEqual([["Insert chop: Test", false], ["Insert chop: Lint", false]]);
		expect(running.map(item => sessionChipMenuChop(item.id))).toEqual(["Test", "Lint"]);
		expect(sessionChipMenuItems(false, list).every(item => item.disabled && item.note === SESSION_ENDED_FOR_CHOP)).toBe(true);
		expect(sessionChipMenuItems(true, null)).toMatchObject([{ disabled: true, note: CHOPS_NOT_READ }]);
		expect(sessionChipMenuItems(true, listed([]))).toMatchObject([{ disabled: true, note: NO_CHOPS_FOR_SESSION }]);
		expect(sessionChipMenuChop(sessionChipMenuItems(true, listed([]))[0]!.id)).toBeNull();
		expect(sessionChipMenuChop("done")).toBeNull();
	});
});

describe("chops in the palette", () => {
	test("each command chop of the selected worktree's repository is \"Run chop: <name>\", found by name and description", async () => {
		const { store } = await startedStore();
		store.select(FEATURE.id);
		await store.readChops(TIMBER);
		const entries = paletteEntries(store.getState());
		const test = entries.find(entry => entry.label === "Run chop: Test")!;
		expect(test).toMatchObject({ disabledReason: null, action: { kind: "chop", repository: TIMBER, worktree: FEATURE.id, chop: "Test" } });
		expect(entries.some(entry => entry.label === "Run chop: Review the diff")).toBe(false);
		expect(matchEntries(entries, "browser sample").map(match => match.entry.label)).toContain("Run chop: Dev server");
	});

	test("a chop that cannot run now is listed with the reason", async () => {
		const { store } = await startedStore();
		await store.readChops(TIMBER);
		// With nothing selected, the chops last read still show, and say why.
		expect(paletteEntries({ ...store.getState(), selection: null }).find(entry => entry.label === "Run chop: Test")?.disabledReason).toBe(NO_WORKTREE_SELECTED);
		// A worktree whose folder is missing, in a repository whose file is damaged: a personal chop is still listed, with the reason.
		const api = sampleRepositories[1]!;
		const missing = api.worktrees.find(worktree => !worktree.pathExists)!;
		expect(await store.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null }] })).toMatchObject({ outcome: "saved" });
		store.select(missing.id);
		await store.readChops(api.path);
		expect(paletteEntries(store.getState()).find(entry => entry.label === "Run chop: Hello")?.disabledReason).toBe(FOLDER_MISSING_FOR_SESSION);
		await store.readChops(TIMBER);
		store.select(FEATURE.id);
		const state = store.getState();
		const starting = { ...state, operations: [...state.operations, { kind: "open-terminal" as const, worktree: FEATURE.id, agent: null }] };
		expect(paletteEntries(starting).find(entry => entry.label === "Run chop: Test")?.disabledReason).toBe(STARTING_SESSION);
		const removing = { ...state, removals: [{ repository: TIMBER, worktree: FEATURE, toast: "", status: { kind: "running" as const } }] };
		expect(paletteEntries(removing).find(entry => entry.label === "Run chop: Test")?.disabledReason).toBe(BEING_REMOVED_REASON);
	});
});

describe("running chops in the app (mock engine)", () => {
	test("a personal chop runs from the palette in the active worktree, in a session named after it, and the shell stays", async () => {
		const { engine, store } = await startedStore();
		expect(await store.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null }] })).toMatchObject({ outcome: "saved" });
		store.select(FEATURE.id);
		await store.readChops(TIMBER);
		const entry = paletteEntries(store.getState()).find(candidate => candidate.label === "Run chop: Hello")!;
		runPaletteEntry(store, entry, size);
		await settle();
		const session = store.getState().terminals.find(candidate => candidate.name === "Hello")!;
		expect(session).toMatchObject({ kind: "terminal", worktree: FEATURE.id, path: FEATURE.path, state: { kind: "running" } });
		expect(store.getState().shownSessions[FEATURE.id]).toBe(session.id);
		expect(store.getState().tab).toBe("workspace");
		expect(engine.typedInto(session.id)).toBe("pwd\r");
	});

	test("a repository chop asks first and shows its exact text; Run approves and runs it; a changed text asks again", async () => {
		const { engine, store } = await startedStore();
		store.select(FEATURE.id);
		await store.runChop(TIMBER, FEATURE.id, "Test", size());
		expect(store.getState().terminals).toEqual([]);
		const dialog = store.getState().dialog;
		expect(dialog).toMatchObject({ kind: "approve-chop", repository: TIMBER, worktree: FEATURE.id, chop: { name: "Test", text: "bun test" }, path: `${TIMBER}/.timber/chops.json` });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Run Test from the repository?");
		expect(markup).toContain(">bun test</");
		expect(markup).toContain(`${TIMBER}/.timber/chops.json`);

		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Test", size(), "bun test");
		await settle();
		const first = store.getState().terminals.find(candidate => candidate.name === "Test")!;
		expect(engine.typedInto(first.id)).toBe("bun test\r");
		expect(Object.keys(engine.chopApprovals())).toEqual([TIMBER]);

		// Approved: the next run asks nothing.
		await store.runChop(TIMBER, FEATURE.id, "Test", size());
		await settle();
		expect(store.getState().terminals.filter(candidate => candidate.name.startsWith("Test"))).toHaveLength(2);
		expect(store.getState().dialog).toBeNull();

		engine.setChopsFile(TIMBER, JSON.stringify({ version: 1, chops: [{ name: "Test", kind: "command", text: "bun test --bail" }] }));
		await settle();
		await store.runChop(TIMBER, FEATURE.id, "Test", size());
		expect(store.getState().dialog).toMatchObject({ kind: "approve-chop", chop: { text: "bun test --bail" } });
		// An approval of the old text runs nothing.
		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Test", size(), "bun test");
		expect(store.getState().dialog).toMatchObject({ kind: "approve-chop", chop: { text: "bun test --bail" } });
		expect(store.getState().terminals.filter(candidate => candidate.name.startsWith("Test"))).toHaveLength(2);
	});

	test("the question never replaces a dialog opened meanwhile, and a run after Run that cannot start says why", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "settings" });
		await store.runChop(TIMBER, FEATURE.id, "Test", size());
		expect(store.getState().dialog).toMatchObject({ kind: "settings" });
		expect(store.getState().toasts.at(-1)?.text).toContain("needs your approval");
		store.closeDialog();
		const state = store.getState();
		const removing = { repository: TIMBER, worktree: FEATURE, toast: "", status: { kind: "running" as const } };
		// Acted out as the store sees it: Timber removes the worktree while the question was open.
		(state as { removals: unknown }).removals = [removing];
		await store.runChop(TIMBER, FEATURE.id, "Test", size(), "bun test");
		expect(store.getState().toasts.at(-1)?.text).toBe(`Test was not started: ${BEING_REMOVED_REASON}`);
		expect(store.getState().terminals).toEqual([]);
	});

	test("the approval asks with Cancel first, and Run is the dialog's submit", () => {
		const markup = renderToStaticMarkup(<ApproveChopView chop={chop("Lint", { text: "bun run lint", description: "Lint it" })} path="/r/.timber/chops.json" onRun={() => {}} onClose={() => {}} />);
		expect(markup).toContain("Run Lint from the repository?");
		expect(markup).toContain(">bun run lint</");
		expect(markup).toContain("/r/.timber/chops.json");
		expect(markup).toContain("Lint it");
		expect(markup).toContain(">Run</button>");
	});

	test("a chop that is gone, or a prompt, starts nothing and says why", async () => {
		const { store } = await startedStore();
		await store.runChop(TIMBER, FEATURE.id, "Review the diff", size(), "x");
		expect(store.getState().terminalProblem).toMatchObject({ worktree: FEATURE.id, agent: "Review the diff", message: expect.stringContaining("No command chop") });
		expect(store.getState().terminals).toEqual([]);
	});

	test("Insert chop types the text into the session with no Enter, as a bracketed paste when the program asked", async () => {
		const { engine, store } = await startedStore();
		expect(await store.savePreferences({ chops: [{ name: "Two", kind: "command", text: "make\nmake check", description: "", agent: null, repository: null }, { name: "One", kind: "command", text: "make", description: "", agent: null, repository: null }] })).toMatchObject({ outcome: "saved" });
		store.select(TIMBER_ID);
		await store.readChops(TIMBER);
		await store.openTerminal({ repository: TIMBER, worktree: TIMBER, cols: 80, rows: 24 });
		await settle();
		const session = store.getState().terminals[0]!;
		// The pretend shell has not asked for bracketed paste: one line goes as typed, two lines are refused.
		await store.insertChop(session.id, "One");
		expect(engine.typedInto(session.id)).toBe("make");
		await store.insertChop(session.id, "Two");
		expect(store.getState().toasts.at(-1)).toMatchObject({ text: `Two was not inserted: ${PASTE_NOT_READY}` });
		engine.printInto(session.id, "\x1b[?2004h");
		await store.insertChop(session.id, "Two");
		expect(engine.typedInto(session.id)).toBe(`make${bracketedPaste("make\nmake check")}`);
		expect(engine.pastedInto(session.id)).toEqual(["make", "make\nmake check"]);
	});

	test("the empty pane and the \"+\" menu offer the repository's command chops", async () => {
		const { store } = await startedStore();
		store.select(FEATURE.id);
		await store.readChops(TIMBER);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain(">Run Test</button>");
		expect(markup).toContain(">Run Dev server</button>");
		expect(markup).not.toContain(">Run Review the diff</button>");
	});
});
