import type { Engine } from "../../shared/engine";
import { issueTrackersOf } from "../../shared/issue-trackers";

/** The part of the engine about which issue trackers a repository has set up. */
export type IssueTrackerCapabilities = Pick<Engine, "readIssueTrackers">;

export interface IssueTrackerControls {
	/** Decide whether one repository, named by its primary checkout, has a GitHub remote from now on, or null for the sample. */
	setGithubRemote(repository: string, github: boolean | null): void;
}

/** Sample repositories with no GitHub remote, as their pull requests say (./mock-pull-requests.ts). Every other one has one. */
const NOT_ON_GITHUB = new Set<string>(["/work/docs-site"]);

/**
 * Issue trackers acted out from the mock's Timber settings
 * (./mock-timber-config.ts), so the dialog and Settings agree: a Jira login
 * saved in Settings lists Jira, and a failed settings read is a failure here
 * too. With the samples, timber has GitHub and Jira, and api-server GitHub
 * only.
 */
export function createMockIssueTrackers(readTimberSettings: Engine["readTimberSettings"]): IssueTrackerCapabilities & IssueTrackerControls {
	const chosen = new Map<string, boolean>();
	return {
		async readIssueTrackers(repository) {
			const read = await readTimberSettings({ scope: "repository", repository });
			if (read.outcome === "failed") return { ok: false, message: read.failure.diagnostic };
			const github = chosen.get(repository) ?? !NOT_ON_GITHUB.has(repository);
			return issueTrackersOf(read.settings, github);
		},
		setGithubRemote(repository, github) {
			if (github === null) chosen.delete(repository);
			else chosen.set(repository, github);
		},
	};
}
