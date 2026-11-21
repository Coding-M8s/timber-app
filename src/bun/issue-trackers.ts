import { type IssueTrackers, githubRemoteName, githubRepositoryOf, issueTrackersOf, remoteUrlArguments } from "../shared/issue-trackers";
import type { TimberSettingsReadResult, TimberSettingsRequest } from "../shared/timber-config";
import { readGit } from "./read-git";

/** Reading a remote's URL is local and quick, so anything this slow is stuck. */
const REMOTE_TIMEOUT_MS = 10_000;
/** A remote's URLs fit in far less. */
const REMOTE_LIMIT_BYTES = 16 * 1024;

export interface IssueTrackerReaderOptions {
	/**
	 * Timber's settings read (see ./timber-settings.ts). It checks that the
	 * repository is in the list and that Timber is ready, and keeps every
	 * login private.
	 */
	readSettings: (request: TimberSettingsRequest) => Promise<TimberSettingsReadResult>;
	/** The Git executable. Tests may pass another. */
	git?: string;
}

export interface IssueTrackerReader {
	/** The trackers set up for a repository in the list, named by the path of its primary checkout. */
	read(repository: string): Promise<IssueTrackers>;
}

/**
 * The "owner/name" of the github.com repository the remote Timber looks up
 * GitHub issues through, or null when it is not one. One read-only `git
 * remote get-url --all`, as an argument array; a remote that is missing, or
 * Git that fails, is null.
 */
export async function githubRemoteRepository(folder: string, remote: string, git?: string): Promise<string | null> {
	const answer = await readGit(remoteUrlArguments(folder, remote), { ...(git === undefined ? {} : { git }), timeoutMs: REMOTE_TIMEOUT_MS, limitBytes: REMOTE_LIMIT_BYTES });
	return answer.started && answer.exitCode === 0 && !answer.timedOut && !answer.truncated ? githubRepositoryOf(answer.stdout) : null;
}

/**
 * The issue trackers of a repository, from Timber's settings for it and its
 * Git remote. Git runs only after Timber's read worked, so only for a
 * repository in the list. Nothing read here is logged.
 */
export function createIssueTrackerReader(options: IssueTrackerReaderOptions): IssueTrackerReader {
	const { readSettings, git } = options;
	return {
		async read(repository) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			if (typeof repository !== "string" || repository === "") return { ok: false, message: "The request for issue trackers names no repository." };
			const settings = await readSettings({ scope: "repository", repository });
			if (settings.outcome === "failed") return { ok: false, message: settings.failure.diagnostic };
			const { effective, credentials } = settings.settings;
			const github = await githubRemoteRepository(repository, githubRemoteName(effective), git);
			return issueTrackersOf({ effective, credentials }, github);
		},
	};
}
