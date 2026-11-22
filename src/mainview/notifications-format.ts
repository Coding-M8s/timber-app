import { type Preferences, readAlertStates } from "../shared/preferences";
import { BUNDLED_SOUNDS, type SoundChoice, type SoundOutcome, type StateSounds, sameStateSounds } from "../shared/sound-setting";
import type { AlertState } from "../shared/status-notices";

/**
 * The Notifications section of Settings as data: what it edits, and the words
 * for a sound preview. Pure, so they can be tested without a window.
 */

/** What the section edits: the parts of the preferences it saves. */
export interface NotificationsDraft {
	statusNotifications: boolean;
	notifyStates: readonly AlertState[];
	sounds: StateSounds;
}

export function notificationsDraftOf(preferences: Preferences): NotificationsDraft {
	const { statusNotifications, notifyStates, sounds } = preferences;
	return { statusNotifications, notifyStates, sounds };
}

export function sameNotificationsDraft(one: NotificationsDraft, other: NotificationsDraft): boolean {
	const sameStates = (left: readonly AlertState[], right: readonly AlertState[]) => left.length === right.length && left.every(state => right.includes(state));
	return one.statusNotifications === other.statusNotifications && sameStates(one.notifyStates, other.notifyStates)
		&& sameStateSounds(one.sounds, other.sounds);
}

/** The sounds with one status's sound changed, or turned off with null. */
export function withStateSound(sounds: StateSounds, state: AlertState, choice: SoundChoice | null): StateSounds {
	return { ...sounds, [state]: choice };
}

/** A state's sound picker value for a choice: `none`, `bundled:<name>`, `system`, or `custom`. */
export function soundOptionOf(choice: SoundChoice | null): string {
	if (choice === null) return "none";
	return choice.kind === "bundled" ? `bundled:${choice.name}` : choice.kind;
}

/**
 * What picking `value` in a state's sound picker does: set that state's
 * sound (null for none), or open the file dialog when "Your own file" has no
 * file yet for that state. Null for a value the picker does not offer.
 */
export function pickSound(value: string, customPath: string | undefined): { kind: "set"; sound: SoundChoice | null } | { kind: "choose-file" } | null {
	if (value === "none") return { kind: "set", sound: null };
	if (value === "system") return { kind: "set", sound: { kind: "system" } };
	if (value === "custom") return customPath === undefined ? { kind: "choose-file" } : { kind: "set", sound: { kind: "custom", path: customPath } };
	const name = BUNDLED_SOUNDS.find(sound => `bundled:${sound}` === value);
	return name === undefined ? null : { kind: "set", sound: { kind: "bundled", name } };
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
