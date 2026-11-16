import { type Layout, defaultLayout, readLayout, sameLayout } from "../shared/layout";
import type { SaveLayoutResult } from "../shared/model";
import type { SettingsHolder } from "./settings";

/** The layout part of the settings file: how the window was arranged. */
export interface SavedLayout {
	/** The saved layout, or the defaults when none was saved yet. */
	load(): Promise<Layout>;
	/**
	 * Save the layout, leaving every other part of the settings as it is. A
	 * failure is an answer, not an error, so the interface carries on.
	 */
	save(layout: Layout): Promise<SaveLayoutResult>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createSavedLayout(settings: SettingsHolder): SavedLayout {
	return {
		async load() {
			return (await settings.current()).layout ?? defaultLayout();
		},

		save(layout) {
			return settings.inTurn(async () => {
				// What the interface sent is checked like anything else that comes from outside.
				const next = readLayout(layout);
				const current = await settings.current();
				if (current.layout && sameLayout(current.layout, next)) return { outcome: "saved" };
				try {
					await settings.save({ ...current, layout: next });
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${settings.file}: ${messageOf(error)}` };
				}
				return { outcome: "saved" };
			});
		},
	};
}
