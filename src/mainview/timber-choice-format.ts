/**
 * Words and the draft of Settings, Timber, Executable: which Timber the app
 * runs. Pure, so it can be tested without a window.
 */
import { type TimberChoice, isFullPath, readTimberChoice, sameTimberChoice } from "../shared/timber-choice";
import { TIMBER_PIN } from "../shared/timber-pin";
import { TIMBER_SOURCE_LABELS } from "./about-format";
import type { TimberState } from "./store/state";

export type TimberChoiceKind = TimberChoice["kind"];

export const TIMBER_CHOICE_OPTIONS: readonly { kind: TimberChoiceKind; label: string; hint: string }[] = [
	{
		kind: "bundled",
		label: "The Timber that comes with the app",
		hint: `Timber ${TIMBER_PIN.version}, the release this version of the app was tested with. Where the app ships no Timber for the platform, the timber on PATH is used instead.`,
	},
	{ kind: "path", label: "The timber on PATH", hint: "Found on the PATH the app was started with. It must be the newest Timber release." },
	{ kind: "file", label: "A Timber of my own", hint: "An executable by its full path. It must be the newest Timber release." },
];

/** What the section's fields hold: the kind picked, and the path typed, kept while another kind is picked. */
export interface TimberChoiceDraft {
	kind: TimberChoiceKind;
	path: string;
}

export function timberDraftOf(saved: TimberChoice): TimberChoiceDraft {
	return { kind: saved.kind, path: saved.kind === "file" ? saved.path : "" };
}

export interface TimberDraftModel {
	/** What Save would save, or null when the draft cannot be saved. */
	choice: TimberChoice | null;
	canSave: boolean;
	/** Why the path cannot be saved, or null. */
	error: string | null;
}

export function timberDraftModel(draft: TimberChoiceDraft, saved: TimberChoice): TimberDraftModel {
	if (draft.kind !== "file") {
		const choice: TimberChoice = { kind: draft.kind };
		return { choice, canSave: !sameTimberChoice(choice, saved), error: null };
	}
	const path = draft.path.trim();
	if (path === "") return { choice: null, canSave: false, error: null };
	const choice = readTimberChoice({ kind: "file", path });
	if (choice === undefined) {
		return { choice: null, canSave: false, error: isFullPath(path) ? "This path cannot be saved." : "Use a full path, such as /usr/local/bin/timber or C:\\Tools\\timber.exe." };
	}
	return { choice, canSave: !sameTimberChoice(choice, saved), error: null };
}

/** One line on the Timber in use now, under the choices. */
export function describeTimberInUse(timber: TimberState): string {
	if (timber === null) return "Looking for Timber.";
	if (!timber.known) return `Could not look for Timber: ${timber.message}`;
	const status = timber.status;
	const from = TIMBER_SOURCE_LABELS[status.source];
	switch (status.state) {
		case "ready":
			return `In use: Timber ${status.version}. ${from}: ${status.path}`;
		case "too-old":
			return `Not usable: Timber ${status.found} is older than the required ${status.required}. ${from}: ${status.path}`;
		case "not-found":
			return status.path === null ? "Not usable: there is no timber on PATH." : `Not usable: no Timber answered. ${from}: ${status.path}`;
	}
}
