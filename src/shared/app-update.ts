/**
 * Updating the app itself from its GitHub releases. Pure: nothing here reads
 * a file, the network, or a process. See docs/architecture.md, "Updating the
 * app".
 */

/** Where updating the app stands. Every state is safe to show; none of them is an error dialog. */
export type AppUpdateState =
	/** This copy cannot update itself, and why: it runs from source, or it was built without an update address. */
	| { kind: "unavailable"; reason: string }
	/** Not looked yet in this run. */
	| { kind: "idle" }
	| { kind: "checking" }
	/** The newest release is the one running, as of `checkedAt` (milliseconds since the epoch). */
	| { kind: "up-to-date"; checkedAt: number }
	/** A newer release is out and is being downloaded and checked. */
	| { kind: "downloading"; version: string }
	/** A newer release is downloaded and checked, and installs when the app restarts into it. */
	| { kind: "ready"; version: string }
	/** The app is restarting into the update. */
	| { kind: "installing"; version: string }
	/**
	 * The last look or download did not work, for example offline. Nothing
	 * changed in the installed app. Said quietly, in Settings, About only.
	 */
	| { kind: "failed"; stage: "check" | "download"; message: string };

export type AppUpdateInstallResult =
	/** The app is quitting and the update installs; it starts again on its own. The answer may never arrive. */
	| { outcome: "restarting" }
	/** Sessions run, and the person has not agreed to end them. Nothing happened. */
	| { outcome: "sessions-running"; live: number }
	/** Nothing happened, and why. */
	| { outcome: "failed"; message: string };

export interface AppUpdateInstallRequest {
	/** The person agreed that the running sessions end. They open again after the restart. */
	endSessions: boolean;
}

/** What the installed app knows about itself, as Electrobun's `version.json` says it. */
export interface LocalBuild {
	channel: string;
	baseUrl: string;
}

export const UPDATES_FROM_SOURCE = "This copy runs from source, so it does not update itself. Pull and build again instead.";
export const UPDATES_WITHOUT_ADDRESS = "This build was made without an update address, so it cannot update itself.";

/** Whether this build can update itself. Null when it can; otherwise why not. */
export function updateUnavailableReason(build: LocalBuild): string | null {
	if (build.channel === "dev" || build.channel === "") return UPDATES_FROM_SOURCE;
	if (build.baseUrl.trim() === "") return UPDATES_WITHOUT_ADDRESS;
	return null;
}

/** Whether a look for an update may start now: not while one runs, a download runs, or the app restarts into one. */
export function mayCheck(state: AppUpdateState): boolean {
	return state.kind !== "unavailable" && state.kind !== "checking" && state.kind !== "downloading" && state.kind !== "installing";
}

/**
 * Electrobun's own messages start with what failed, such as "Failed to check
 * for updates: HTTP 404". Only the reason after it is kept, as a sentence.
 */
export function updateFailureReason(error: string): string {
	const reason = error.replace(/^Failed to (?:check for updates|download update):\s*/i, "").trim();
	if (reason === "") return "No reason was given.";
	const sentence = reason.charAt(0).toUpperCase() + reason.slice(1);
	return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
