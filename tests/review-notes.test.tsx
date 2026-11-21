import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { type MockFileChange, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { NO_REVIEW_AGENT, REVIEW_COPIED, describeReviewSent, firstReviewSession, reviewSessions, reviewTooLong, waitsOnPerson } from "../src/mainview/review-format";
import { sessionsOf } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { defaultLayout } from "../src/shared/layout";
import type { DiffLine, FileChange } from "../src/shared/file-changes";
import { OUTDATED_MARK, notedLines } from "../src/shared/review";
import { PASTE_NOT_READY } from "../src/shared/terminal";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const OTHER = sampleRepositories[0]!.worktrees[0]!;

const file = (path: string): FileChange => ({ area: "unstaged", kind: "modified", path, previousPath: null });
const mock = (change: FileChange, patch = samplePatch(change.path)): MockFileChange => ({ change, patch });
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** A store on the sample data with FEATURE selected, comparing Uncommitted, and two changed files. */
async function startedStore() {
	const engine = createMockEngine();
	await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [FEATURE.id] });
	engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts")), mock(file("src/b.ts"))]);
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(FEATURE.id);
	store.showTab("changes");
	await store.readChanges(TIMBER, FEATURE.id);
	return { engine, store };
}

/** The lines of the first hunk of the selected file's diff. */
function hunkLines(store: ReturnType<typeof createAppStore>): DiffLine[] {
	const diff = store.getState().changes?.diff;
	if (diff?.outcome !== "read" || diff.diff.kind !== "text") throw new Error("No diff");
	return diff.diff.sections[0]!.hunks[0]!.lines;
}

/** Note lines `first` to `last` of the selected file's first hunk. */
function addNote(store: ReturnType<typeof createAppStore>, first: number, last: number, text: string) {
	const view = store.getState().changes!;
	const lines = notedLines(hunkLines(store), first, last);
	if (!lines) throw new Error("Lines cannot be noted");
	return store.addReviewNote(FEATURE.id, { comparison: view.compared!, file: view.selected!, lines, text });
}

async function notesOnTwoFiles(store: ReturnType<typeof createAppStore>) {
	await store.selectChangedFile(file("src/a.ts"));
	// Lines 2 to 4 of the sample patch: the removed line and the two added after it.
	expect(addNote(store, 2, 4, "Why change the retries?\nThree was on purpose.")).toBeNull();
	await store.selectChangedFile(file("src/b.ts"));
	expect(addNote(store, 0, 0, "Sort these imports.")).toBeNull();
}

async function startAgent(store: ReturnType<typeof createAppStore>, agent: string) {
	await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, cols: 80, rows: 24, agent });
	await settle();
	return sessionsOf(store.getState(), FEATURE.id).find(session => session.name === agent)!;
}

describe("review notes", () => {
	test("are kept in the window and never sent while they are written", async () => {
		const { engine, store } = await startedStore();
		const claude = await startAgent(store, "Claude Code");
		await notesOnTwoFiles(store);
		const notes = store.getState().reviews[FEATURE.id]!;
		expect(notes.map(note => note.file.path)).toEqual(["src/a.ts", "src/b.ts"]);
		expect(notes[0]!.lines.map(line => line.kind)).toEqual(["removed", "added", "added"]);
		expect(engine.pastedInto(claude.id)).toEqual([]);
		expect(engine.typedInto(claude.id)).toBe("");
	});

	test("a note must say something, and can be changed and deleted", async () => {
		const { store } = await startedStore();
		await store.selectChangedFile(file("src/a.ts"));
		expect(addNote(store, 0, 0, "   ")).toBe("Write the note first.");
		expect(addNote(store, 0, 0, "bad \x1b[201~")).not.toBeNull();
		expect(addNote(store, 0, 0, "First\r\n")).toBeNull();
		const id = store.getState().reviews[FEATURE.id]![0]!.id;
		expect(store.getState().reviews[FEATURE.id]![0]!.text).toBe("First");
		expect(store.editReviewNote(FEATURE.id, id, "")).not.toBeNull();
		expect(store.editReviewNote(FEATURE.id, id, "Changed")).toBeNull();
		expect(store.getState().reviews[FEATURE.id]![0]!.text).toBe("Changed");
		store.deleteReviewNote(FEATURE.id, id);
		expect(store.getState().reviews[FEATURE.id]).toBeUndefined();
	});

	test("notes on several files go to the agent as one paste, exactly as previewed, only on Send", async () => {
		const { engine, store } = await startedStore();
		const claude = await startAgent(store, "Claude Code");
		await notesOnTwoFiles(store);
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const preview = await store.prepareReview(FEATURE.id);
		expect(preview).toBe([
			"Review notes (2 notes)",
			"",
			"src/a.ts:3-4",
			"> -export const retries = 3;",
			"> +export const retries = 5;",
			"> +export const backoffMilliseconds = 250;",
			"Why change the retries?",
			"Three was on purpose.",
			"",
			"src/b.ts:1",
			">  import { readConfig } from \"./config\";",
			"Sort these imports.",
		].join("\n"));
		// The preview alone sends nothing.
		expect(engine.pastedInto(claude.id)).toEqual([]);

		expect(await store.sendReview(FEATURE.id, claude.id, preview!)).toEqual({ outcome: "pasted" });
		expect(engine.pastedInto(claude.id)).toEqual([preview!]);
		// What reached the session is that text as one bracketed paste, line breaks as carriage returns, and no Enter after it.
		expect(engine.typedInto(claude.id)).toBe(`\x1b[200~${preview!.replaceAll("\n", "\r")}\x1b[201~`);
		const after = store.getState();
		expect(after.reviews[FEATURE.id]).toBeUndefined();
		expect(after.dialog).toBeNull();
		expect(after.toasts.map(toast => toast.text)).toContain(describeReviewSent("Claude Code"));
		expect(after.tab).toBe("workspace");
		expect(after.shownSessions[FEATURE.id]).toBe(claude.id);
	});

	test("a line changed since its note marks it outdated before the preview, and it is still sent with the old lines", async () => {
		const { engine, store } = await startedStore();
		const claude = await startAgent(store, "Claude Code");
		await notesOnTwoFiles(store);
		// src/b.ts shows now. src/a.ts changes where the note is.
		engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts"), samplePatch("src/a.ts").replace("retries = 5", "retries = 7")), mock(file("src/b.ts"))]);
		const preview = (await store.prepareReview(FEATURE.id))!;
		const notes = store.getState().reviews[FEATURE.id]!;
		expect(notes.map(note => note.outdated)).toEqual([true, false]);
		expect(preview).toContain(`src/a.ts:3-4 ${OUTDATED_MARK}\n> -export const retries = 3;\n> +export const retries = 5;`);
		expect(await store.sendReview(FEATURE.id, claude.id, preview)).toEqual({ outcome: "pasted" });
		expect(engine.pastedInto(claude.id)).toEqual([preview]);
	});

	test("reading the diff of a noted file again marks its changed notes outdated in the list", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts")), mock(file("src/b.ts"), samplePatch("src/b.ts").replace("readConfig } from", "readConfig, other } from"))]);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().reviews[FEATURE.id]!.map(note => note.outdated)).toEqual([false, true]);
		const markup = render(store);
		expect(markup).toContain('<span class="note-outdated">outdated</span>');
	});

	test("an agent that has not turned on bracketed paste gets nothing, and the notes stay", async () => {
		const { engine, store } = await startedStore();
		const claude = await startAgent(store, "Claude Code");
		await notesOnTwoFiles(store);
		const preview = (await store.prepareReview(FEATURE.id))!;
		engine.printInto(claude.id, "\x1b[?2004l");
		expect(await store.sendReview(FEATURE.id, claude.id, preview)).toEqual({ outcome: "not-ready", message: PASTE_NOT_READY });
		expect(engine.pastedInto(claude.id)).toEqual([]);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
	});

	test("a session that is not an agent of the worktree gets nothing", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, cols: 80, rows: 24 });
		await settle();
		const terminal = sessionsOf(store.getState(), FEATURE.id)[0]!;
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect((await store.sendReview(FEATURE.id, terminal.id, preview)).outcome).toBe("not-agent");
		expect((await store.sendReview(OTHER.id, terminal.id, preview)).outcome).toBe("not-agent");
		expect(engine.typedInto(terminal.id)).toBe("");
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
	});

	test("Copy review puts the same text on the clipboard and keeps the notes", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.copyReview(preview)).toBe(true);
		expect(await engine.readClipboard()).toBe(preview);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().toasts.map(toast => toast.text)).toContain(REVIEW_COPIED);
	});

	test("stay with their worktree when another one is selected, until discarded", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		store.select(OTHER.id);
		await store.readChanges(TIMBER, OTHER.id);
		expect(store.getState().reviews[OTHER.id]).toBeUndefined();
		store.select(FEATURE.id);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
		store.discardReview(FEATURE.id);
		expect(store.getState().reviews[FEATURE.id]).toBeUndefined();
	});

	test("go with a worktree that left the list", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.setRepositories(sampleRepositories.map(repository => ({ ...repository, worktrees: repository.worktrees.filter(worktree => worktree.id !== FEATURE.id) })));
		await store.reloadRepository(TIMBER);
		expect(store.getState().reviews[FEATURE.id]).toBeUndefined();
	});

	test("showing a note selects its file, and one no longer listed says so", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		const [onA] = store.getState().reviews[FEATURE.id]!;
		expect(await store.showReviewNote(FEATURE.id, onA!.id)).toBeNull();
		expect(store.getState().changes?.selected?.path).toBe("src/a.ts");
		expect(store.getState().noteInView).toEqual({ worktree: FEATURE.id, id: onA!.id });
		store.reviewNoteShown();
		engine.setFileChanges(FEATURE.path, [mock(file("src/b.ts"))]);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(await store.showReviewNote(FEATURE.id, onA!.id)).toBe("src/a.ts is no longer listed in this comparison.");
		// An outdated note's file shows, with a word that its lines may not.
		engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts"), samplePatch("src/a.ts").replace("retries = 5", "retries = 8")), mock(file("src/b.ts"))]);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.prepareReview(FEATURE.id);
		expect(await store.showReviewNote(FEATURE.id, onA!.id)).toBe("Its lines changed or left the diff since the note, so they may not show.");
	});
});

describe("the Changes tab with notes", () => {
	test("counts the notes on the tab, lists them under the files, and shows each under its lines", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		const markup = render(store);
		expect(markup).toContain('<span class="tab-count" aria-hidden="true">2</span><span class="visually-hidden">, 2 review notes</span>');
		expect(markup).toContain('<section class="review" aria-label="Review">');
		expect(markup).toContain('<span class="review-location">src/a.ts:3-4</span>');
		expect(markup).toContain('<span class="review-summary">Why change the retries?</span>');
		// src/b.ts shows: its note is under its first line, and every numbered line can take a note.
		expect(markup).toContain('<p class="diff-note-text">Sort these imports.</p>');
		expect(markup).toContain('aria-label="Add a note on line 1"');
		expect(markup).toContain('aria-label="Add a note on removed line 3"');
		expect(markup).toContain(">Send review</button>");
	});

	test("has no Review list and no count without notes", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).not.toContain("tab-count");
		expect(markup).not.toContain('class="review"');
	});

	test("the Send review dialog lists the running agents, and without one offers Copy review", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		let markup = render(store);
		expect(markup).toContain(NO_REVIEW_AGENT);
		expect(markup).toContain(">Copy review</button>");
		expect(markup).not.toContain(">Send</button>");
		await startAgent(store, "Claude Code");
		markup = render(store);
		expect(markup).toContain('<span class="review-agent-name">Claude Code</span>');
		expect(markup).toContain(">Send</button>");
	});
});

describe("choosing the agent", () => {
	const session = (id: string, worktree: string, kind: "agent" | "terminal", running = true, blocked = false) => ({
		id, worktree, kind, name: id, repository: TIMBER, path: "/p", shell: "/bin/x", command: "x",
		state: running ? { kind: "running" as const } : { kind: "exited" as const, exitCode: 0, signal: null },
		status: blocked ? { state: "blocked" as const, kind: "permission" as const, message: null, progress: null, updated: 0 } as never : null,
		children: [],
	});

	test("only running agents of the worktree, and the only one is picked", () => {
		const all = [session("a", "w", "agent"), session("b", "w", "terminal"), session("c", "w", "agent", false), session("d", "x", "agent")];
		expect(reviewSessions(all, "w").map(entry => entry.id)).toEqual(["a"]);
		expect(firstReviewSession(reviewSessions(all, "w"))).toBe("a");
		expect(firstReviewSession([session("a", "w", "agent"), session("e", "w", "agent")])).toBeNull();
	});

	test("a review longer than one paste says so", () => {
		expect(reviewTooLong(100_001)).toBe("The review is 100001 characters, more than one paste can take (100000). Send it in parts, or copy it.");
	});

	test("an agent waiting on the person is said to", () => {
		expect(waitsOnPerson(session("a", "w", "agent", true, true))).toBe(true);
		expect(waitsOnPerson(session("a", "w", "agent"))).toBe(false);
	});
});
