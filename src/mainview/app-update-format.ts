import type { AppUpdateInstallResult, AppUpdateState } from "../shared/app-update";
import { describeEndingTerminals } from "./terminal-format";

/**
 * What the window says about updating the app. Pure, so it can be tested
 * without a window. See docs/design.md, "App updates".
 */

/** Where restarting into a downloaded update stands, in the banner or in About. */
export type InstallStep =
	| { kind: "offer" }
	/** Sessions run, so the person is asked first, with how many. */
	| { kind: "confirm"; live: number }
	| { kind: "restarting" }
	| { kind: "failed"; message: string };

export const UPDATE_RESTARTING = "Restarting into the update. If the app is still open in a moment, quit it and start it again.";

/** The banner's line, or null when there is no banner: only a downloaded update the person did not say Later to shows one. */
export function appUpdateBannerText(state: AppUpdateState, later: string | null): string | null {
	if (state.kind === "ready" && state.version !== later) return `Timber app ${state.version} is downloaded. Restart the app to install it.`;
	if (state.kind === "installing") return `Restarting into Timber app ${state.version}.`;
	return null;
}

/** The question before restarting while sessions run. They are saved first, so they open again. */
export function updateConfirmText(live: number): string {
	const ending = describeEndingTerminals(live);
	return `Restart to install the update now?${ending === null ? "" : ` ${ending} They open again when the app starts.`}`;
}

/** What Restart to update leads to after the engine answered. */
export function installStepOf(result: AppUpdateInstallResult): InstallStep {
	if (result.outcome === "restarting") return { kind: "restarting" };
	if (result.outcome === "sessions-running") return { kind: "confirm", live: result.live };
	return { kind: "failed", message: result.message };
}

/** About's line on updates: what was found, and a quieter note. A failed look is said here and nowhere else. */
export function appUpdateStatus(state: AppUpdateState, at: (milliseconds: number) => string): { text: string; note: string | null } {
	switch (state.kind) {
		case "unavailable": return { text: "Updates are off for this copy", note: state.reason };
		case "idle": return { text: "Not looked yet", note: "The app looks a little after it starts, and every six hours." };
		case "checking": return { text: "Looking for an update", note: null };
		case "up-to-date": return { text: "Up to date", note: `Last looked at ${at(state.checkedAt)}.` };
		case "downloading": return { text: `Downloading ${state.version}`, note: "It installs only when you restart the app." };
		case "ready": return { text: `${state.version} is ready to install`, note: "Restart the app to install it." };
		case "installing": return { text: `Restarting into ${state.version}`, note: null };
		case "failed": return {
			text: state.stage === "check" ? "Could not look for an update" : "Could not download the update",
			note: `${state.message} The installed app is unchanged.`,
		};
	}
}

/** Whether Check for updates can be pressed now. */
export function canCheckForUpdate(state: AppUpdateState): boolean {
	return state.kind === "idle" || state.kind === "up-to-date" || state.kind === "failed" || state.kind === "ready";
}
