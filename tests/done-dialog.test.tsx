import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { DoneDialogView, type DoneDialogViewProps } from "../src/mainview/components/DoneDialog";
import { DONE_EXPIRED_NOTE, DONE_PRIMARY_NOTE, DONE_REMOTE_NOTE, describeBranchEffect, describeDone, describeIgnoredEffect, describeUnpublishedCommits, losesWork } from "../src/mainview/done-format";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { type DoneSessionDependencies, type DoneSessionState, canRemove, createDoneSession } from "../src/mainview/store/done-session";
import { type Schedule, createAppStore } from "../src/mainview/store/store";
import type { SubmissionState } from "../src/mainview/store/submission";
import type { SyncState, TimberFailure, TimberStatus, Worktree } from "../src/shared/model";
import {
	DEFAULT_DONE_OPTIONS, type DoneApplyRequest, type DoneApplyResult, type DoneOptions, type DonePreview, type DonePreviewRequest,
	type DonePreviewResult, readDonePreview,
} from "../src/shared/timber-done";
import { worktreeMenuChoice } from "../src/mainview/worktree-menu-format";
import { recordedDone } from "./support/timber";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const PORTABILITY = "/work/timber-worktrees/fix-macos-portability";
const SPIKE = "/work/timber-worktrees/spike-new-idea";

const sample = (path: string): Worktree => sampleRepositories.flatMap(repository => repository.worktrees).find(worktree => worktree.path === path)!;
const inSync: SyncState = { kind: "tracking", upstream: "origin/feat/clean", ahead: 0, behind: 0 };

/** The preview in a recording from Timber 0.1.1. */
function recorded(text: string): DonePreview {
	const reading = readDonePreview(text);
	if (!reading.ok) throw new Error(reading.message);
	return reading.preview;
}

/** The worktree a recorded preview is about, as the list would have it. */
const worktreeOf = (preview: DonePreview, sync: SyncState | null = inSync): Worktree => ({ ...preview.worktree, id: preview.worktree.path, sync, baseCounts: null });

const optionsOf = (preview: DonePreview): DoneOptions => ({ keepBranch: preview.options.keepBranch, keepIgnored: !preview.options.discardIgnored, base: preview.options.base });

const readySession = (preview: DonePreview, change: Partial<DoneSessionState> = {}): DoneSessionState =>
	({ options: optionsOf(preview), preview: { kind: "ready", id: "preview-1", preview, expired: false }, attempted: false, ...change });

const idle: SubmissionState = { running: false, failure: null };

function render(preview: DonePreview, change: Partial<DoneDialogViewProps> = {}): string {
	return renderToStaticMarkup(
		<DoneDialogView
			repository="sample"
			worktree={worktreeOf(preview)}
			gone={false}
			session={readySession(preview)}
			submission={idle}
			baseDraft={preview.options.base ?? ""}
			onBaseDraft={() => {}}
			onBaseCommit={() => {}}
			onOptions={() => {}}
			onRefresh={() => {}}
			onRemove={() => {}}
			onClose={() => {}}
			{...change}
		/>,
	);
}

const previews = {
	clean: recorded(recordedDone.previews.clean),
	dirty: recorded(recordedDone.previews.dirty),
	ignored: recorded(recordedDone.previews.ignored),
	keepBranch: recorded(recordedDone.previews.keepBranch),
	everyOption: recorded(recordedDone.previews.everyOption),
	detached: recorded(recordedDone.previews.detached),
	unpublished: recorded(recordedDone.previews.unpublished),
};

const REMOVE = '<button type="button" class="button danger" data-reserve="Remove\nRunning">Remove</button>';
const REMOVE_DISABLED = '<button type="button" class="button danger" data-reserve="Remove\nRunning" disabled="">Remove</button>';

describe("the Done dialog, for a clean worktree", () => {
	const markup = render(previews.clean);

	test("is a plain confirmation that names the exact target", () => {
		expect(markup).toContain('class="dialog-title">Remove feat/clean?</h2>');
		expect(markup).not.toContain("Delete anyway?");
		expect(markup).toContain('<span class="path">/work/sample-worktrees/feat-clean</span>');
		expect(markup).toContain("Branch feat/clean in sample");
		expect(markup).toContain("No modified or untracked files.");
		expect(markup).not.toContain("done-files");
	});

	test("says what happens to the local branch, to ignored files, and that remotes are not touched", () => {
		expect(markup).toContain("The local branch feat/clean is deleted.");
		expect(markup).toContain("No ignored files were found. Removing covers every ignored file in the folder, including ones that scripts run before deletion create or change.");
		expect(markup).toContain(DONE_REMOTE_NOTE);
		expect(DONE_REMOTE_NOTE).toContain("Nothing on a remote is touched");
	});

	test("shows both Timber commands: the preview that ran and the removal that Remove runs", () => {
		expect(markup).toContain('<pre class="dialog-command" aria-label="Preview command">timber __ide-done preview -- /work/sample-worktrees/feat-clean</pre>');
		expect(markup).toContain('<pre class="dialog-command" aria-label="Command that will run">timber __ide-done apply --approval-file &lt;approved preview&gt; --result-file &lt;temporary file&gt; -- /work/sample-worktrees/feat-clean</pre>');
	});

	test("has one Remove button, which is not where focus starts and which Enter in a field cannot press", () => {
		expect(markup).toContain(REMOVE);
		expect(markup.match(/>Remove</g)?.length).toBe(1);
		// Focus starts on the button that changes nothing.
		expect(markup).toContain('<button type="button" class="button quiet" autofocus="">Cancel</button>');
		expect(markup.match(/autofocus/g)?.length).toBe(1);
		// A form with no submit button has nothing for Enter to press, and the form itself ignores being submitted.
		expect(markup).not.toContain('type="submit"');
	});

	test("says until when Timber accepts the preview", () => {
		expect(markup).toContain("Timber accepts this preview until ");
	});
});

describe("the Done dialog, for a worktree with content that would be lost", () => {
	const markup = render(previews.dirty);

	test("asks Delete anyway? and keeps as the default", () => {
		expect(markup).toContain('class="dialog-title">Delete anyway?</h2>');
		expect(markup).toContain('<button type="button" class="button quiet" autofocus="">Keep</button>');
		expect(markup).toContain(REMOVE);
		expect(markup).not.toContain('type="submit"');
		expect(markup).toContain('<span class="path">/work/sample-worktrees/feat-dirty</span>');
	});

	test("lists every modified and untracked file of the preview, which are the files git status shows", () => {
		expect(markup).toContain("These files exist only in this folder and are deleted with it:");
		expect(markup).toContain('<p class="done-files-title modified">Modified (3)</p>');
		expect(markup).toContain('<p class="done-files-title untracked">Untracked (2)</p>');
		for (const file of ["new name.txt", "staged.txt", "tracked.txt", "notes zażółć.txt", "src/deep/new.ts"]) expect(markup).toContain(`<li>${file}</li>`);
	});

	test("summarizes ignored content and how far removal reaches", () => {
		expect(markup).toContain("2 ignored paths are deleted with the folder. Removing covers every ignored file in the folder");
		expect(markup).not.toContain('aria-label="Ignored files"');
		expect(markup).not.toContain("build/app.js");
		expect(markup).not.toContain("debug.log");
	});

	test("file names are shown as text, never as markup", () => {
		const hostile = structuredClone(previews.dirty);
		if (hostile.worktree.changes.kind === "known") hostile.worktree.changes.untracked = ["<img src=x onerror=alert(1)>"];
		const shown = render(hostile);
		expect(shown).not.toContain("<img");
		expect(shown).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});
});

describe("the Done dialog, for what the list knows about commits", () => {
	test("a branch that was never published gets Delete anyway? with the reason", () => {
		const markup = render(previews.unpublished, { worktree: worktreeOf(previews.unpublished, { kind: "unpublished" }) });
		expect(markup).toContain("Delete anyway?");
		expect(markup).toContain('<p class="done-warning">feat/unpublished was never published. Commits that are only on this branch are deleted with it.</p>');
		expect(markup).toContain(">Keep</button>");
	});

	test("commits to push, and a deleted upstream, are said as well", () => {
		expect(describeUnpublishedCommits(previews.clean, { kind: "tracking", upstream: "origin/feat/clean", ahead: 1, behind: 4 }))
			.toBe("1 commit is not on origin/feat/clean as of the last fetch. Commits that are only on this branch are deleted with it.");
		expect(describeUnpublishedCommits(previews.clean, { kind: "tracking", upstream: "origin/feat/clean", ahead: 3, behind: 0 })).toContain("3 commits are not on origin/feat/clean");
		expect(describeUnpublishedCommits(previews.clean, { kind: "gone", upstream: "origin/feat/clean" })).toContain("Its upstream origin/feat/clean was deleted.");
	});

	test("nothing is said when the branch is in step, is kept, or does not exist", () => {
		expect(describeUnpublishedCommits(previews.clean, inSync)).toBeNull();
		expect(describeUnpublishedCommits(previews.clean, { kind: "tracking", upstream: "origin/feat/clean", ahead: 0, behind: 2 })).toBeNull();
		expect(describeUnpublishedCommits(previews.clean, null)).toBeNull();
		expect(describeUnpublishedCommits(previews.keepBranch, { kind: "unpublished" })).toBeNull();
		expect(describeUnpublishedCommits(previews.detached, { kind: "unpublished" })).toBeNull();
		expect(losesWork(previews.keepBranch, { kind: "unpublished" })).toBe(false);
		expect(losesWork(previews.clean, { kind: "unpublished" })).toBe(true);
		expect(losesWork(previews.dirty, inSync)).toBe(true);
		// Ignored files alone are part of the plain summary.
		expect(losesWork(previews.ignored, inSync)).toBe(false);
	});
});

describe("the Done dialog, for the options", () => {
	test("keep branch: the branch is kept, and the preview command has the flag", () => {
		const markup = render(previews.keepBranch);
		expect(markup).toContain("The local branch feat/clean is kept.");
		expect(markup).toContain("timber __ide-done preview --keep-branch -- /work/sample-worktrees/feat-clean");
		expect(markup).toContain('<input type="checkbox" checked=""/><span>Keep the local branch</span>');
		expect(describeDone("feat/clean", previews.keepBranch)).toBe("Removed the worktree of feat/clean and kept the branch");
		expect(describeDone("feat/clean", previews.clean)).toBe("Removed feat/clean");
	});

	test("every option: all three flags, and what keeping ignored files means", () => {
		const markup = render(previews.everyOption);
		expect(markup).toContain("timber __ide-done preview --keep-branch --keep-ignored --base=main -- /work/sample-worktrees/feat-clean");
		expect(markup).toContain(describeIgnoredEffect(previews.everyOption));
		expect(describeIgnoredEffect(previews.everyOption)).toContain("If any appear before the removal, Timber refuses it.");
		expect(markup).toContain('value="main"');
		expect(markup).toContain(REMOVE);
	});

	test("a detached HEAD has no branch to delete", () => {
		const markup = render(previews.detached);
		expect(markup).toContain("No local branch is deleted: the worktree is on a detached HEAD at 55b4839.");
		expect(markup).toContain('class="dialog-title">Remove detached at 55b4839?</h2>');
		expect(describeBranchEffect(previews.detached)).not.toContain("is deleted.");
	});

	test("Remove is off while the preview on screen is for other options than the ones on screen", () => {
		for (const options of [{ ...DEFAULT_DONE_OPTIONS, keepBranch: true }, { ...DEFAULT_DONE_OPTIONS, keepIgnored: true }, { ...DEFAULT_DONE_OPTIONS, base: "main" }]) {
			const session = readySession(previews.clean, { options });
			expect(canRemove(session)).toBe(false);
			expect(render(previews.clean, { session, baseDraft: options.base ?? "" })).toContain(REMOVE_DISABLED);
		}
	});

	test("Remove is off while the base field holds a base that has not been previewed", () => {
		const markup = render(previews.clean, { baseDraft: "release" });
		expect(markup).toContain(REMOVE_DISABLED);
		expect(markup).toContain("Press Enter to preview with this base. Remove waits for that preview.");
		// Space around the base does not count as another base.
		expect(render(previews.everyOption, { baseDraft: " main " })).toContain(REMOVE);
	});
});

describe("the Done dialog, while there is no preview to approve", () => {
	test("while Timber is being asked: nothing to approve, and it says that asking removes nothing", () => {
		const markup = render(previews.clean, { session: { options: DEFAULT_DONE_OPTIONS, preview: { kind: "loading" }, attempted: false } });
		expect(markup).toContain(REMOVE_DISABLED);
		expect(markup).toContain('role="status">Asking Timber what would be removed. Nothing is removed by asking.</p>');
		expect(markup).toContain("timber __ide-done preview -- /work/sample-worktrees/feat-clean");
		expect(markup).not.toContain("Preview again");
		expect(markup).toContain('autofocus="">Cancel</button>');
	});

	test("when Timber refuses the preview: its diagnostic, and no way to remove", () => {
		const failure: TimberFailure = { command: "timber __ide-done preview -- /work/sample", diagnostic: "Select an existing linked worktree; the primary worktree cannot be removed.", output: null };
		const markup = render(previews.clean, { session: { options: DEFAULT_DONE_OPTIONS, preview: { kind: "failed", failure }, attempted: false } });
		expect(markup).toContain(REMOVE_DISABLED);
		expect(markup).toContain('<p class="failure-title">Timber gave no preview, so nothing can be removed</p>');
		expect(markup).toContain("the primary worktree cannot be removed.");
		expect(markup).toContain(">Preview again</button>");
		expect(markup).not.toContain("done-files");
	});

	test("an expired preview cannot be submitted and its content is taken off the screen", () => {
		const session = readySession(previews.dirty);
		const expired: DoneSessionState = { ...session, preview: { ...session.preview, expired: true } as DoneSessionState["preview"] };
		expect(canRemove(expired)).toBe(false);
		const markup = render(previews.dirty, { session: expired });
		expect(markup).toContain(REMOVE_DISABLED);
		expect(markup).toContain(`<p class="done-warning" role="alert">${DONE_EXPIRED_NOTE}</p>`);
		expect(markup).toContain(">Preview again</button>");
		expect(markup).not.toContain("done-files");
		expect(markup).not.toContain("Delete anyway?");
	});
});

describe("the Done dialog, while and after the removal", () => {
	test("while Timber runs: the fields are disabled, progress shows, and nothing can be pressed again", () => {
		const markup = render(previews.dirty, { submission: { running: true, failure: null } });
		expect(markup).toContain('<fieldset class="dialog-fields" disabled="">');
		expect(markup).toContain('<button type="button" class="button danger" data-reserve="Remove\nRunning" disabled="">Running</button>');
		expect(markup).toContain('role="progressbar" aria-label="Removing feat/dirty"');
	});

	test("when Timber refuses a changed worktree: its diagnostic, a new preview, and no second try by itself", () => {
		const failure: TimberFailure = {
			command: "timber __ide-done apply --approval-file <approved preview> --result-file <temporary file> -- /work/sample-worktrees/feat-dirty",
			diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing.",
			output: { text: "error: Worktree, files, settings or repository changed. Review the updated preview before removing.\n", truncated: false },
		};
		const markup = render(previews.dirty, { session: readySession(previews.dirty, { attempted: true }), submission: { running: false, failure } });
		expect(markup).toContain('<p class="failure-title">Timber did not finish removing feat/dirty</p>');
		expect(markup).toContain(`<p class="failure-diagnostic">${failure.diagnostic}</p>`);
		expect(markup).toContain("The list was read again and shows the real state. Nothing is tried again by itself: the preview above is a new one, so review it before removing.");
		// The new preview can be approved, by pressing Remove again.
		expect(markup).toContain(REMOVE);
		expect(markup).toContain("<li>tracked.txt</li>");
	});

	test("a partial failure: Timber's own words, and that the list now shows the real state", () => {
		const partial = JSON.parse(recordedDone.results.partial) as { diagnostic: string };
		const failure: TimberFailure = { command: "timber __ide-done apply", diagnostic: partial.diagnostic, output: null };
		const markup = render(previews.clean, {
			gone: true,
			session: { options: DEFAULT_DONE_OPTIONS, preview: { kind: "failed", failure: { command: null, diagnostic: "The worktree is no longer in the list, so there is nothing to preview.", output: null } }, attempted: true },
			submission: { running: false, failure },
		});
		expect(markup).toContain('class="dialog-title">feat/clean is no longer in the list</h2>');
		expect(markup).toContain("The worktree was removed from /work/sample-worktrees/feat-partial, but local branch partial/branch was not deleted");
		expect(markup).toContain("The list was read again and no longer has this worktree. What is left of it, such as its branch, is what the list and Git show now.");
		expect(markup).toContain(REMOVE_DISABLED);
		expect(markup).toContain('autofocus="">Close</button>');
	});

	test("a worktree that left the list while the dialog was open can only be closed", () => {
		const markup = render(previews.dirty, { gone: true });
		expect(markup).toContain('class="dialog-title">feat/dirty is no longer in the list</h2>');
		expect(markup).toContain("This worktree left the list while the dialog was open, so there is nothing to remove here any more.");
		expect(markup).toContain(REMOVE_DISABLED);
		expect(markup).toContain('autofocus="">Close</button>');
		// No options, no file list, and no preview to approve.
		expect(markup).not.toContain("checkbox");
		expect(markup).not.toContain("done-files");
		expect(markup).not.toContain("Preview again");
	});
});

/** A clock the test moves by hand, in place of real timers. */
function manualClock(start: number) {
	let now = start;
	let waiting: { at: number; task: () => void }[] = [];
	const schedule: Schedule = (task, milliseconds) => {
		const entry = { at: now + milliseconds, task };
		waiting.push(entry);
		return () => {
			waiting = waiting.filter(candidate => candidate !== entry);
		};
	};
	return {
		schedule,
		now: () => now,
		waiting: () => waiting.length,
		/** Move the time without running the timers, as when a computer sleeps. */
		jump(milliseconds: number) {
			now += milliseconds;
		},
		advance(milliseconds: number) {
			now += milliseconds;
			const due = waiting.filter(entry => entry.at <= now);
			waiting = waiting.filter(entry => entry.at > now);
			for (const entry of due) entry.task();
		},
	};
}

/** A session whose engine answers only when the test says so, in whatever order it likes. */
function manualSession(listed: () => boolean = () => true) {
	const clock = manualClock(1_000_000);
	const asked: { request: DonePreviewRequest; resolve: (result: DonePreviewResult) => void; reject: (error: Error) => void }[] = [];
	const applied: { request: DoneApplyRequest; resolve: (result: DoneApplyResult) => void; reject: (error: Error) => void }[] = [];
	const dependencies: DoneSessionDependencies = {
		repository: "/work/sample",
		path: "/work/sample-worktrees/feat-clean",
		preview: request => new Promise((resolve, reject) => {
			asked.push({ request, resolve, reject });
		}),
		apply: request => new Promise((resolve, reject) => {
			applied.push({ request, resolve, reject });
		}),
		listed,
		schedule: clock.schedule,
		now: clock.now,
	};
	const session = createDoneSession(dependencies);
	/** A preview for these options that expires in ten minutes. */
	const answer = (id: string, options: DoneOptions = DEFAULT_DONE_OPTIONS): DonePreviewResult => ({
		outcome: "previewed",
		id,
		preview: { ...previews.clean, expiresAt: clock.now() + 600_000, options: { keepBranch: options.keepBranch, discardIgnored: !options.keepIgnored, base: options.base } },
	});
	return { session, asked, applied, clock, answer };
}

const kept = { ...DEFAULT_DONE_OPTIONS, keepBranch: true };
const failure: TimberFailure = { command: "timber __ide-done apply", diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing.", output: null };

describe("createDoneSession", () => {
	test("opening asks for one preview with the default options, and removes nothing", async () => {
		const { session, asked, applied, answer } = manualSession();
		expect(session.getState()).toEqual({ options: DEFAULT_DONE_OPTIONS, preview: { kind: "loading" }, attempted: false });
		expect(asked.length).toBe(0);
		session.start();
		expect(asked.map(entry => entry.request)).toEqual([{ repository: "/work/sample", path: "/work/sample-worktrees/feat-clean", options: DEFAULT_DONE_OPTIONS }]);
		expect(canRemove(session.getState())).toBe(false);
		asked[0]!.resolve(answer("first"));
		await settle();
		expect(session.getState().preview).toMatchObject({ kind: "ready", id: "first", expired: false });
		expect(canRemove(session.getState())).toBe(true);
		expect(applied.length).toBe(0);
	});

	test("changing an option takes the old preview off the screen at once and asks for a new one", async () => {
		const { session, asked, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		session.setOptions(kept);
		expect(session.getState()).toEqual({ options: kept, preview: { kind: "loading" }, attempted: false });
		expect(canRemove(session.getState())).toBe(false);
		expect(asked[1]!.request.options).toEqual(kept);
		asked[1]!.resolve(answer("second", kept));
		await settle();
		expect(session.getState().preview).toMatchObject({ kind: "ready", id: "second", preview: { options: { keepBranch: true } } });
	});

	test("an older preview that answers late never replaces a newer one", async () => {
		const { session, asked, applied, answer } = manualSession();
		session.start();
		session.setOptions(kept);
		session.setOptions(DEFAULT_DONE_OPTIONS);
		session.setOptions({ ...kept, base: "main" });
		expect(asked.length).toBe(4);
		// The newest answers first, then the older ones, in a mixed order.
		asked[3]!.resolve(answer("fourth", { ...kept, base: "main" }));
		await settle();
		asked[1]!.resolve(answer("second", kept));
		asked[0]!.resolve(answer("first"));
		asked[2]!.reject(new Error("too late to matter"));
		await settle();
		expect(session.getState().preview).toMatchObject({ kind: "ready", id: "fourth" });
		expect(session.getState().options).toEqual({ ...kept, base: "main" });

		const removing = session.remove();
		expect(applied.map(entry => entry.request.preview)).toEqual(["fourth"]);
		applied[0]!.resolve({ outcome: "removed" });
		expect(await removing).toEqual({ outcome: "removed" });
	});

	test("while the newest preview is still on its way, an older answer is not shown and cannot be approved", async () => {
		const { session, asked, applied, answer } = manualSession();
		session.start();
		session.setOptions(kept);
		asked[0]!.resolve(answer("first"));
		await settle();
		expect(session.getState().preview).toEqual({ kind: "loading" });
		expect(await session.remove()).toBeNull();
		expect(applied.length).toBe(0);
	});

	test("a preview for other options than the ones asked for is not one to approve", async () => {
		const { session, asked, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("wrong", kept));
		await settle();
		expect(session.getState().preview).toMatchObject({ kind: "failed", failure: { diagnostic: "The preview that arrived is for other options than the ones on screen. It was not used." } });
		expect(canRemove(session.getState())).toBe(false);
	});

	test("a preview that fails, or an engine that throws, leaves nothing to approve", async () => {
		const { session, asked, applied } = manualSession();
		session.start();
		asked[0]!.resolve({ outcome: "failed", failure });
		await settle();
		expect(session.getState().preview).toEqual({ kind: "failed", failure });
		session.refresh();
		asked[1]!.reject(new Error("The request timed out"));
		await settle();
		expect(session.getState().preview).toEqual({ kind: "failed", failure: { command: null, diagnostic: "The request timed out", output: null } });
		expect(await session.remove()).toBeNull();
		expect(applied.length).toBe(0);
	});

	test("a preview expires at its time, and an expired one is never submitted", async () => {
		const { session, asked, applied, clock, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		clock.advance(599_999);
		expect(canRemove(session.getState())).toBe(true);
		clock.advance(1);
		expect(session.getState().preview).toMatchObject({ kind: "ready", id: "first", expired: true });
		expect(canRemove(session.getState())).toBe(false);
		expect(await session.remove()).toBeNull();
		expect(applied.length).toBe(0);
		// Nothing is asked again by itself. A new preview is the person's request.
		expect(asked.length).toBe(1);
		session.refresh();
		asked[1]!.resolve(answer("second"));
		await settle();
		expect(canRemove(session.getState())).toBe(true);
	});

	test("an expired preview is not submitted even when the timer is late", async () => {
		const { session, asked, applied, clock, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		clock.jump(600_000);
		expect(canRemove(session.getState())).toBe(true);
		expect(await session.remove()).toBeNull();
		expect(applied.length).toBe(0);
		expect(session.getState().preview).toMatchObject({ kind: "ready", expired: true });
	});

	test("a preview that arrives already expired cannot be approved", async () => {
		const { session, asked, clock, answer } = manualSession();
		session.start();
		const late = answer("late");
		clock.jump(600_000);
		asked[0]!.resolve(late);
		await settle();
		expect(session.getState().preview).toMatchObject({ kind: "ready", expired: true });
		expect(clock.waiting()).toBe(0);
	});

	test("Remove approves the preview on screen, once", async () => {
		const { session, asked, applied, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		const removing = session.remove();
		expect(applied.map(entry => entry.request)).toEqual([{ repository: "/work/sample", path: "/work/sample-worktrees/feat-clean", preview: "first" }]);
		// A second press while the first runs asks for nothing, and neither does a change of options.
		expect(await session.remove()).toBeNull();
		session.setOptions(kept);
		session.refresh();
		expect([applied.length, asked.length]).toEqual([1, 1]);
		applied[0]!.resolve({ outcome: "removed" });
		expect(await removing).toEqual({ outcome: "removed" });
		expect([applied.length, asked.length]).toEqual([1, 1]);
	});

	test("when the removal is refused, a new preview is asked for and the removal is never tried again by itself", async () => {
		const { session, asked, applied, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		const removing = session.remove();
		applied[0]!.resolve({ outcome: "failed", ran: true, failure });
		expect(await removing).toEqual({ outcome: "failed", ran: true, failure });
		expect(session.getState()).toMatchObject({ preview: { kind: "loading" }, attempted: true });
		expect(asked.length).toBe(2);
		asked[1]!.resolve(answer("second"));
		await settle();
		expect(session.getState().preview).toMatchObject({ kind: "ready", id: "second" });
		expect(applied.length).toBe(1);

		// Only another press of Remove approves the new preview.
		const again = session.remove();
		expect(applied.map(entry => entry.request.preview)).toEqual(["first", "second"]);
		applied[1]!.resolve({ outcome: "removed" });
		await again;
	});

	test("when the removal failed and the worktree left the list, no preview is asked for", async () => {
		let listed = true;
		const { session, asked, applied, answer } = manualSession(() => listed);
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		const removing = session.remove();
		listed = false;
		applied[0]!.resolve({ outcome: "failed", ran: true, failure });
		await removing;
		expect(asked.length).toBe(1);
		expect(session.getState()).toMatchObject({ attempted: true, preview: { kind: "failed" } });
		expect(await session.remove()).toBeNull();
		expect(applied.length).toBe(1);
	});

	test("a removal that throws is a failure of unknown extent, followed by a new preview", async () => {
		const { session, asked, applied, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		const removing = session.remove();
		applied[0]!.reject(new Error("The window lost its connection"));
		expect(await removing).toEqual({
			outcome: "failed",
			ran: true,
			failure: { command: null, diagnostic: "The removal did not answer, so what it did is unknown: The window lost its connection", output: null },
		});
		expect([asked.length, applied.length]).toEqual([2, 1]);
	});

	test("after the dialog closed, answers are dropped and no timer is left", async () => {
		const { session, asked, clock, answer } = manualSession();
		session.start();
		asked[0]!.resolve(answer("first"));
		await settle();
		expect(clock.waiting()).toBe(1);
		session.refresh();
		session.stop();
		expect(clock.waiting()).toBe(0);
		asked[1]!.resolve(answer("second"));
		await settle();
		expect(session.getState().preview).toEqual({ kind: "loading" });
	});
});

describe("the mock engine acts out the removal", () => {
	const request = (path: string, options: Partial<DoneOptions> = {}) => ({ repository: TIMBER, path, options: { ...DEFAULT_DONE_OPTIONS, ...options } });
	const paths = async (engine: ReturnType<typeof createMockEngine>) => (await engine.loadRepository(TIMBER))!.worktrees.map(worktree => worktree.path);

	/** The name of a preview that must have worked. */
	async function previewed(engine: ReturnType<typeof createMockEngine>, path: string, options: Partial<DoneOptions> = {}) {
		const result = await engine.previewDone(request(path, options));
		if (result.outcome !== "previewed") throw new Error(result.failure.diagnostic);
		return result;
	}

	test("the preview lists the files of the worktree, and removes nothing", async () => {
		const engine = createMockEngine();
		const { preview } = await previewed(engine, FEATURE);
		expect(preview.worktree.changes).toEqual(sample(FEATURE).changes);
		expect(preview.ignored).toEqual([".env.local", "dist/"]);
		expect(preview.options).toEqual({ keepBranch: false, discardIgnored: true, base: null });
		expect(await paths(engine)).toContain(FEATURE);
	});

	test("Remove takes the worktree off the list", async () => {
		const engine = createMockEngine();
		const { id } = await previewed(engine, FEATURE);
		expect(await engine.applyDone({ repository: TIMBER, path: FEATURE, preview: id })).toEqual({ outcome: "removed" });
		expect(await paths(engine)).not.toContain(FEATURE);
		expect(await engine.applyDone({ repository: TIMBER, path: FEATURE, preview: id })).toMatchObject({ outcome: "failed", ran: false });
	});

	test("the primary checkout, a locked worktree, and keep ignored files while some exist are refused in Timber's words", async () => {
		const engine = createMockEngine();
		expect(await engine.previewDone(request(TIMBER))).toMatchObject({ outcome: "failed", failure: { diagnostic: recordedDone.refusals.primary.trim().replace("error: ", "") } });
		expect(await engine.previewDone(request(FEATURE, { keepIgnored: true }))).toMatchObject({ outcome: "failed", failure: { diagnostic: recordedDone.refusals["keep-ignored"].trim().replace("error: ", "") } });
		expect(await engine.previewDone(request(FEATURE, { base: "no-such-branch" }))).toMatchObject({ outcome: "failed", failure: { diagnostic: recordedDone.refusals["missing-base"].trim().replace("error: ", "") } });
		expect(await engine.previewDone(request("/work/elsewhere"))).toMatchObject({ outcome: "failed", failure: { command: null } });
		expect(await engine.previewDone({ ...request(FEATURE), repository: "/work/unknown" })).toMatchObject({ outcome: "failed", failure: { command: null } });
	});

	test("setChanges acts out a dirty worktree, and a change between preview and Remove", async () => {
		const engine = createMockEngine();
		engine.setChanges(PORTABILITY, { modified: ["src/a.ts"], untracked: ["notes.md"], ignored: ["node_modules/"] });
		const { id, preview } = await previewed(engine, PORTABILITY);
		expect(preview.worktree.changes).toEqual({ kind: "known", modified: ["src/a.ts"], untracked: ["notes.md"] });
		expect(preview.ignored).toEqual(["node_modules/"]);

		engine.setChanges(PORTABILITY, { untracked: ["notes.md", "late.txt"] });
		expect(await engine.applyDone({ repository: TIMBER, path: PORTABILITY, preview: id })).toMatchObject({
			outcome: "failed",
			ran: true,
			failure: { diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing." },
		});
		expect(await paths(engine)).toContain(PORTABILITY);
		expect((await previewed(engine, PORTABILITY)).preview.worktree.changes).toMatchObject({ untracked: ["notes.md", "late.txt"] });
	});

	test("expirePreviewsAfter acts out an expired preview", async () => {
		const engine = createMockEngine();
		engine.expirePreviewsAfter(0);
		const { id, preview } = await previewed(engine, SPIKE);
		expect(preview.expiresAt).toBeLessThanOrEqual(Date.now());
		expect(await engine.applyDone({ repository: TIMBER, path: SPIKE, preview: id })).toMatchObject({ outcome: "failed", ran: false, failure: { diagnostic: "The preview expired. Nothing was run. Ask for a new preview." } });
		expect(await paths(engine)).toContain(SPIKE);
		engine.expirePreviewsAfter(null);
		expect((await previewed(engine, SPIKE)).preview.expiresAt).toBeGreaterThan(Date.now() + 500_000);
	});

	test("failBranchDeletion acts out a partial failure: the worktree leaves the list and the removal fails", async () => {
		const engine = createMockEngine();
		engine.failBranchDeletion(true);
		const { id } = await previewed(engine, SPIKE);
		const result = await engine.applyDone({ repository: TIMBER, path: SPIKE, preview: id });
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		expect(result.outcome === "failed" && result.failure.diagnostic).toContain(`The worktree was removed from ${SPIKE}, but local branch spike/new-idea was not deleted`);
		expect(await paths(engine)).not.toContain(SPIKE);

		// With the branch kept there is no branch to fail on.
		const kept = await previewed(engine, PORTABILITY, { keepBranch: true });
		expect(await engine.applyDone({ repository: TIMBER, path: PORTABILITY, preview: kept.id })).toEqual({ outcome: "removed" });
	});

	test("nothing is offered while Timber is not ready", async () => {
		const engine = createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]);
		expect(await engine.previewDone(request(FEATURE))).toMatchObject({ outcome: "failed", failure: { command: null } });
	});
});

describe("from the Done button to the list", () => {
	async function startedStore(timber: TimberStatus = sampleTimberStatuses.ready) {
		const engine = createMockEngine(sampleRepositories, timber);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		return { store, engine };
	}

	const sessionOn = (store: Awaited<ReturnType<typeof startedStore>>["store"], path: string) => createDoneSession({
		repository: TIMBER,
		path,
		preview: store.previewDone,
		apply: store.applyDone,
		listed: () => store.getState().repositories.some(repository => repository.worktrees.some(worktree => worktree.path === path)),
	});
	const listedPaths = (store: Awaited<ReturnType<typeof startedStore>>["store"]) => store.getState().repositories.flatMap(repository => repository.worktrees.map(worktree => worktree.path));

	test("the workspace offers Done for a linked worktree, and not for the primary checkout", async () => {
		const { store } = await startedStore();
		const primary = renderToStaticMarkup(<App store={store} />);
		// A quiet label after the name says what it is; Done in the More menu is off with DONE_PRIMARY_NOTE (tests/workspace-actions.test.ts).
		expect(primary).toContain('<span class="workspace-kind">Primary checkout</span>');
		expect(primary).toContain('aria-label="More for main"');
		expect(primary).not.toContain(">Done</button>");
		expect(DONE_PRIMARY_NOTE).toBe("The primary checkout is never removed.");

		store.select(sample(FEATURE).id);
		const linked = renderToStaticMarkup(<App store={store} />);
		expect(linked).toContain('aria-label="More for feat/github-issue-lookup"');
		expect(linked).not.toContain("workspace-kind");
		// No dialog until Done is pressed.
		expect(linked).not.toContain("<dialog");
	});

	test("an open dialog shows the target and both commands before any answer, with nothing to approve yet", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("<dialog");
		expect(markup).toContain(`<span class="path">${FEATURE}</span>`);
		expect(markup).toContain(`timber __ide-done preview -- ${FEATURE}`);
		expect(markup).toContain(`timber __ide-done apply --approval-file &lt;approved preview&gt; --result-file &lt;temporary file&gt; -- ${FEATURE}`);
		expect(markup).toContain(REMOVE_DISABLED);
		expect(markup).toContain("Asking Timber what would be removed.");
		expect(store.getState().repositories.flatMap(repository => repository.worktrees).length).toBe(7);

		store.closeDialog();
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("<dialog");
	});

	test("Done in a row's menu opens the dialog for that row's worktree while another is selected, and keeps the selection", async () => {
		const { store } = await startedStore();
		const selected = store.getState().selection?.worktree;
		expect(selected).not.toBe(sample(FEATURE).id);
		const request = worktreeMenuChoice(TIMBER, sample(FEATURE), "done");
		expect(request).toEqual({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		store.openDialog(request!);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("<dialog");
		expect(markup).toContain(`timber __ide-done preview -- ${FEATURE}`);
		expect(store.getState().selection?.worktree).toBe(selected);
	});

	test("no dialog is shown while Timber is not ready", async () => {
		const { store } = await startedStore(sampleTimberStatuses["too-old"]);
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("<dialog");
	});

	test("a dialog for a worktree that is not in the list shows nothing", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: "no-such-worktree" });
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("<dialog");
	});

	test("nothing is removed until Remove, and after it the worktree is gone from the list", async () => {
		const { store } = await startedStore();
		const session = sessionOn(store, FEATURE);
		session.start();
		await settle();
		const shown = session.getState().preview;
		expect(shown.kind === "ready" && shown.preview.worktree.changes).toEqual(sample(FEATURE).changes);
		session.setOptions({ ...DEFAULT_DONE_OPTIONS, keepBranch: true });
		await settle();
		session.refresh();
		await settle();
		expect(listedPaths(store)).toContain(FEATURE);

		expect(await session.remove()).toEqual({ outcome: "removed" });
		expect(listedPaths(store)).not.toContain(FEATURE);
		session.stop();
	});

	test("a change between the preview and Remove is refused, nothing is removed, and the new preview shows the change", async () => {
		const { store, engine } = await startedStore();
		const session = sessionOn(store, FEATURE);
		session.start();
		await settle();
		engine.setChanges(FEATURE, { untracked: ["late.txt"] });

		const result = await session.remove();
		expect(result).toMatchObject({ outcome: "failed", ran: true, failure: { diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing." } });
		expect(listedPaths(store)).toContain(FEATURE);
		await settle();
		const fresh = session.getState();
		expect(fresh.attempted).toBe(true);
		expect(fresh.preview).toMatchObject({ kind: "ready", preview: { worktree: { changes: { untracked: ["late.txt"] } } } });
		// The list was read again as well, so the row shows the new file.
		expect(store.getState().repositories.flatMap(repository => repository.worktrees).find(worktree => worktree.path === FEATURE)?.changes).toMatchObject({ untracked: ["late.txt"] });
		session.stop();
	});

	test("a partial failure is reported, the list shows the real state, and nothing is asked again", async () => {
		const { store, engine } = await startedStore();
		store.select(sample(SPIKE).id);
		engine.failBranchDeletion(true);
		const session = sessionOn(store, SPIKE);
		session.start();
		await settle();

		const result = await session.remove();
		expect(result?.outcome === "failed" && result.failure.diagnostic).toContain("but local branch spike/new-idea was not deleted");
		expect(listedPaths(store)).not.toContain(SPIKE);
		// The selection moved on to the primary checkout, and no toast claims success.
		expect(store.getState().selection?.worktree).toBe(sample(TIMBER).id);
		expect(store.getState().toasts).toEqual([]);
		expect(session.getState()).toMatchObject({ attempted: true, preview: { kind: "failed" } });
		expect(await session.remove()).toBeNull();
		session.stop();
	});
});
