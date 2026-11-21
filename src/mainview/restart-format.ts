import type { RestartPlan, RestartResult } from "../shared/restart";

/**
 * Where offering a restart stands, after a save changed a preference the app
 * reads only when it starts:
 * - `offer`: Restart now or Later.
 * - `checking`: asking the main process whether this copy can restart.
 * - `confirm`: terminals run, which a restart ends, or files hold unsaved
 *   edits, which it drops, so the person is asked.
 * - `restarting`: the app is quitting and starts again.
 * - `unavailable`: this copy cannot restart itself, and why.
 * - `failed`: the app did not quit, and why.
 * - `later`: the person chose Later, and nothing more is offered.
 */
export type RestartStep =
	| { kind: "offer" }
	| { kind: "checking" }
	| { kind: "confirm" }
	| { kind: "restarting" }
	| { kind: "unavailable"; reason: string }
	| { kind: "failed"; message: string }
	| { kind: "later" };

export const RESTART_OFFER = "The app reads this setting when it starts. Restart now to use it?";
export const RESTART_CONFIRM = "Restart the app now?";
export const RESTARTING = "Restarting. If the app is still open in a moment, quit it and start it again.";

/** What Restart now does once the main process said whether it can: say why not, ask first while terminals run, or go ahead. */
export function restartStepAfterPlan(plan: RestartPlan, liveTerminals: number, unsavedFiles = 0): RestartStep | "restart" {
	if (!plan.available) return { kind: "unavailable", reason: plan.reason };
	return liveTerminals > 0 || unsavedFiles > 0 ? { kind: "confirm" } : "restart";
}

/** Where offering a restart stands after the engine answered. */
export function restartStepOf(result: RestartResult): RestartStep {
	if (result.outcome === "restarting") return { kind: "restarting" };
	if (result.outcome === "unavailable") return { kind: "unavailable", reason: result.message };
	return { kind: "failed", message: result.message };
}
