/**
 * Carries out what the alert policy decided, in the main process: a
 * notification shown or withdrawn, and the sound chosen for its status.
 */
import type { AlertAction } from "../shared/status-notices";
import type { DesktopNotices } from "./desktop-notices";
import type { SoundPlayer } from "./sounds";

export function carryAlert(action: AlertAction, notices: Pick<DesktopNotices, "show" | "withdraw">, sounds: Pick<SoundPlayer, "play">): void {
	if (action.kind === "withdraw") {
		notices.withdraw(action.session);
		return;
	}
	if (action.kind === "show") notices.show(action.notice, { withSound: action.sound !== null });
	// The player keeps its rules for every status: one sound at a time, and none longer than its limit.
	// An automatic sound whose own file is gone plays the chime instead. The outcome is not logged: it may name the file.
	if (action.sound !== null) void sounds.play(action.sound, { fallBackToChime: true });
}
