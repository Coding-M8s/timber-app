import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { NO_NOTES_HINT } from "../src/mainview/changes-panel-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { type MockFileChange, samplePatch } from "../src/mainview/engine/mock-file-changes";
import {
	NEW_REVIEW_AGENT_NOTE, REVIEW_COPIED, noNewReviewAgent, noReviewAgent, describeNewReviewAgent, describeReviewAgentStarted, describeReviewNotPasted, describeReviewSent,
	reviewAlreadyWaiting, reviewTooLong,
} from "../src/mainview/review-format";
import { onlyAgent, reviewWaiting, runningAgents, waitsOnPerson } from "../src/mainview/agent-sessions";
import { PROMPT_STILL_STARTING, promptEndedMessage } from "../src/shared/agent-prompt";
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

const file = (path: string): FileChange => ({ area: "unstaged", kind: "modified", path, previousPath: null, added: null, removed: null, version: "" });
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
	store.showSidePanel("changes");
	await store.readChanges(TIMBER, FEATURE.id);
	await store.selectChangedFile(file("src/a.ts"));
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
		expect(markup).toContain('<span class="review-ref-tag outdated">outdated</span>');
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
		// Its removed line is still there as it was, so the old lines show in part and nothing needs saying.
		expect(await store.showReviewNote(FEATURE.id, onA!.id)).toBeNull();
		// None of its lines are left: that is said.
		const rewritten = samplePatch("src/a.ts").replace("retries = 3", "retries = 4").replace("retries = 5", "retries = 8").replace("= 250", "= 300");
		engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts"), rewritten), mock(file("src/b.ts"))]);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(await store.showReviewNote(FEATURE.id, onA!.id)).toBe("Its lines changed or left the diff since the note, so they may not show.");
	});

	test("a note on its way into view is let go when another file or worktree is chosen first", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		const [onA] = store.getState().reviews[FEATURE.id]!;
		await store.showReviewNote(FEATURE.id, onA!.id);
		expect(store.getState().noteInView).toEqual({ worktree: FEATURE.id, id: onA!.id });
		await store.selectChangedFile(file("src/b.ts"));
		expect(store.getState().noteInView).toBeNull();
		await store.showReviewNote(FEATURE.id, onA!.id);
		await store.compareChanges("base");
		expect(store.getState().noteInView).toBeNull();
		await store.showReviewNote(FEATURE.id, onA!.id);
		store.select(OTHER.id);
		expect(store.getState().noteInView).toBeNull();
	});

	test("the chosen note stays chosen until another is chosen or it goes", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		const [onA, onB] = store.getState().reviews[FEATURE.id]!;
		await store.showReviewNote(FEATURE.id, onA!.id);
		store.reviewNoteShown();
		expect(store.getState().chosenNote).toEqual({ worktree: FEATURE.id, id: onA!.id });
		await store.showReviewNote(FEATURE.id, onB!.id);
		expect(store.getState().chosenNote).toEqual({ worktree: FEATURE.id, id: onB!.id });
		store.deleteReviewNote(FEATURE.id, onA!.id);
		expect(store.getState().chosenNote).toEqual({ worktree: FEATURE.id, id: onB!.id });
		store.deleteReviewNote(FEATURE.id, onB!.id);
		expect(store.getState().chosenNote).toBeNull();
	});
});

describe("the Changes view with notes", () => {
	test("counts the notes on the panel's switch, lists them in the Review section under the files, and shows each under its lines", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		const markup = render(store);
		expect(markup).toContain('Changes<span class="tab-count" aria-hidden="true">2</span><span class="visually-hidden">, 2 review notes</span></button>');
		// The Review section is at the foot of the Changes view, after the file list.
		const files = markup.indexOf('class="changes-files"');
		const panel = markup.indexOf('<section class="review-panel" aria-label="Review">');
		expect(files).toBeGreaterThan(-1);
		expect(panel).toBeGreaterThan(files);
		expect(markup.indexOf('data-view="changes"')).toBeLessThan(files);
		expect(markup).toContain('<span class="visually-hidden">2 review notes</span>');
		expect(markup).toContain(">Send review</button>");
		expect(markup).toContain(">Copy review</button>");
		expect(markup).toContain(">Discard</button>");
		// The Changes view shows, so the diff needs no Review button of its own.
		expect(markup).not.toContain("review-toggle");
		// src/b.ts shows: its note is under its first line, and every numbered line can take a note.
		expect(markup).toContain('<p class="diff-note-text">Sort these imports.</p>');
		expect(markup).toContain('aria-label="Add a note on line 1"');
		expect(markup).toContain('aria-label="Add a note on removed line 3"');
	});

	test("each line that takes a note has a + in its numbers button, hidden from a screen reader, which hears the button as before", async () => {
		const { engine, store } = await startedStore();
		const patch = samplePatch("src/a.ts").replace(" \treturn readConfig();\n", " \treturn readConfig();\n\\ No newline at end of file\n");
		engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts"), patch)]);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(file("src/a.ts"));
		const markup = render(store);
		const plus = '<span class="diff-note-plus" aria-hidden="true">+</span>';
		// Eight numbered lines, each a lit row with a + first in its button, named as before.
		expect(markup.split('<div class="diff-line context notable">').length - 1 + markup.split('<div class="diff-line added notable">').length - 1 + markup.split('<div class="diff-line removed notable">').length - 1).toBe(8);
		expect(markup.split(plus).length - 1).toBe(8);
		expect(markup).toMatch(/<button type="button" class="diff-note-target" tabindex="0" data-line="0-1-0" aria-label="Add a note on line 1" title="[^"]*Drag the \+[^"]*"><span class="diff-note-plus" aria-hidden="true">\+<\/span>/);
		// Git's note and the hunk's header take no note: no lit row, no +.
		expect(markup).toContain('<div class="diff-line note"><span class="diff-number"></span><span class="diff-number"></span>');
		expect(markup).toMatch(/<div class="diff-hunk-header">@@ -1,6 \+1,7 @@<\/div><div class="diff-line context notable">/);
	});

	test("each note leads with a reference: a button named by where it is, with its first line", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		const markup = render(store);
		const [onA] = store.getState().reviews[FEATURE.id]!;
		expect(markup).toContain(`<button type="button" class="review-ref" data-note-id="${onA!.id}" aria-label="Show src/a.ts:3-4" title="Show src/a.ts:3-4">`);
		expect(markup).toContain('<span class="review-ref-folder">src/</span><span class="review-ref-name">a.ts:3-4</span>');
		expect(markup).toContain('<span class="review-ref-line"><span class="review-ref-marker removed">-</span>export const retries = 3;</span>');
		expect(markup).toContain('<p class="review-text">Why change the retries?\nThree was on purpose.</p>');
		expect(markup).toContain('aria-label="Edit the note on src/a.ts:3-4"');
		expect(markup).toContain('aria-label="Delete the note on src/a.ts:3-4"');
	});

	test("a reference whose first line is blank says so", async () => {
		const { store } = await startedStore();
		await store.selectChangedFile(file("src/a.ts"));
		// Line 2 of the sample patch is empty.
		expect(addNote(store, 1, 1, "Drop this blank line.")).toBeNull();
		expect(render(store)).toContain('<span class="review-ref-marker context"> </span><span class="review-ref-empty">empty line</span>');
	});

	test("an outdated note says so in its reference, also to a screen reader", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts"), samplePatch("src/a.ts").replace("retries = 5", "retries = 7")), mock(file("src/b.ts"))]);
		await store.prepareReview(FEATURE.id);
		const markup = render(store);
		expect(markup).toContain('aria-label="Show src/a.ts:3-4, outdated"');
		expect(markup).toContain('<span class="review-ref-tag outdated">outdated</span>');
	});

	test("a note on removed lines says so in its reference", async () => {
		const { store } = await startedStore();
		await store.selectChangedFile(file("src/a.ts"));
		expect(addNote(store, 2, 2, "Keep three.")).toBeNull();
		const markup = render(store);
		expect(markup).toContain('<span class="review-ref-name">a.ts:3</span></span><span class="review-ref-tag">removed line</span>');
		expect(markup).toContain('aria-label="Show src/a.ts:3 (removed line, numbered as before the change)"');
	});

	test("a note on more than one removed line says so in its reference", async () => {
		const { store } = await startedStore();
		await store.selectChangedFile(file("src/a.ts"));
		const view = store.getState().changes!;
		const lines = [{ kind: "removed" as const, text: "a", oldLine: 7, newLine: null }, { kind: "removed" as const, text: "b", oldLine: 8, newLine: null }];
		expect(store.addReviewNote(FEATURE.id, { comparison: view.compared!, file: view.selected!, lines, text: "Both go." })).toBeNull();
		const markup = render(store);
		expect(markup).toContain('<span class="review-ref-name">a.ts:7-8</span></span><span class="review-ref-tag">removed lines</span>');
	});

	test("choosing a reference marks it, and marks its lines in the diff for a moment", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		const [onA] = store.getState().reviews[FEATURE.id]!;
		await store.showReviewNote(FEATURE.id, onA!.id);
		let markup = render(store);
		expect(markup).toContain(`class="review-ref chosen" data-note-id="${onA!.id}" aria-current="true"`);
		expect(markup.match(/class="diff-line [a-z]+ notable shown"/g)).toEqual(['class="diff-line removed notable shown"', 'class="diff-line added notable shown"', 'class="diff-line added notable shown"']);
		// Once shown, the lines are no longer marked; the reference stays chosen.
		store.reviewNoteShown();
		markup = render(store);
		expect(markup).not.toContain(" shown\"");
		expect(markup).toContain(`class="review-ref chosen" data-note-id="${onA!.id}"`);
	});

	test("with the side panel hidden or on another view, the diff shows Review with the count, which shows the Changes view", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		store.hideChopsPanel();
		const hidden = render(store);
		expect(hidden).not.toContain('data-view="changes"');
		expect(hidden).toContain('<button type="button" class="button quiet review-toggle" aria-label="Review, 2 review notes. Show the Changes view" title="Show the review in the Changes view">Review<span class="change-group-count" aria-hidden="true">2</span></button>');
		// The button asks for the Changes view as its title bar button does: shown, on Changes.
		expect(store.toggleSidePanel("changes")).toBe(true);
		expect(store.getState().layout).toMatchObject({ chopsOpen: true, sidePanel: "changes" });
		expect(render(store)).not.toContain("review-toggle");
		// On the files, the review is out of sight too.
		store.switchSidePanel("files");
		expect(render(store)).toContain("review-toggle");
	});

	test("has no notes, no Review button, and no count without notes, and says how to leave one", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).not.toContain("tab-count");
		expect(markup).not.toContain("review-toggle");
		expect(markup).not.toContain(">Send review</button>");
		expect(markup).toContain(`<p class="review-hint">${NO_NOTES_HINT}</p>`);
	});

	test("Copy review puts the review on the clipboard, and the notes stay", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		const message = await store.prepareReview(FEATURE.id);
		expect(await store.copyReview(message!)).toBe(true);
		expect(await engine.readClipboard()).toBe(message!);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
	});

	test("the Send review dialog lists the running agents and a new one, and with none saved offers only Copy review", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		await startAgent(store, "Claude Code");
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		let markup = render(store);
		expect(markup).toContain('<span class="review-agent-name">Claude Code</span>');
		expect(markup).toContain(`<span class="review-agent-name">${describeNewReviewAgent("Claude Code")}</span>`);
		expect(markup).toContain(">Send</button>");
		// With none saved, an agent that runs is still listed, but no new one is offered.
		expect(await store.savePreferences({ agents: [] })).toMatchObject({ outcome: "saved" });
		markup = render(store);
		expect(markup).toContain('<span class="review-agent-name">Claude Code</span>');
		expect(markup).not.toContain(describeNewReviewAgent("Claude Code"));
		expect(markup).toContain(">Send</button>");
		// With none saved and none running, Copy review is the only way.
		await store.closeTerminal(sessionsOf(store.getState(), FEATURE.id)[0]!.id);
		await settle();
		store.closeDialog();
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		markup = render(store);
		expect(markup).toContain(noReviewAgent("none-saved"));
		// Copy review is the main button; it waits for the preview, which a static render does not read.
		expect(markup).toContain('<button type="button" class="button primary" disabled="">Copy review</button>');
		expect(markup).not.toContain(">Send</button>");
	});
});

/** The radio input of a choice in the Send review dialog, by the name it shows. */
function choiceInput(markup: string, name: string): string {
	const label = markup.split('<label class="review-agent">').find(part => part.includes(`<span class="review-agent-name">${name}</span>`));
	if (!label) throw new Error(`No choice ${name}`);
	return label.slice(0, label.indexOf("/>"));
}

describe("sending a review to a new agent", () => {
	test("with no agent running, the dialog picks a new one at first and shows its command before anything runs", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const markup = render(store);
		expect(choiceInput(markup, describeNewReviewAgent("Claude Code"))).toContain('checked=""');
		expect(markup).toContain(`${NEW_REVIEW_AGENT_NOTE} <code>claude</code>`);
		// Opening the dialog starts nothing.
		expect(sessionsOf(store.getState(), FEATURE.id)).toEqual([]);
		// Cancel starts and sends nothing.
		store.closeDialog();
		await settle();
		expect(sessionsOf(store.getState(), FEATURE.id)).toEqual([]);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
		expect(engine.mostOpeningAtOnce()).toBe(0);
	});

	test("Send starts the first saved agent, which shows it waits, and pastes the review once it is ready, with no Enter", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.holdNewAgents(true);
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		await settle();
		const [agent] = sessionsOf(store.getState(), FEATURE.id);
		expect(agent).toMatchObject({ kind: "agent", name: "Claude Code", prompt: { state: "pending", what: "review" } });
		// Nothing is pasted yet, and the notes stay while it waits.
		expect(engine.pastedInto(agent!.id)).toEqual([]);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().shownSessions[FEATURE.id]).toBe(agent!.id);
		expect(store.getState().toasts.map(toast => toast.text)).toContain(describeReviewAgentStarted("Claude Code"));
		expect(render(store)).toContain('<span class="session-state" role="status">Waiting to paste the review</span>');

		engine.agentReady(agent!.id);
		await settle();
		await settle();
		expect(engine.pastedInto(agent!.id)).toEqual([preview]);
		// One bracketed paste, and nothing after it: no Enter.
		expect(engine.typedInto(agent!.id)).toBe(`\x1b[200~${preview.replaceAll("\n", "\r")}\x1b[201~`);
		expect(engine.promptsSentTo(agent!.id)).toEqual([]);
		expect(store.getState().reviews[FEATURE.id]).toBeUndefined();
		expect(store.getState().toasts.map(toast => toast.text)).toContain(describeReviewSent("Claude Code"));
		expect(sessionsOf(store.getState(), FEATURE.id)[0]!.prompt).toEqual({ state: "sent", what: "review" });
	});

	test("an agent ready at once gets the review, and the notes go once", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		await settle();
		await settle();
		const [agent] = sessionsOf(store.getState(), FEATURE.id);
		expect(engine.pastedInto(agent!.id)).toEqual([preview]);
		expect(store.getState().reviews[FEATURE.id]).toBeUndefined();
		expect(store.getState().toasts.filter(toast => toast.text === describeReviewSent("Claude Code"))).toHaveLength(1);
	});

	test("a note added or changed while the agent starts stays once the review is pasted", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.holdNewAgents(true);
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		await settle();
		const [first, second] = store.getState().reviews[FEATURE.id]!;
		expect(store.editReviewNote(FEATURE.id, second!.id, "Sort these imports, please.")).toBeNull();
		expect(addNote(store, 1, 1, "And this one.")).toBeNull();
		const [agent] = sessionsOf(store.getState(), FEATURE.id);
		engine.agentReady(agent!.id);
		await settle();
		await settle();
		const left = store.getState().reviews[FEATURE.id]!;
		expect(left.map(note => note.text)).toEqual(["Sort these imports, please.", "And this one."]);
		expect(left.some(note => note.id === first!.id)).toBe(false);
	});

	test("while one agent waits to paste a review, no second one starts and nothing is pasted into it", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.holdNewAgents(true);
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		await settle();
		const [agent] = sessionsOf(store.getState(), FEATURE.id);
		expect(reviewWaiting(store.getState().terminals, FEATURE.id)?.id).toBe(agent!.id);
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBe(reviewAlreadyWaiting("Claude Code"));
		expect(await store.sendReview(FEATURE.id, agent!.id, preview)).toEqual({ outcome: "not-ready", message: PROMPT_STILL_STARTING });
		expect(sessionsOf(store.getState(), FEATURE.id)).toHaveLength(1);
		expect(engine.pastedInto(agent!.id)).toEqual([]);
		// The dialog asks, and offers no second new agent.
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const markup = render(store);
		expect(choiceInput(markup, describeNewReviewAgent("Claude Code"))).toContain('disabled=""');
		expect(markup).toContain(reviewAlreadyWaiting("Claude Code"));
		expect(choiceInput(markup, "Claude Code")).not.toContain('checked=""');
	});

	test("an agent that ends before it is ready gets nothing, and the notes stay", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.holdNewAgents(true);
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		await settle();
		const [agent] = sessionsOf(store.getState(), FEATURE.id);
		engine.endTerminal(agent!.id, 1);
		await settle();
		expect(engine.pastedInto(agent!.id)).toEqual([]);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
		expect(store.getState().toasts.map(toast => toast.text)).toContain(describeReviewNotPasted(promptEndedMessage("Claude Code", "review")));
	});

	test("an agent that does not start says why, and the notes and the dialog stay", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const preview = (await store.prepareReview(FEATURE.id))!;
		engine.failTerminals({ outcome: "not-configured", message: "No agent called \"Claude Code\" is saved." });
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBe("No agent called \"Claude Code\" is saved.");
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
		expect(store.getState().dialog).toEqual({ kind: "send-review", worktree: FEATURE.id });
	});

	test("a review pasted while the answer that started the agent was lost still drops the notes it was given", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		const open = engine.openTerminal.bind(engine);
		engine.openTerminal = async request => {
			await open(request);
			await settle();
			throw new Error("The window lost the answer");
		};
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toContain("The window lost the answer");
		const [agent] = sessionsOf(store.getState(), FEATURE.id);
		expect(engine.pastedInto(agent!.id)).toEqual([preview]);
		expect(store.getState().reviews[FEATURE.id]).toBeUndefined();
		expect(store.getState().toasts.map(toast => toast.text)).toContain(describeReviewSent("Claude Code"));
	});

	test("an agent closed before the answer that started it came does not come back, and another review agent can start", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.holdNewAgents(true);
		const open = engine.openTerminal.bind(engine);
		engine.openTerminal = async request => {
			const result = await open(request);
			if (result.outcome === "opened") {
				await settle();
				await engine.closeTerminal(result.session.id);
				await settle();
			}
			return result;
		};
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		expect(store.getState().terminals).toEqual([]);
		expect(reviewWaiting(store.getState().terminals, FEATURE.id)).toBeNull();
		engine.openTerminal = open;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		await settle();
		expect(sessionsOf(store.getState(), FEATURE.id)).toHaveLength(1);
	});

	test("Send starts the first saved agent that is found, looked for again, never a missing one ahead of it", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		// Claude Code goes missing after the app looked at start.
		engine.missingExecutables(["claude"]);
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBeNull();
		await settle();
		expect(sessionsOf(store.getState(), FEATURE.id).map(session => [session.kind, session.name])).toEqual([["agent", "Codex"]]);
	});

	test("the dialog offers the default agent, and with none found offers only Copy review, saying why", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.missingExecutables(["claude"]);
		await store.locateAgents();
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		let markup = render(store);
		expect(choiceInput(markup, describeNewReviewAgent("Codex"))).toContain('checked=""');
		expect(markup).not.toContain(describeNewReviewAgent("Claude Code"));
		engine.missingExecutables(["claude", "codex"]);
		await store.locateAgents();
		markup = render(store);
		expect(markup).toContain(noReviewAgent("none-found"));
		expect(markup).not.toContain(">Send</button>");
	});

	test("with none of the saved agents found, or none known, nothing starts and the answer says why", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		engine.missingExecutables(["claude", "codex"]);
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBe(noNewReviewAgent("none-found"));
		expect(sessionsOf(store.getState(), FEATURE.id)).toEqual([]);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
		// A look that fails after a changed command leaves the agent not known: nothing starts.
		engine.missingExecutables([]);
		engine.locateAgents = () => Promise.reject(new Error("gone"));
		expect(await store.savePreferences({ agents: [{ name: "Claude Code", command: "claude --fast" }] })).toMatchObject({ outcome: "saved" });
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toBe(noNewReviewAgent("not-known"));
		expect(sessionsOf(store.getState(), FEATURE.id)).toEqual([]);
	});

	test("with no agent saved, nothing starts", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		expect(await store.savePreferences({ agents: [] })).toMatchObject({ outcome: "saved" });
		const preview = (await store.prepareReview(FEATURE.id))!;
		expect(await store.startReviewAgent(FEATURE.id, preview, { cols: 80, rows: 24 })).toContain("No agent is saved");
		expect(sessionsOf(store.getState(), FEATURE.id)).toEqual([]);
	});
});

describe("which agent the Send review dialog picks at first", () => {
	test("the only agent running that does not wait on the person", async () => {
		const { store } = await startedStore();
		await notesOnTwoFiles(store);
		await startAgent(store, "Claude Code");
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const markup = render(store);
		expect(choiceInput(markup, "Claude Code")).toContain('checked=""');
		expect(choiceInput(markup, describeNewReviewAgent("Claude Code"))).not.toContain('checked=""');
	});

	test("nothing when the only one waits on the person, or several run, and Cancel sends nothing", async () => {
		const { engine, store } = await startedStore();
		await notesOnTwoFiles(store);
		const claude = await startAgent(store, "Claude Code");
		engine.agentStatus(claude.id, "state=blocked:kind=permission");
		await settle();
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		let markup = render(store);
		expect(choiceInput(markup, "Claude Code")).not.toContain('checked=""');
		expect(choiceInput(markup, describeNewReviewAgent("Claude Code"))).not.toContain('checked=""');
		expect(markup).toContain('class="button primary" disabled="">Send</button>');
		store.closeDialog();

		engine.agentStatus(claude.id, "state=idle");
		const codex = await startAgent(store, "Codex");
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		markup = render(store);
		for (const name of ["Claude Code", "Codex", describeNewReviewAgent("Claude Code")]) expect(choiceInput(markup, name)).not.toContain('checked=""');
		store.closeDialog();
		await settle();
		expect(engine.pastedInto(claude.id)).toEqual([]);
		expect(engine.pastedInto(codex.id)).toEqual([]);
		expect(store.getState().reviews[FEATURE.id]).toHaveLength(2);
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
		expect(runningAgents(all, "w").map(entry => entry.id)).toEqual(["a"]);
		expect(onlyAgent(runningAgents(all, "w"))).toBe("a");
		expect(onlyAgent([session("a", "w", "agent"), session("e", "w", "agent")])).toBeNull();
	});

	test("a review longer than one paste says so", () => {
		expect(reviewTooLong(100_001)).toBe("The review is 100001 characters, more than one paste can take (100000). Send it in parts, or copy it.");
	});

	test("an agent waiting on the person is said to", () => {
		expect(waitsOnPerson(session("a", "w", "agent", true, true))).toBe(true);
		expect(waitsOnPerson(session("a", "w", "agent"))).toBe(false);
	});
});

describe("the diff tab's Split layout", () => {
	test("is chosen for every worktree, saved in the layout, and drawn side by side with the edited line beside what it became", async () => {
		const { engine, store } = await startedStore();
		expect(render(store)).not.toContain("diff-split-row");
		store.chooseDiffLayout("split");
		await settle();
		expect(store.getState().layout.diffLayout).toBe("split");
		expect((await engine.loadLayout()).diffLayout).toBe("split");
		const markup = render(store);
		// Eight lines in seven rows: the removed line beside the first added one, an empty cell beside the second.
		expect(markup.match(/class="diff-split-row"/g)).toHaveLength(7);
		expect(markup.match(/class="diff-cell-empty"/g)).toHaveLength(1);
		// The changed word on each side, whether or not the code is colored yet (that depends on whether an earlier test loaded the parser).
		expect(markup).toMatch(/data-side="old"[^]*?retries[^]*?<span class="diff-word[^"]*">3<\/span>[^]*?data-side="new"[^]*?retries[^]*?<span class="diff-word[^"]*">5<\/span>/);
		expect(markup).toContain('aria-label="Add a note on removed line 3"');
		// One tab stop among the line numbers, on the first line's left side.
		expect(markup.match(/class="diff-note-target" tabindex="0"/g)).toHaveLength(1);
		expect(markup).toContain('tabindex="0" data-line="0-1-0-old"');
		store.chooseDiffLayout("unified");
		await settle();
		expect(render(store)).not.toContain("diff-split-row");
		expect((await engine.loadLayout()).diffLayout).toBe("unified");
	});

	test("starts from the saved layout, as after a restart", async () => {
		const engine = createMockEngine();
		await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [FEATURE.id], diffLayout: "split" });
		engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts"))]);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.select(FEATURE.id);
		store.showSidePanel("changes");
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(file("src/a.ts"));
		expect(render(store)).toContain("diff-split-row");
	});
});
