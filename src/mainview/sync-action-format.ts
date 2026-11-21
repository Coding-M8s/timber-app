import type { Worktree } from "../shared/model";
import {
	type SyncActionKind, type SyncActionResult, type SyncTarget, applicableSyncActions, describeSyncStep, syncActionSteps, syncTargetOf,
} from "../shared/sync-actions";
import { worktreeLabel } from "./format";
import type { SubmissionOutcome } from "./store/submission";

/**
 * Words for sync actions, Pull and Push: the control on a worktree's row, its
 * menu entry, the dialog that shows the commands, and how a result is told.
 * Pure, so they can be tested without a window. What runs, and when an
 * action is offered, come from ../shared/sync-actions.ts.
 */

/** The words of one action. */
export interface SyncActionWords {
	/** On the control, the menu entry, and the dialog's button, such as "Pull". */
	label: string;
	/** Beside the progress bar while it runs. */
	running: string;
	/** Above a refusal or a failure. */
	failureTitle: string;
	/** What the dialog shows first, for the palette's hint, such as "the Git commands before they run". */
	shows: string;
	/** More words the palette finds the action by. */
	keywords: string[];
}

export const SYNC_ACTION_WORDS: Readonly<Record<SyncActionKind, SyncActionWords>> = {
	pull: { label: "Pull", running: "Pulling", failureTitle: "Could not pull", shows: "the Git commands before they run", keywords: ["git", "fast-forward", "update"] },
	push: { label: "Push", running: "Pushing", failureTitle: "Could not push", shows: "the Timber command before it runs", keywords: ["git", "publish", "upload"] },
};

const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The control on a row: the count it shows, and what it says to a pointer and to assistive technology. */
export interface SyncControl {
	action: SyncActionKind;
	/** The count beside the arrow, as the marker it replaces showed. */
	text: string;
	/** The control's name, for assistive technology. */
	label: string;
	/** The tooltip. */
	title: string;
}

/** The controls a row shows for its worktree, one per action that applies, in the order of the table. */
export function describeSyncControls(worktree: Worktree): SyncControl[] {
	const { sync } = worktree;
	if (worktree.branch === null || sync?.kind !== "tracking") return [];
	const name = worktreeLabel(worktree);
	return applicableSyncActions(sync).map(action => {
		switch (action) {
			case "pull":
				return {
					action,
					text: String(sync.behind),
					label: `Pull ${counted(sync.behind, "commit")} into ${name} from ${sync.upstream}`,
					title: `${counted(sync.behind, "commit")} to pull from ${sync.upstream}, as of the last fetch. Click to see the commands, then pull.`,
				};
			case "push":
				return {
					action,
					text: String(sync.ahead),
					label: `Push ${counted(sync.ahead, "commit")} from ${name} to ${sync.upstream}`,
					title: `${counted(sync.ahead, "commit")} to push to ${sync.upstream}. Click to see the Timber command, then push.`,
				};
		}
	});
}

/** The menu entries a worktree's sync state offers. Never one that does not apply. */
export function syncMenuEntries(worktree: Worktree): { action: SyncActionKind; label: string; title: string }[] {
	return describeSyncControls(worktree).map(control => ({ action: control.action, label: SYNC_ACTION_WORDS[control.action].label, title: control.title }));
}

/** What the dialog shows: the first command, then each that follows, with a note saying when it runs. */
export interface SyncDialogCommands {
	command: string;
	followUps: { note: string; command: string }[];
}

/** `worktree` is the worktree's registered path, which Push names. */
export function describeSyncCommands(action: SyncActionKind, target: SyncTarget, worktree: string): SyncDialogCommands {
	const [first, ...rest] = syncActionSteps(action, target, worktree).map(describeSyncStep);
	switch (action) {
		case "pull":
			return { command: first ?? "", followUps: rest.map(command => ({ note: "Then, even when the fetch fails, on the commits fetched last:", command })) };
		case "push":
			return { command: first ?? "", followUps: [] };
	}
}

/** The dialog's title, for a worktree that is in the list. */
export function describeSyncTitle(action: SyncActionKind, worktree: Worktree): string {
	return `${SYNC_ACTION_WORDS[action].label} ${worktreeLabel(worktree)}`;
}

/** What the dialog says above the commands. */
export function describeSyncIntro(action: SyncActionKind, worktree: Worktree): string[] {
	const sync = worktree.sync;
	switch (action) {
		case "pull": {
			const upstream = sync?.kind === "tracking" ? sync.upstream : "its upstream";
			const behind = sync?.kind === "tracking" ? `${counted(sync.behind, "commit")} behind ${upstream} as of the last fetch. ` : "";
			return [
				`${behind}Pull fetches ${upstream} and fast-forwards ${worktreeLabel(worktree)} to it, as git pull --ff-only does. It never makes a merge commit, never rebases, and never asks for a password.`,
				`Both commands run in ${worktree.path}.`,
			];
		}
		case "push": {
			const upstream = sync?.kind === "tracking" ? sync.upstream : "its upstream";
			const ahead = sync?.kind === "tracking" ? `${counted(sync.ahead, "commit")} ahead of ${upstream}. ` : "";
			return [
				`${ahead}Push runs timber publish, which pushes ${worktreeLabel(worktree)} to ${upstream} under its own name. It never force-pushes, never asks for a password, and refuses when ${upstream} has commits this branch does not.`,
			];
		}
	}
}

/** The note under a refusal: for a branch that diverged, the way on is Rebase. Timber's own words say why it refused a push. */
export function describeSyncRefusalNote(result: SyncActionResult): string | null {
	if (result.outcome !== "refused") return null;
	switch (result.reason) {
		case "diverged":
			return "The branch has commits its upstream does not, so it cannot be fast-forwarded. Rebase it onto its upstream instead, from Rebase in the worktree's header or the command palette. Nothing was changed.";
		case "local-changes":
			return "Commit or put away the changes Git names, then pull again. Nothing was changed, and your files are as they were.";
		case "timber-refused":
			return "Timber refused, so nothing was pushed and no branch changed.";
	}
}

/** How a result is told: a toast when it worked, Git's words in the dialog otherwise. */
export function presentSyncResult(action: SyncActionKind, label: string, upstream: string, result: SyncActionResult): SubmissionOutcome {
	if (result.outcome !== "done") return { ok: false, failure: result.failure };
	switch (action) {
		case "pull": {
			const fetched = result.fetchFailure === null
				? ""
				: ` The fetch failed, so these are the commits fetched last. Git said: ${result.fetchFailure.message}`;
			const moved = result.moved ? `Pulled ${upstream} into ${label}.` : `${label} already has every commit of ${upstream}.`;
			return { ok: true, toast: `${moved}${fetched}`, problem: result.fetchFailure !== null };
		}
		case "push":
			return { ok: true, toast: result.moved ? `Pushed ${label} to ${upstream}.` : `${upstream} already has every commit of ${label}.`, problem: false };
	}
}

/** The target a dialog shows and sends, read from the worktree as the list has it. */
export const syncTargetOfWorktree = (worktree: Worktree | null): SyncTarget | null => worktree === null ? null : syncTargetOf(worktree.sync);
