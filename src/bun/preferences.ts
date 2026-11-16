import type { SavePreferencesResult } from "../shared/model";
import { type Preferences, applyPreferenceChange, defaultPreferences, samePreferences } from "../shared/preferences";
import type { SettingsHolder } from "./settings";

/** The preferences part of the settings file: the app's own settings from the Settings dialog. */
export interface SavedPreferences {
	/** The saved preferences, or the defaults when none were saved yet. */
	load(): Promise<Preferences>;
	/**
	 * Save the preferences that `change` names, on top of what was saved last,
	 * leaving every other part of the settings as it is. A failure is an
	 * answer, not an error, so the interface carries on.
	 */
	save(change: Partial<Preferences>): Promise<SavePreferencesResult>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createSavedPreferences(settings: SettingsHolder): SavedPreferences {
	return {
		async load() {
			return (await settings.current()).preferences ?? defaultPreferences();
		},

		save(change) {
			return settings.inTurn(async () => {
				const current = await settings.current();
				const saved = current.preferences ?? defaultPreferences();
				// What the interface sent is checked like anything else that comes from outside.
				const next = applyPreferenceChange(saved, change);
				if (current.preferences && samePreferences(saved, next)) return { outcome: "saved", preferences: next };
				try {
					await settings.save({ ...current, preferences: next });
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${settings.file}: ${messageOf(error)}` };
				}
				return { outcome: "saved", preferences: next };
			});
		},
	};
}
