import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { sessionMenuChoice, sessionMenuItems } from "../src/mainview/agent-format";
import { CHOPS_NOT_READ, NO_CHOPS_FOR_SESSION, SESSION_ENDED_FOR_CHOP, chopEntries, commandChopEntries, sessionChipMenuChop, sessionChipMenuItems } from "../src/mainview/chop-format";
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
	test("the menu and palette offer every chop and Insert chop only commands, in listed order, with the description or the first line as the tooltip", () => {
		const list = listed([
			chop("Test", { description: "Every test" }),
			chop("Review", { kind: "prompt", agent: "Codex" }),
			chop("Two", { text: "one\ntwo", source: "personal-every" }),
		]);
		expect(commandChops(list).map(entry => entry.name)).toEqual(["Test", "Two"]);
		expect(chopEntries(list)).toEqual([
			{ name: "Test", kind: "command", title: "Every test", source: "repository-file" },
			{ name: "Review", kind: "prompt", title: "run Review", source: "repository-file" },
			{ name: "Two", kind: "command", title: "one ...", source: "personal-every" },
		]);
		expect(commandChopEntries(list).map(entry => entry.name)).toEqual(["Test", "Two"]);
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

	test("a chop that is gone starts nothing and says why", async () => {
		const { store } = await startedStore();
		await store.runChop(TIMBER, FEATURE.id, "Nope", size(), "x");
		expect(store.getState().terminalProblem).toMatchObject({ worktree: FEATURE.id, agent: "Nope", message: expect.stringContaining("No chop called") });
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

const ASK = "Write tests for what changed.\nRun them before you stop.";
const askChop = (agent: string | null = "Codex") => ({ name: "Ask", kind: "prompt" as const, text: ASK, description: "", agent, repository: null });

async function promptStore(agent: string | null = "Codex") {
	const started = await startedStore();
	expect(await started.store.savePreferences({ chops: [askChop(agent)] })).toMatchObject({ outcome: "saved" });
	started.store.select(FEATURE.id);
	await started.store.readChops(TIMBER);
	return started;
}

const toastTexts = (store: ReturnType<typeof createAppStore>) => store.getState().toasts.map(toast => toast.text);

describe("prompt chops in the app (mock engine)", () => {
	test("with no agent running, the chop's agent starts with nothing added to its command line, and gets the prompt once ready, then Enter", async () => {
		const { engine, store } = await promptStore();
		const entry = paletteEntries(store.getState()).find(candidate => candidate.label === "Send prompt: Ask")!;
		expect(entry.disabledReason).toBeNull();
		runPaletteEntry(store, entry, size);
		await settle();
		const session = store.getState().terminals.find(candidate => candidate.kind === "agent")!;
		expect(session).toMatchObject({ name: "Codex", worktree: FEATURE.id, prompt: { state: "sent" } });
		// The prompt never appears on a command line.
		expect(session.command).toBe("/usr/local/bin/codex");
		expect(session.command).not.toContain("Write tests");
		expect(engine.promptsSentTo(session.id)).toEqual([ASK]);
		// One bracketed paste, so the line break does not submit early, then Enter.
		expect(engine.typedInto(session.id)).toBe(`${bracketedPaste(ASK)}\r`);
		expect(toastTexts(store)).toContain("Prompt sent to Codex.");
	});

	test("a chop that names no agent starts the first saved one; one that names an agent not saved starts nothing", async () => {
		const { store } = await promptStore(null);
		await store.runChop(TIMBER, FEATURE.id, "Ask", size());
		await settle();
		expect(store.getState().terminals.map(session => session.name)).toEqual(["Claude Code"]);

		const other = await promptStore("Aider");
		await other.store.runChop(TIMBER, FEATURE.id, "Ask", size());
		await settle();
		expect(other.store.getState().terminals).toEqual([]);
		expect(other.store.getState().terminalProblem?.message).toContain('No agent called "Aider"');
	});

	test("with one agent running, it goes there as typed input, and no agent starts", async () => {
		const { engine, store } = await promptStore();
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size(), agent: "Claude Code" });
		await settle();
		const running = store.getState().terminals[0]!;
		await store.runChop(TIMBER, FEATURE.id, "Ask", size());
		await settle();
		expect(store.getState().terminals).toHaveLength(1);
		expect(engine.promptsSentTo(running.id)).toEqual([ASK]);
		expect(store.getState().shownSessions[FEATURE.id]).toBe(running.id);
		expect(toastTexts(store)).toContain("Ask sent to Claude Code.");
	});

	test("with several agents running, the dialog asks; the picked one gets it, or a new one starts", async () => {
		const { engine, store } = await promptStore();
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size(), agent: "Claude Code" });
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size(), agent: "Codex" });
		await settle();
		const [claude, codex] = store.getState().terminals;
		await store.runChop(TIMBER, FEATURE.id, "Ask", size());
		expect(store.getState().dialog).toEqual({ kind: "send-prompt", repository: TIMBER, worktree: FEATURE.id, chop: "Ask" });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Send Ask");
		expect(markup).toContain("A new Codex");
		expect(engine.promptsSentTo(claude!.id)).toEqual([]);

		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), undefined, { session: codex!.id });
		await settle();
		expect(engine.promptsSentTo(codex!.id)).toEqual([ASK]);
		expect(engine.promptsSentTo(claude!.id)).toEqual([]);

		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), undefined, { session: null });
		await settle();
		expect(store.getState().terminals).toHaveLength(3);
		expect(engine.promptsSentTo(store.getState().terminals[2]!.id)).toEqual([ASK]);
	});

	test("an only agent that waits on the person is never picked without asking", async () => {
		const { engine, store } = await promptStore();
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size(), agent: "Claude Code" });
		await settle();
		const running = store.getState().terminals[0]!;
		engine.agentStatus(running.id, "state=blocked:kind=permission");
		await settle();
		await store.runChop(TIMBER, FEATURE.id, "Ask", size());
		expect(store.getState().dialog).toMatchObject({ kind: "send-prompt" });
		expect(engine.promptsSentTo(running.id)).toEqual([]);
		expect(renderToStaticMarkup(<App store={store} />)).toContain("A new Codex");
	});

	test("a prompt to an agent that has ended says so, and starts nothing", async () => {
		const { engine, store } = await promptStore();
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size(), agent: "Claude Code" });
		await settle();
		const running = store.getState().terminals[0]!;
		engine.endTerminal(running.id, 0);
		await settle();
		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), undefined, { session: running.id });
		await settle();
		expect(store.getState().terminals).toHaveLength(1);
		expect(toastTexts(store).at(-1)).toContain("Ask was not sent: The session has ended.");
	});

	test("with no agent saved, Copy prompt puts exactly the chop's text on the clipboard", async () => {
		const { engine, store } = await promptStore();
		expect(await store.savePreferences({ agents: [] })).toMatchObject({ outcome: "saved" });
		const entry = paletteEntries(store.getState()).find(candidate => candidate.label === "Copy prompt: Ask")!;
		expect(entry.disabledReason).toBeNull();
		runPaletteEntry(store, entry, size);
		await settle();
		expect(await engine.readClipboard()).toBe(ASK);
		expect(store.getState().terminals).toEqual([]);
		expect(toastTexts(store)).toContain("Ask copied. Paste it where you want it.");
	});

	test("a repository prompt asks before it is sent, says where it goes, and Send sends it there", async () => {
		const { engine, store } = await startedStore();
		store.select(FEATURE.id);
		await store.readChops(TIMBER);
		await store.runChop(TIMBER, FEATURE.id, "Review the diff", size());
		await settle();
		expect(store.getState().terminals).toEqual([]);
		const dialog = store.getState().dialog;
		expect(dialog).toMatchObject({ kind: "approve-chop", chop: { name: "Review the diff", kind: "prompt" } });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Send Review the diff from the repository?");
		expect(markup).toContain("goes to a new Claude Code exactly as shown");
		expect(markup).toContain(">Send</button>");
		const text = dialog?.kind === "approve-chop" ? dialog.chop.text : "";
		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Review the diff", size(), text, { session: null });
		await settle();
		const session = store.getState().terminals[0]!;
		expect(session.name).toBe("Claude Code");
		expect(engine.promptsSentTo(session.id)).toEqual([text]);
	});

	test("a prompt that needs a new agent while another session starts there says why", async () => {
		const { store } = await promptStore();
		// Act out a session starting: the store refuses a second start in the worktree.
		const starting = store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size() });
		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), undefined, { session: null });
		await starting;
		await settle();
		expect(toastTexts(store).at(-1)).toContain("Ask was not started: another session is starting there.");
	});

	test("the menu marks prompts, and the empty pane offers Send, or Copy with no agent saved", async () => {
		const { store } = await promptStore();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain(">Send Ask</button>");
		expect(await store.savePreferences({ agents: [] })).toMatchObject({ outcome: "saved" });
		expect(renderToStaticMarkup(<App store={store} />)).toContain(">Copy Ask</button>");
	});
});

describe("chops with \"Use chops\" off", () => {
	test("the palette lists none, none runs, and none is inserted; turned on again, they are back", async () => {
		const { engine, store } = await startedStore();
		await store.savePreferences({ chops: [{ name: "Mine", kind: "command", text: "make", description: "", agent: null, repository: null }] });
		store.select(FEATURE.id);
		await store.readChops(TIMBER);
		expect(paletteEntries(store.getState()).some(entry => entry.label.startsWith("Run chop:"))).toBe(true);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, cols: 80, rows: 24 });
		await settle();
		const session = store.getState().terminals[0]!;

		await store.savePreferences({ useChops: false });
		expect(paletteEntries(store.getState()).some(entry => entry.label.startsWith("Run chop:") || entry.label.startsWith("Send prompt:") || entry.label.startsWith("Copy prompt:"))).toBe(false);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).not.toContain("Insert chop");
		await store.runChop(TIMBER, FEATURE.id, "Mine", size());
		expect(store.getState().terminals).toHaveLength(1);
		expect(store.getState().dialog).toBeNull();
		await store.insertChop(session.id, "Mine");
		expect(engine.typedInto(session.id)).toBe("");

		await store.savePreferences({ useChops: true });
		expect(store.getState().preferences.chops.map(chop => chop.name)).toEqual(["Mine"]);
		expect(paletteEntries(store.getState()).some(entry => entry.label === "Run chop: Mine")).toBe(true);
		await store.insertChop(session.id, "Mine");
		expect(engine.typedInto(session.id)).toBe("make");
	});
});
