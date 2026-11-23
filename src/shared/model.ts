import type { Preferences } from "./preferences";
import type { RepositoryGroups } from "./repository-groups";

/**
 * Whether a usable Timber is installed. Everything that runs Timber depends on
 * this being "ready".
 */
/**
 * Where the Timber in use came from: the one that comes with the app, the
 * file chosen in Settings, the timber on PATH, or the development override
 * `TIMBER_APP_TIMBER_PATH`.
 */
export type TimberSource = "bundled" | "setting" | "path" | "override";

export type TimberStatus =
	/**
	 * `newerRelease` is set while a Timber release newer than this one is out,
	 * learned while the app was running. Timber stays usable until the next
	 * start, when the newest release is required.
	 */
	| { state: "ready"; source: TimberSource; path: string; version: string; newerRelease?: string }
	/** No Timber answered. `path` is where the app looked, or null when there was no timber on PATH. */
	| { state: "not-found"; source: TimberSource; path: string | null }
	/** `required` is the newest Timber release when `latestRelease` is true, and otherwise the built-in minimum. */
	| { state: "too-old"; source: TimberSource; path: string; found: string; required: string; latestRelease?: boolean };

/** How a branch stands against its upstream, as of the last fetch. */
export type SyncState =
	/** No upstream is configured: the branch has never been published. */
	| { kind: "unpublished" }
	/** An upstream is configured, but its remote-tracking ref no longer exists. */
	| { kind: "gone"; upstream: string }
	| {
		kind: "tracking";
		upstream: string;
		ahead: number;
		behind: number;
		/**
		 * The remote the upstream comes from, such as `origin`, and the
		 * upstream's full ref, such as `refs/remotes/origin/feat/login`, for
		 * a sync action's commands (see ./sync-actions.ts). Absent when Git
		 * did not say, as for an upstream that is another local branch: no
		 * sync action is offered then.
		 */
		remote?: string;
		upstreamRef?: string;
		/**
		 * Set when a fetch by the app found the upstream rewritten: its previous
		 * commit is not an ancestor of the new one, as after a force-push. `at`
		 * names the mark, for saying that the person saw it. Absent otherwise.
		 */
		forcePushed?: { at: number };
	};

/**
 * The files Timber found changed in a worktree. The paths are relative to the
 * worktree, as Git reports them. Unknown when Timber could not read the
 * folder, for example because it is missing; `reason` is Timber's own wording.
 */
export type WorktreeChanges =
	| { kind: "known"; modified: string[]; untracked: string[] }
	| { kind: "unknown"; reason: string };

/**
 * The base Timber saved for a worktree: what `timber rebase` rebases it onto
 * and `timber done` checks it against. Timber reads it offline, so an
 * assigned ref or a commit is a saved choice, not proof that it still exists.
 */
export type SavedBase =
	/** The canonical ref exactly as saved: `refs/remotes/<remote>/<branch>` or `refs/heads/<branch>`. */
	| { kind: "assigned"; ref: string }
	/** A commit, which no branch has to contain: its full lowercase hash, as saved. */
	| { kind: "commit"; commit: string }
	/** Nothing is saved, as for the primary checkout or a worktree added with plain Git. */
	| { kind: "unassigned" }
	/**
	 * Saved metadata exists and Timber cannot use it: not in the expected form
	 * ("malformed"), not matching this worktree ("stale"), or not readable
	 * ("unreadable"). The base is unknown then, never "none".
	 */
	| { kind: "invalid"; reason: SavedBaseProblem };

export type SavedBaseProblem = "malformed" | "stale" | "unreadable";

/**
 * How a worktree's commit stands against its saved base, read from Git with
 * `git rev-list --left-right --count <base>...<head>`, because Timber does not
 * report it. Commits on the worktree's side only are ahead; commits on the
 * base's side only are behind.
 */
export type BaseCounts =
	| { kind: "counted"; ahead: number; behind: number }
	/** There is a base to count against, and Git could not count, as when the base ref no longer exists. Never a guessed zero. */
	| { kind: "unreadable" };

/** A tracker an issue link can name. */
export type IssueTracker = "github" | "jira" | "linear";

/**
 * The tracker issue Timber saved for a worktree: the one it was created from,
 * or one attached later with `timber open --issue`. Timber reads it offline,
 * so it carries no title or status; those come from `Engine.readIssue`.
 */
export type IssueLink =
	/** `key` is the GitHub issue number as decimal text, or the Jira or Linear key. `url` is the `https` address Timber saved. */
	| { kind: "linked"; tracker: IssueTracker; key: string; url: string }
	/** Nothing is saved, as for the primary checkout or a worktree made from a branch name. */
	| { kind: "none" }
	/** Saved metadata exists and Timber cannot use it, with the same reasons as a saved base. The issue is unknown then, never "none". */
	| { kind: "invalid"; reason: SavedBaseProblem };

/** One worktree, as `timber ls --json` lists it. */
export interface Worktree {
	/**
	 * Identity: the repository's common Git directory plus the worktree's
	 * canonical path (see `worktreeId`). Compare worktrees by this, never by
	 * branch or label.
	 */
	id: string;
	/** The path registered with Git, verbatim. The exact selector for Timber commands. */
	path: string;
	/** The path with links resolved. Null when Timber could not verify the folder. */
	canonicalPath: string | null;
	/** Exact branch name, or null on a detached HEAD. */
	branch: string | null;
	/** Null on a branch with no commit yet. */
	head: string | null;
	/** The primary checkout. Timber never removes it. */
	primary: boolean;
	detached: boolean;
	locked: boolean;
	prunable: boolean;
	/** False when the folder was missing when Timber looked. */
	pathExists: boolean;
	changes: WorktreeChanges;
	/**
	 * The base Timber saved for the worktree. Null when Timber's record does
	 * not say, as with a Timber from before the field. Never inferred.
	 */
	base: SavedBase | null;
	/**
	 * The issue Timber saved for the worktree. Null when Timber's record does
	 * not say, as with a Timber from before the field: no issue is shown then.
	 */
	issue: IssueLink | null;
	/**
	 * How the branch stands against its upstream, read from Git because Timber
	 * does not report it. Null on a detached HEAD, or when Git could not say.
	 */
	sync: SyncState | null;
	/**
	 * How the worktree's commit stands against its saved base. Null when there
	 * is nothing to count: no saved base Git can compare with (none reported,
	 * unassigned, or invalid), or no commit yet.
	 */
	baseCounts: BaseCounts | null;
}

/**
 * The identity of a worktree. Timber gives a canonical path only for a folder
 * it verified. Otherwise the registered path stands in, marked as such, so a
 * missing or replaced folder never shares an identity with a verified one.
 */
export function worktreeId(commonGitDir: string, worktree: { path: string; canonicalPath: string | null }): string {
	return worktree.canonicalPath === null
		? [commonGitDir, "registered", worktree.path].join("\0")
		: [commonGitDir, "verified", worktree.canonicalPath].join("\0");
}

export interface Repository {
	/** Absolute path of the primary checkout. */
	path: string;
	name: string;
	/**
	 * False when the saved folder is missing or Git can no longer read it as a
	 * primary checkout. The repository then stays listed, with no worktrees.
	 */
	available: boolean;
	/**
	 * Why Timber could not list the worktrees on the latest read, or null when
	 * it did. A failed read carries no worktrees of its own: the engine answers
	 * with none, and the interface keeps showing the last good list.
	 */
	failure: string | null;
	/** Which Timber settings apply to the repository, as of the latest read (see `SetupState`). */
	setup: SetupState;
	/**
	 * The remote-tracking ref a worktree with no saved base is rebased onto,
	 * such as `refs/remotes/origin/main`, as far as can be told offline: the
	 * remote's default branch as of the last fetch, or the branch Timber's
	 * settings name. Null when unknown and when it was not worth reading, since
	 * it is read only for a primary checkout that tracks the remote branch of
	 * its own name with no saved base (see ./fallback-base.ts). It only
	 * chooses between Rebase and Pull for the primary checkout.
	 */
	fallbackBase: string | null;
	worktrees: Worktree[];
}

/**
 * Which Timber settings a repository has, read from the files Timber reads,
 * never by asking Timber. "repository" when its primary checkout has a
 * `.timber.toml`, "machine" when only the machine defaults exist, "none"
 * when neither file exists, and "unknown" when the files could not be
 * checked, for example because the repository is unavailable. Only "none"
 * means the repository was never set up.
 */
export type SetupState = "repository" | "machine" | "none" | "unknown";

/** What came of asking to add a repository through the folder picker. */
export type AddRepositoryResult =
	| { outcome: "added"; repository: Repository }
	/** The picked folder belongs to a repository in the list. `repository` is its path there. */
	| { outcome: "already-listed"; repository: string }
	| { outcome: "not-a-repository"; folder: string }
	/** The person closed the picker without choosing. */
	| { outcome: "cancelled" }
	/** The list comes from the development override, so the app does not change it. */
	| { outcome: "overridden" }
	| { outcome: "failed"; message: string };

/** What came of asking to forget a repository. Nothing on disk changes either way. */
export type RemoveRepositoryResult =
	| { outcome: "removed" }
	| { outcome: "overridden" }
	| { outcome: "failed"; message: string };

/** What came of asking to save a new order of the repositories. Nothing on disk changes but the app's settings. */
export type ReorderRepositoriesResult =
	| { outcome: "saved" }
	| { outcome: "overridden" }
	| { outcome: "failed"; message: string };

/**
 * What came of asking to change the repository groups. Nothing on disk changes but the app's settings.
 * Saved carries every group as saved, which is what the sidebar shows from then on.
 */
export type RepositoryGroupsResult =
	| { outcome: "saved"; groups: RepositoryGroups }
	/** The name has nothing in it once its spaces are trimmed. */
	| { outcome: "name-empty" }
	/** Another group with the same parent has this name, ignoring case. `name` is that group's name as saved. */
	| { outcome: "name-taken"; name: string }
	/** A group cannot go inside itself or one of its own subgroups. */
	| { outcome: "inside-itself" }
	/** Groups nest at most `MAX_GROUP_DEPTH` levels deep (see ./repository-groups.ts). */
	| { outcome: "too-deep" }
	/** The list comes from the development override, so the app does not change it. */
	| { outcome: "overridden" }
	| { outcome: "failed"; message: string };

/** What came of asking to remember the layout. A failure never changes what is on screen. */
export type SaveLayoutResult =
	| { outcome: "saved" }
	| { outcome: "failed"; message: string };

/** How saving a change to the preferences ended. Saved carries every preference as saved, not only the changed ones. */
export type SavePreferencesResult =
	| { outcome: "saved"; preferences: Preferences }
	| { outcome: "failed"; message: string };

/** Open a worktree in the person's editor. The editor command is never part of the request: it is the saved setting. */
export interface OpenInEditorRequest {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/**
	 * A file in the worktree to open instead of its folder, relative to it as
	 * Git reports it, such as `src/app.ts`. Left out to open the folder.
	 */
	file?: string;
}

/**
 * How asking to open a worktree in the editor ended. `command` is the exact
 * command, worded for display (see `describeEditorCommand`), wherever one
 * was built. Only "opened" started anything.
 */
export type OpenInEditorResult =
	/** The editor was started, detached from the app. Whether it then shows a window is up to the editor. */
	| { outcome: "opened"; command: string }
	/** No editor is set in Settings. */
	| { outcome: "not-configured" }
	/** The editor runs in a terminal, which "Open in editor" does not start yet. Nothing was started. */
	| { outcome: "terminal-editor"; command: string; message: string }
	/** The repository is not in the app's list, or Timber does not list that worktree, or its folder is gone. Nothing was started. */
	| { outcome: "not-listed"; message: string }
	/** The executable is not on the PATH the app was started with. Nothing was started. */
	| { outcome: "not-found"; command: string; executable: string; message: string }
	/** The command could not be built or started, or the editor stopped right away with an error. */
	| { outcome: "failed"; command: string | null; message: string };

/**
 * What a Timber command printed, standard output and standard error together
 * in the order they arrived. It is limited in size: when the command printed
 * more, only the end is kept and `truncated` is true.
 *
 * Private: setup scripts can print anything, so this is shown to the person
 * and never written to a log.
 */
export interface CapturedOutput {
	text: string;
	truncated: boolean;
}

/** A Timber command that failed, as every dialog reports it. */
export interface TimberFailure {
	/** The command as it was shown before it ran. Null when the failure came before any command ran. */
	command: string | null;
	/** Why it failed: the diagnostic from Timber's record, or the app's own words when there is no usable record. */
	diagnostic: string;
	/** Null when nothing was captured, for example because the command never started. */
	output: CapturedOutput | null;
}

/** What to create with `timber new`. */
export interface NewWorktreeRequest {
	/** The path of the repository's primary checkout. Timber runs there. */
	repository: string;
	/** A branch name, a sentence, or an issue in one of Timber's forms, as the person typed it. Timber decides what branch it becomes. */
	name: string;
	/** The ref to start from, or null to let Timber pick its configured base. */
	base: string | null;
	/** A named workflow from `listWorkflows`, whose setup scripts run after the ordinary ones. Left out for none. */
	workflow?: string;
	/**
	 * The branch to create for an issue instead of the one Timber generates,
	 * passed as `--branch`. Only with an issue selector as `name`, as
	 * `issueLinkSelector` makes it. Timber checks the name: it must start with
	 * the issue's ID and `-`. Left out for Timber's name.
	 */
	branch?: string;
	/**
	 * Assign the issue to the person's tracker account: `assign` passes
	 * `--assign`, which Timber refuses when someone else has the issue, and
	 * `reassign` passes `--reassign`, which replaces them. Only with an issue
	 * selector as `name`. Left out for no assignment.
	 */
	assign?: "assign" | "reassign";
	/** Allow a closed or done issue, passed as `-c`. Only with an issue selector as `name`. Timber never reopens it. */
	allowClosed?: true;
}

/** What `timber new --assign` or `--reassign` did about the issue's assignee, from its record. */
export type AssignmentResult = "not-attempted" | "assigned" | "reassigned" | "already-mine" | "failed";

/**
 * The `assignment` of a `timber new` record. `me` is the signed-in account's
 * display name (the login for GitHub), `previous` the assignees before
 * Timber wrote anything, and `diagnostic` the reason a write failed. All
 * text from the tracker, made safe to show.
 */
export interface Assignment {
	result: AssignmentResult;
	me: string;
	previous: string[];
	diagnostic: string | null;
}

/** What to open with `timber open`. */
export interface OpenWorktreeRequest {
	/** The path of the repository's primary checkout. Timber runs there. */
	repository: string;
	/** A branch, a ticket, or the exact registered path of a worktree (`Worktree.path`). */
	selector: string;
	/**
	 * A named workflow from `listWorkflows`. Left out for none. Timber does not
	 * remember the workflow a worktree was created with, so the setup session
	 * that follows passes it again.
	 */
	workflow?: string;
	/**
	 * An issue to link the worktree to, as `issueLinkSelector` makes it
	 * (`github:42`, `jira:ENG-12`, `linear:ENG-12`), passed as `--issue`. Left
	 * out for none. Timber looks the issue up once, saves the link, and
	 * refuses a worktree linked to another issue.
	 */
	issue?: string;
}

/** The worktree a Timber command reported: enough to find it in the list and to name it to Timber again. */
export interface ReportedWorktree {
	/** The same identity the list uses (`Worktree.id`). */
	id: string;
	/** The path registered with Git, verbatim. The exact selector for a later Timber command. */
	path: string;
	/** Exact branch name, or null on a detached HEAD. */
	branch: string | null;
}

/**
 * How `timber new` or `timber open` ended, as the interface needs it.
 *
 * `created` is true when this run made a worktree that Timber verified. A
 * failure with `created` true means the worktree exists and only what came
 * after, such as a setup script, did not finish: offer to run setup again in
 * `worktree`, never to start over. A failure with `worktree` null says
 * nothing about what exists, so read the list again. `assignment` is there
 * only when `timber new` ran with `--assign` or `--reassign` and its record
 * says what it did about the assignee.
 */
export type WorktreeCommandResult =
	| { outcome: "succeeded"; worktree: ReportedWorktree; created: boolean; setupSkipped: boolean; assignment?: Assignment }
	/** The person closed Timber's own chooser before anything was changed. */
	| { outcome: "cancelled" }
	| { outcome: "failed"; failure: TimberFailure; worktree: ReportedWorktree | null; created: boolean; setupSkipped: boolean; assignment?: Assignment };

/** A branch offered for picking wherever a branch is typed. Only a suggestion: any text may be typed instead. */
export interface BranchSuggestion {
	/**
	 * The name as it is shown and as it is given to Timber: a local branch by
	 * its name, a remote-tracking branch as `<remote>/<branch>`.
	 */
	selector: string;
	kind: "local" | "remote";
}
