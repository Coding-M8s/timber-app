import { describeCommandLine } from "../shared/command-line";
import type { AvailableUninstallPlan, UninstallResult } from "../shared/uninstall";

/** Where uninstalling stands in the Uninstall part of About. */
export type UninstallRun =
	| { state: "idle" }
	| { state: "running" }
	| { state: "failed"; message: string }
	/** The app is removed. With a problem to tell, it stays open until the person quits. */
	| { state: "done"; settingsProblem: string | null };

export const UNINSTALL_SUMMARY = "Removes Timber from this computer: the app, its menu entry and desktop shortcut, and the web data and cache it wrote.";
export const UNINSTALL_KEEPS = "Your repositories, their worktrees, and Timber itself are not touched.";
export const UNINSTALL_FORGET_LABEL = "Also forget the saved repository list and the app's settings";
export const UNINSTALL_CHECKING = "Checking whether this copy can be uninstalled.";
export const UNINSTALL_DONE = "Timber was removed. The app is quitting.";
export const UNINSTALL_NO_UNDO = "This cannot be undone from here. To get the app back, install it again.";

/** Under the checkbox: what happens to the settings either way. */
export function describeForgetHint(settingsFolder: string, forget: boolean): string {
	return forget
		? `${settingsFolder} is deleted once the app is removed. Another install starts with an empty list.`
		: `${settingsFolder} stays, so another install finds the same repositories.`;
}

/** The command as it would run, for showing before it does. */
export function describeUninstallCommand(plan: AvailableUninstallPlan): string {
	return describeCommandLine(plan.command);
}

/** Everything that goes, in the order it goes: what the uninstaller removes, then the settings when asked. */
export function uninstallRemovals(plan: AvailableUninstallPlan, forget: boolean): string[] {
	return forget ? [...plan.removes, plan.settingsFolder] : [...plan.removes];
}

/** Where uninstalling stands after the engine answered. */
export function uninstallRunOf(result: UninstallResult): UninstallRun {
	if (result.outcome === "uninstalled") return { state: "done", settingsProblem: result.settingsProblem };
	return { state: "failed", message: result.message };
}
