import { type Preferences, readAlertStates } from "../shared/preferences";
import { type SoundChoice, type SoundOutcome, sameSoundChoice } from "../shared/sound-setting";
import type { AlertState } from "../shared/status-notices";

/**
 * The Notifications section of Settings as data: what it edits, and the words
 * for a sound preview. Pure, so they can be tested without a window.
 */

/** What the section edits: the parts of the preferences it saves. */
export interface NotificationsDraft {
	statusNotifications: boolean;
	notifyStates: readonly AlertState[];
	soundStates: readonly AlertState[];
	sound: SoundChoice;
}

export function notificationsDraftOf(preferences: Preferences): NotificationsDraft {
	const { statusNotifications, notifyStates, soundStates, sound } = preferences;
	return { statusNotifications, notifyStates, soundStates, sound };
}

export function sameNotificationsDraft(one: NotificationsDraft, other: NotificationsDraft): boolean {
	const sameStates = (left: readonly AlertState[], right: readonly AlertState[]) => left.length === right.length && left.every(state => right.includes(state));
	return one.statusNotifications === other.statusNotifications && sameStates(one.notifyStates, other.notifyStates)
		&& sameStates(one.soundStates, other.soundStates) && sameSoundChoice(one.sound, other.sound);
}

/** A list of statuses with one turned on or off, kept in Settings order. */
export function toggleState(states: readonly AlertState[], state: AlertState, on: boolean): AlertState[] {
	return readAlertStates(on ? [...states, state] : states.filter(other => other !== state)) ?? [];
}

/** Words for a preview that did not play. Null when it played. */
export function describeSoundOutcome(outcome: SoundOutcome): string | null {
	switch (outcome.outcome) {
		case "played":
			return null;
		case "busy":
			return "Another sound is still playing. Try again in a moment.";
		case "no-player":
			return "No program that can play this sound was found. On Linux the app uses pw-play, paplay, or aplay.";
		case "missing":
			return "The sound file is not there any more. Choose it again.";
		case "failed":
			return "The sound could not be played. The file may be of a kind the player cannot read.";
	}
}
