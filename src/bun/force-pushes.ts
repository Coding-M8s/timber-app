import type { ForcePushMarks } from "../shared/git-fetch";
import type { SettingsHolder } from "./settings";
import { messageOf } from "../shared/error-message";

/** The force-push marks part of the settings file: branches whose rewritten upstream the person has not seen yet. */
export interface SavedForcePushes {
	/** The saved marks, or none when nothing was saved. */
	load(): Promise<ForcePushMarks>;
	/**
	 * Save the marks of every repository, leaving every other part of the
	 * settings as it is. A failure is logged and changes nothing: the marks are
	 * a convenience, and the ones in memory stay right until the app quits.
	 */
	save(marks: ForcePushMarks): Promise<void>;
}

export function createSavedForcePushes(settings: SettingsHolder, warn: (message: string) => void = console.warn): SavedForcePushes {
	return {
		async load() {
			return structuredClone((await settings.current()).forcePushes ?? {});
		},

		save(marks) {
			return settings.inTurn(async () => {
				const current = await settings.current();
				const next = { ...current };
				if (Object.keys(marks).length > 0) next.forcePushes = structuredClone(marks);
				else delete next.forcePushes;
				if (current.forcePushes === undefined && next.forcePushes === undefined) return;
				try {
					await settings.save(next);
				} catch (error) {
					// Only the file and the reason: branch names stay out of the log.
					warn(`Could not save which branches are marked force-pushed to ${settings.file}: ${messageOf(error)}`);
				}
			});
		},
	};
}
