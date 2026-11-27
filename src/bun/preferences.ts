import type { SavePreferencesResult } from "../shared/model";
import { type Preferences, applyPreferenceChange, defaultPreferences, samePreferences } from "../shared/preferences";
import { type RepositoryAgentChange, readRepositoryAgentChange, repositoryAgentsOf, withRepositoryAgents } from "../shared/repository-agents";
import { overrideRepositoryPaths } from "./git-engine";
import type { SettingsHolder } from "./settings";
import { messageOf } from "../shared/error-message";
import { withoutRemovedTags } from "../shared/worktree-tags";

/** The preferences part of the settings file: the app's own settings from the Settings dialog. */
export interface SavedPreferences {
	/** The saved preferences, or the defaults when none were saved yet. */
	load(): Promise<Preferences>;
	/**
	 * Save the preferences that `change` names, on top of what was saved last,
	 * leaving every other part of the settings as it is. A change with a part
	 * that cannot be read saves nothing. A failure is an answer, not an error,
	 * so the interface carries on. `repositoryAgents` is saved in the same
	 * write, as `Engine.savePreferences` says.
	 */
	save(change: Partial<Preferences>, repositoryAgents?: RepositoryAgentChange | null): Promise<SavePreferencesResult>;
}

/** Why a pick is refused while the repositories come from the development override. */
const OVERRIDDEN_PICKS = "Nothing was saved. The repositories come from TIMBER_APP_REPOS, so no default agents are kept for them.";

export function createSavedPreferences(settings: SettingsHolder, environment: Record<string, string | undefined> = process.env): SavedPreferences {
	return {
		async load() {
			return (await settings.current()).preferences ?? defaultPreferences();
		},

		save(change, repositoryAgents = null) {
			return settings.inTurn(async () => {
				const current = await settings.current();
				const saved = current.preferences ?? defaultPreferences();
				// What the interface sent is checked like anything else that comes from outside.
				const { preferences: next, unreadable } = applyPreferenceChange(saved, change);
				if (unreadable.length > 0) {
					return { outcome: "failed", message: `Nothing was saved, because these settings could not be read: ${unreadable.join(", ")}.` };
				}
				const overridden = overrideRepositoryPaths(environment) !== null;
				const picks = repositoryAgents === null ? {} : readRepositoryAgentChange(repositoryAgents);
				if (picks === undefined) return { outcome: "failed", message: "Nothing was saved, because the default agents of the repositories could not be read." };
				if (overridden && Object.keys(picks).length > 0) return { outcome: "failed", message: OVERRIDDEN_PICKS };
				// Saved with the agents, so a rename or a removal is never half saved.
				// Under the override the saved list is not the one shown, so its picks stay as they are.
				const picked = overridden ? { ok: true as const, entries: current.repositories, changed: false } : withRepositoryAgents(current.repositories, picks, saved.agents, next.agents);
				if (!picked.ok) return { outcome: "failed", message: picked.message };
				// A tag removed takes its worktrees back to Work in the same write.
				const retagged = withoutRemovedTags(picked.entries, next.tags);
				const answer: SavePreferencesResult = { outcome: "saved", preferences: next };
				if (change?.agents !== undefined || repositoryAgents !== null) answer.repositoryAgents = overridden ? {} : repositoryAgentsOf(picked.entries);
				if (current.preferences && samePreferences(saved, next) && !picked.changed && !retagged.changed) return answer;
				try {
					await settings.save({ ...current, repositories: retagged.entries, preferences: next });
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${settings.file}: ${messageOf(error)}` };
				}
				return answer;
			});
		},
	};
}
