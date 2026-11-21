import { type ChopApprovals, withChopApproval } from "../shared/chops";
import type { SettingsHolder } from "./settings";

/** The chop approvals part of the settings file: the repository chop texts the person agreed to run. */
export interface SavedChopApprovals {
	/** The saved approvals, or none when nothing was saved. */
	load(): Promise<ChopApprovals>;
	/**
	 * Keep one more approval for a repository, leaving every other part of
	 * the settings as it is. Throws when it could not be saved.
	 */
	approve(repository: string, digest: string): Promise<void>;
}

export function createSavedChopApprovals(settings: SettingsHolder): SavedChopApprovals {
	return {
		async load() {
			return structuredClone((await settings.current()).chopApprovals ?? {});
		},
		approve(repository, digest) {
			return settings.inTurn(async () => {
				const current = await settings.current();
				await settings.save({ ...current, chopApprovals: withChopApproval(current.chopApprovals ?? {}, repository, digest) });
			});
		},
	};
}
