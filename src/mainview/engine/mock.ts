import type { WorktreeHandoff } from "../../shared/handoff";
import { type Attention, assumedAttention } from "../../shared/attention";
import { type AlertSettings, type StatusNotice, createAlertRunner } from "../../shared/status-notices";
import { type ChooseSoundResult, type SoundChoice, type SoundOutcome, readSoundChoice } from "../../shared/sound-setting";
import type { Engine } from "../../shared/engine";
import { type Layout, defaultLayout, forgetGroup, forgetRepository, readLayout } from "../../shared/layout";
import { type AddRepositoryResult, type BranchSuggestion, type IssueLink, type OpenInEditorRequest, type OpenInEditorResult, type Repository, type RepositoryGroupsResult, type SavedBase, type SyncState, type TimberStatus, type Worktree, type WorktreeCommandResult, worktreeId } from "../../shared/model";
import { applyOrder } from "../../shared/repository-order";
import {
	type GroupChange,
	type GroupedList,
	type RepositoryGroup,
	createGroupIn,
	deleteGroupIn,
	groupsOfList,
	placeIn,
	renameGroupIn,
	reorderGroupsIn,
} from "../../shared/repository-groups";
import { describeCommandLine } from "../../shared/command-line";
import { TERMINAL_EDITOR_REASON, editorCommand, editorTarget, otherExecutableNames } from "../../shared/editor";
import { notFoundOnPath } from "../../shared/search-path";
import { type Preferences, applyPreferenceChange, defaultPreferences } from "../../shared/preferences";
import {
	type DoneApplyResult, type DoneOptions, type DonePreviewResult, DONE_PREVIEW_MINUTES, describeDoneApply, describeDonePreview, readDonePreview,
} from "../../shared/timber-done";
import type { FetchFailureKind, FetchResult, ForcePushSeen, RepositoryFetch } from "../../shared/git-fetch";
import type { RebaseResult } from "../../shared/timber-rebase";
import type { SetBaseResult } from "../../shared/timber-base";
import { failureOf, readTimberResult } from "../../shared/timber-result";
import { APP_VERSION } from "../../shared/app-info";
import { type AvailableUninstallPlan, UNINSTALL_ARGUMENTS, type UninstallRequest } from "../../shared/uninstall";
import { REQUIRED_TIMBER_VERSION } from "../../shared/timber-version";
import { type TimberChoice, sameTimberChoice } from "../../shared/timber-choice";
import { TIMBER_PIN } from "../../shared/timber-pin";
import { type CommandEnding, actOutNew, actOutOpen, isCommandEnding } from "./mock-commands";
import { type RebaseEnding, actOutRebase, isRebaseEnding } from "./mock-rebase";
import { type SyncEnding, actOutSyncAction, isSyncEnding, withSampleTarget } from "./mock-sync";
import { type SyncActionRequest, isSyncActionKind, syncNotRun } from "../../shared/sync-actions";
import { actOutSetBase } from "./mock-base";
import { type PullRequestEnding, actOutPullRequest, isPullRequestEnding } from "./mock-pr";
import type { CreatePullRequestResult } from "../../shared/timber-pr";
import { type MockFileChange, derivedFileChanges, diffMockFileChange, listMockFileChanges } from "./mock-file-changes";
import { type MockWorktreeFile, createMockWorktreeFiles } from "./mock-worktree-files";
import { MOCK_PATH, type TerminalControls, createMockTerminals } from "./mock-terminals";
import { type AppUpdateInstallRequest, type AppUpdateState, UPDATES_FROM_SOURCE } from "../../shared/app-update";
import type { MockSessionStorage } from "./mock-session-storage";
import { type TimberConfigControls, createMockTimberConfig } from "./mock-timber-config";
import { type IssueTrackerControls, createMockIssueTrackers } from "./mock-issue-trackers";
import type { TimberConfigScope } from "../../shared/timber-config";
import { type WorkflowControls, createMockWorkflows } from "./mock-workflows";
import { type IssueControls, createMockIssues, sampleIssueLinks } from "./mock-issues";
import { type IssueListControls, createMockIssueLists } from "./mock-issue-lists";
import { type PullRequestControls, createMockPullRequests } from "./mock-pull-requests";
import { type BackupControls, createMockBackups } from "./mock-backups";
import { type ArenaControls, createMockArenas } from "./mock-arenas";
import { type ThemeFileControls, createMockThemeFiles } from "./mock-theme-files";
import type { ChopList } from "../../shared/chops";
import { type ChopsControls, createMockChops } from "./mock-chops";
import { type PortControls, createMockPorts } from "./mock-ports";

const inSync = (branch: string): SyncState => ({ kind: "tracking", upstream: `origin/${branch}`, ahead: 0, behind: 0 });

/** Pretend file names, so a sample can say how many files changed. */
const files = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}.ts`);

/** Sample changes with this many modified and untracked files. */
export const sampleChanges = (modified: number, untracked: number): Worktree["changes"] =>
	({ kind: "known", modified: files(modified, "src/changed"), untracked: files(untracked, "src/new") });

type SampleOverrides = Partial<Omit<Worktree, "id" | "path" | "canonicalPath" | "detached">>;

function worktree(repository: string, branch: string, overrides: SampleOverrides = {}): Worktree {
	const primary = overrides.primary ?? false;
	const path = primary ? `/work/${repository}` : `/work/${repository}-worktrees/${branch.replaceAll("/", "-")}`;
	const sample = {
		path,
		branch: branch as string | null,
		head: "0000000000000000000000000000000000000000",
		primary,
		locked: false,
		prunable: false,
		pathExists: true,
		changes: sampleChanges(0, 0),
		// As Timber does: the primary checkout has no saved base, and a worktree made with `timber new` has one.
		base: (primary ? { kind: "unassigned" } : { kind: "assigned", ref: "refs/remotes/origin/main" }) as SavedBase | null,
		// Most sample worktrees were made from a branch name, so they have no issue.
		issue: (sampleIssueLinks[`${repository} ${branch}`] ?? { kind: "none" }) as IssueLink | null,
		sync: inSync(branch) as SyncState | null,
		...overrides,
	};
	// As Timber does: a canonical path only for a folder whose status it could read.
	const canonicalPath = sample.pathExists && sample.changes.kind === "known" ? path : null;
	return { ...sample, sync: withSampleTarget(sample.sync), id: worktreeId(`/work/${repository}/.git`, { path, canonicalPath }), canonicalPath, detached: sample.branch === null };
}

/**
 * Sample data for the browser build and for tests. Together with
 * `sampleStatesRepository` it covers every state a row can show.
 */
export const sampleRepositories: Repository[] = [
	{
		path: "/work/timber",
		name: "timber",
		available: true,
		failure: null,
		setup: "repository",
		worktrees: [
			worktree("timber", "main", {
				primary: true,
				sync: { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 2 },
			}),
			worktree("timber", "feat/github-issue-lookup", {
				changes: sampleChanges(3, 1),
				sync: { kind: "tracking", upstream: "origin/feat/github-issue-lookup", ahead: 2, behind: 0 },
			}),
			worktree("timber", "fix/macos-portability", {
				sync: { kind: "tracking", upstream: "origin/fix/macos-portability", ahead: 3, behind: 3 },
			}),
			worktree("timber", "spike/new-idea", {
				changes: sampleChanges(0, 2),
				// Based on a local branch, which Timber saves by its full ref.
				base: { kind: "assigned", ref: "refs/heads/main" },
				sync: { kind: "unpublished" },
			}),
		],
	},
	{
		path: "/work/api-server",
		name: "api-server",
		available: true,
		failure: null,
		setup: "repository",
		worktrees: [
			worktree("api-server", "main", { primary: true }),
			worktree("api-server", "feat/rate-limit-headers", {
				// Added with plain Git, so Timber saved no base for it.
				base: { kind: "unassigned" },
				sync: { kind: "gone", upstream: "origin/feat/rate-limit-headers" },
			}),
			worktree("api-server", "old/removed-folder", {
				prunable: true,
				pathExists: false,
				changes: { kind: "unknown", reason: "Worktree path is missing" },
				sync: { kind: "unpublished" },
			}),
		],
	},
];

/**
 * A repository with the row states the two above do not have: a detached
 * HEAD, a locked worktree, a prunable one whose folder is still there, a
 * status Timber could not read, an upstream state Git could not read, saved
 * base metadata Timber cannot use, a record with no base at all, a base that
 * is a commit rather than a branch, and a row
 * with everything at once. The browser build lists it; most tests do not.
 */
export const sampleStatesRepository: Repository = {
	path: "/work/billing",
	name: "billing",
	available: true,
	failure: null,
	// Set up with the machine defaults only, which counts as set up.
	setup: "machine",
	worktrees: [
		worktree("billing", "main", { primary: true }),
		worktree("billing", "review-build", {
			branch: null,
			head: "4f9c2ab81d3e56f7a0b1c2d3e4f5a6b7c8d9e0f1",
			sync: null,
		}),
		// A record without the fields, as from a Timber before them: no base and no issue are shown.
		worktree("billing", "release/2.4", { locked: true, base: null, issue: null }),
		worktree("billing", "chore/moved-folder", {
			prunable: true,
			changes: { kind: "unknown", reason: "Path no longer identifies this Git worktree" },
		}),
		worktree("billing", "fix/unreadable", {
			changes: { kind: "unknown", reason: "Cannot inspect worktree; check directory access" },
			sync: { kind: "tracking", upstream: "origin/fix/unreadable", ahead: 1, behind: 0 },
		}),
		worktree("billing", "feat/invoices", {
			changes: sampleChanges(2, 0),
			base: { kind: "invalid", reason: "stale" },
			sync: null,
		}),
		worktree("billing", "hotfix/from-release", {
			// Based on a commit, which Timber saves by its full hash.
			base: { kind: "commit", commit: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432" },
			sync: { kind: "unpublished" },
		}),
		worktree("billing", "feat/tax-rules", {
			locked: true,
			changes: sampleChanges(12, 5),
			sync: { kind: "tracking", upstream: "origin/feat/tax-rules", ahead: 1, behind: 14 },
		}),
	],
};

/**
 * A repository after several pull requests merged, for Clean up merged
 * (issue 162). Its merged worktrees are: one clean with a deleted upstream,
 * one clean in step with its upstream, one with files that would be lost,
 * and one whose removal Timber refuses (`sampleRemovalRefusals`). One more
 * has a pull request that is still open, and the primary checkout has none.
 * The browser build lists it; most tests do not.
 */
export const sampleMergedRepository: Repository = {
	path: "/work/storefront",
	name: "storefront",
	available: true,
	failure: null,
	setup: "repository",
	worktrees: [
		worktree("storefront", "main", { primary: true }),
		worktree("storefront", "feat/coupons", { sync: { kind: "gone", upstream: "origin/feat/coupons" } }),
		worktree("storefront", "chore/ci-cache", { sync: { kind: "tracking", upstream: "origin/chore/ci-cache", ahead: 0, behind: 0 } }),
		worktree("storefront", "feat/cart-redesign", {
			changes: sampleChanges(2, 1),
			sync: { kind: "gone", upstream: "origin/feat/cart-redesign" },
		}),
		worktree("storefront", "fix/currency-rounding", { sync: { kind: "gone", upstream: "origin/fix/currency-rounding" } }),
		worktree("storefront", "feat/wishlist", { sync: { kind: "tracking", upstream: "origin/feat/wishlist", ahead: 0, behind: 0 } }),
	],
};

/**
 * Removals that Timber refuses in the sample, by worktree path, with its own
 * words: here the deleted upstream was seen again between preview and
 * removal. `refuseRemovals` changes them.
 */
export const sampleRemovalRefusals: Readonly<Record<string, string>> = {
	"/work/storefront-worktrees/fix-currency-rounding": "Live upstream state changed before removal; worktree and branch retained. Retry cleanup.",
};

/** A saved repository whose folder is gone. The browser build lists it; most tests do not. */
export const sampleUnavailableRepository: Repository = {
	path: "/work/old-prototype",
	name: "old-prototype",
	available: false,
	failure: null,
	setup: "unknown",
	worktrees: [],
};

/** What `bun run dev:web` lists: every row state, and a repository that is unavailable. */
export const browserSampleRepositories: Repository[] = [...sampleRepositories, sampleStatesRepository, sampleMergedRepository, sampleUnavailableRepository];

/**
 * A repository on the pretend disk that is not in the list yet. The mock's
 * folder picker chooses it by default. It was never set up for Timber, so
 * adding it shows the setup prompt.
 */
export const samplePickableRepository: Repository = {
	path: "/work/docs-site",
	name: "docs-site",
	available: true,
	failure: null,
	setup: "none",
	worktrees: [
		worktree("docs-site", "main", { primary: true }),
		worktree("docs-site", "feat/search", {
			changes: sampleChanges(1, 0),
			sync: { kind: "unpublished" },
		}),
	],
};

/**
 * Branches on the pretend disk that have no worktree yet, by repository path.
 * The mock's branch list offers them beside the branches of the worktrees.
 */
export const sampleSpareBranches: Record<string, BranchSuggestion[]> = {
	"/work/timber": [
		{ selector: "chore/update-deps", kind: "local" },
		{ selector: "origin/feat/config-reload", kind: "remote" },
		{ selector: "origin/release/0.2", kind: "remote" },
		// The head branches of the sample pull requests (./mock-issue-lists.ts).
		{ selector: "origin/feat/linked-issue-header", kind: "remote" },
		{ selector: "origin/fix/explain-arena", kind: "remote" },
		{ selector: "origin/TIM-80-saved-base", kind: "remote" },
	],
};

const byName = (one: BranchSuggestion, other: BranchSuggestion) => one.selector < other.selector ? -1 : one.selector > other.selector ? 1 : 0;

/** The branches the pretend Git knows in a repository: local ones first, as the real list has them. */
function branchesOf(repository: Repository): BranchSuggestion[] {
	const spare = sampleSpareBranches[repository.path] ?? [];
	const local = new Set(spare.filter(branch => branch.kind === "local").map(branch => branch.selector));
	const remote = new Set(spare.filter(branch => branch.kind === "remote").map(branch => branch.selector));
	for (const { branch, sync } of repository.worktrees) {
		if (branch !== null) local.add(branch);
		if (sync?.kind === "tracking") remote.add(sync.upstream);
	}
	return [
		...[...local].map((selector): BranchSuggestion => ({ selector, kind: "local" })).sort(byName),
		...[...remote].map((selector): BranchSuggestion => ({ selector, kind: "remote" })).sort(byName),
	];
}

/** Ignored files in the sample worktrees, by worktree path. The list of worktrees does not carry them. */
export const sampleIgnored: Readonly<Record<string, readonly string[]>> = {
	"/work/timber-worktrees/feat-github-issue-lookup": [".env.local", "dist/"],
	"/work/storefront-worktrees/feat-coupons": ["node_modules/", ".env.local"],
};

/** A stand-in for Timber's snapshot: 64 hexadecimal digits that change whenever the text does. */
function fingerprint(text: string): string {
	let digits = "";
	for (let round = 0; round < 8; round++) {
		let hash = 0x811c9dc5 ^ round;
		for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
		digits += (hash >>> 0).toString(16).padStart(8, "0");
	}
	return digits;
}

/** One sample of each state Timber can be found in. */
export const sampleTimberStatuses = {
	"ready": { state: "ready", source: "path", path: "/home/sam/.local/bin/timber", version: REQUIRED_TIMBER_VERSION },
	"not-found": { state: "not-found", source: "path", path: null },
	"too-old": { state: "too-old", source: "path", path: "/home/sam/.local/bin/timber", found: "0.1.0", required: REQUIRED_TIMBER_VERSION },
} as const satisfies Record<TimberStatus["state"], TimberStatus>;

/** The mock engine, plus the controls a test or the browser build uses to act out changes. */
/** The controls for terminals are in ./mock-terminals.ts. */
/** The controls for Timber's settings are in ./mock-timber-config.ts, for workflows in ./mock-workflows.ts, for issue trackers in ./mock-issue-trackers.ts, for pull requests in ./mock-pull-requests.ts, for issues in ./mock-issues.ts, for the issues board in ./mock-issue-lists.ts, for backups in ./mock-backups.ts, and for arenas in ./mock-arenas.ts. */
export interface MockEngine extends Engine, TerminalControls, TimberConfigControls, IssueTrackerControls, WorkflowControls, PullRequestControls, IssueControls, IssueListControls, BackupControls, ArenaControls, ThemeFileControls, ChopsControls, PortControls {
	/** Replace the data, without telling the interface. */
	setRepositories(repositories: Repository[]): void;
	/** Report that a repository changed, as the main process would. */
	announceChange(path: string): void;
	/** Report that the Timber status changed on its own, as the main process does when a newer release comes out. */
	announceTimberChange(): void;
	/** How many times the interface said it had drawn itself through `windowReady`. */
	readyCalls(): number;
	/** What the interface last said through `attend`, or null before it said anything. */
	attention(): Attention | null;
	/**
	 * The desktop notifications on screen as the main process would leave
	 * them, decided as it decides them: one per session, in the order they
	 * first showed, a newer one in its session's place, a withdrawn one gone.
	 */
	notices(): StatusNotice[];
	/** The sessions an alert sound played for, oldest first. */
	alertSounds(): string[];
	/** The sounds Settings played as a preview, oldest first. */
	previewSounds(): SoundChoice[];
	/** What the next sound file dialog answers: a path, or null for Cancel. */
	pickSoundFile(path: string | null): void;
	/** What the next sound preview answers. */
	endSoundPreviews(outcome: SoundOutcome["outcome"]): void;
	/** Act out the person clicking the desktop notification of a session. */
	clickNotice(session: string): void;
	/**
	 * Act out `timber new <name>` typed in one of the app's terminals, with a
	 * Timber that hands off: the worktree is made in the repository at
	 * `repository` (or the record names one that is not in the list), and the
	 * handoff is heard as from the main process, with `agent` as Timber's own
	 * agent setting. Answers the handoff, or null when Timber refused.
	 */
	typeTimberNew(repository: string, name: string, agent: boolean): WorktreeHandoff | null;
	/** Make every later read of repositories fail with this message, or pass null to let them work again. */
	failReads(message: string | null): void;
	/**
	 * Make Timber fail to list the worktrees of one repository, named by its
	 * primary checkout, with this diagnostic. Pass null to let it work again.
	 */
	failTimber(path: string, diagnostic: string | null): void;
	/**
	 * Decide what the folder picker answers from now on: a folder, or null for
	 * a picker closed without a choice. A folder counts as a repository when it
	 * is the path of a known repository or of one of its worktrees.
	 */
	pickFolder(folder: string | null): void;
	/**
	 * Decide how `timber new` and `timber open` end from now on: "succeeds"
	 * (the start), "refused", "ambiguous", "stops-after-create",
	 * "setup-fails", or "no-result". See ./mock-commands.ts for what each one
	 * acts out. "setup-fails" also makes the setup session that follows fail.
	 */
	endCommands(ending: CommandEnding): void;
	/**
	 * Decide how `timber rebase --result-file` ends from now on: "rebased"
	 * (the start), "up-to-date", "conflicts", "refused", "failed", or
	 * "no-result". A worktree with modified or untracked files is refused
	 * whatever the ending. See ./mock-rebase.ts for what each one acts out.
	 */
	endRebaseResults(ending: RebaseEnding): void;
	/**
	 * Decide how a sync action such as Pull ends from now on: "pulled" (the
	 * start), "fetch-failed", "diverged", "local-changes", or "failed". A branch
	 * that is ahead is refused as diverged whatever the ending. See
	 * ./mock-sync.ts for what each one acts out.
	 */
	endSyncActions(ending: SyncEnding): void;
	/** Every sync action asked for, in order. */
	syncActionRequests(): SyncActionRequest[];
	/**
	 * Decide how `timber pr --result-file` ends from now on: "created" (the
	 * start), "created-reviewer-failed" (the first reviewer cannot be
	 * requested), "exists", "refused", "failed-login", "failed-after-push", or
	 * "no-result". An empty title or an unusable reviewer is refused whatever
	 * the ending. Created and exists request the reviewers and put the pull
	 * request in the repository's answer, so the next read shows it with the
	 * requested ones. See ./mock-pr.ts for what each one acts out.
	 */
	endPullRequestResults(ending: PullRequestEnding): void;
	/** Decide the last commit's subject of one worktree, by its path. Null for one with no commit. Until then it is "Work on <branch>". */
	setHeadSubject(worktree: string, subject: string | null): void;
	/**
	 * Decide what the branch list of one repository answers from now on: these
	 * branches, or null for a list that cannot be read. Until then it answers
	 * with the branches of the worktrees and the spare sample branches.
	 */
	setBranches(path: string, branches: BranchSuggestion[] | null): void;
	/** Make every later save of the layout fail with this message, or pass null to let saves work again. */
	failLayoutSaves(message: string | null): void;
	/** Make every later save of the preferences fail with this message, or pass null to let saves work again. */
	failPreferenceSaves(message: string | null): void;
	/**
	 * Change the files of one worktree, named by its path, without telling the
	 * interface: a dirty worktree for the Done dialog. Lists that are left out
	 * stay as they are. Called while that dialog is open, it is a change
	 * between preview and Remove, which the removal then refuses.
	 */
	setChanges(path: string, files: { modified?: string[]; untracked?: string[]; ignored?: string[] }): void;
	/**
	 * Make every later preview expire this many milliseconds after it was
	 * made, in place of ten minutes. Pass null for ten minutes again.
	 */
	expirePreviewsAfter(milliseconds: number | null): void;
	/**
	 * Act out a partial failure: while true, a removal deletes the folder, so
	 * the worktree leaves the list, and then fails to delete the branch.
	 */
	failBranchDeletion(fail: boolean): void;
	/** How long a removal takes from now on, to look at the running state. */
	setDoneDelay(milliseconds: number): void;
	/**
	 * Make Timber refuse every later removal of the worktree at this path,
	 * after the preview, with this diagnostic, or pass null to let it work.
	 * The worktree stays. Starts from `sampleRemovalRefusals`.
	 */
	refuseRemovals(path: string, diagnostic: string | null): void;
	/**
	 * Decide how "Open in editor" ends from now on, for an editor that is set
	 * and a worktree that is listed: "opens" (the start), "not-found" (the
	 * executable is not on the PATH), or "fails" (the editor stops right away
	 * with an error).
	 */
	endEditorLaunches(ending: EditorEnding): void;
	/**
	 * Decide how uninstalling goes from now on: it works, it works but the
	 * settings cannot be deleted, the uninstaller fails, or this copy was
	 * never installed. Nothing is removed and the mock never quits.
	 */
	endUninstalls(ending: UninstallEnding): void;
	/** Every uninstall the mock acted out, oldest first. */
	uninstallRequests(): UninstallRequest[];
	/**
	 * Decide how restarting goes from now on: "restarts" (the start), "fails"
	 * (something keeps the app open), or "unavailable" (this copy cannot
	 * restart itself). Nothing quits: a restart is only counted.
	 */
	endRestarts(ending: RestartEnding): void;
	/** How many restarts the mock acted out. */
	restartCount(): number;
	/**
	 * Decide what a look for an app update finds from now on: "up-to-date"
	 * (the start), "update" (version 0.2.0, which downloads at once),
	 * "offline", or "unavailable" (a copy run from source).
	 */
	endAppUpdateChecks(ending: AppUpdateEnding): void;
	/** Every restart into an update the mock acted out, oldest first. Nothing quits. */
	appUpdateInstalls(): AppUpdateInstallRequest[];
	/** Make every later restart into an update fail with this message, as the main process says it, or pass null to let them work again. */
	failAppUpdateInstalls(message: string | null): void;
	/** Every editor the mock acted out starting, oldest first. */
	launchedEditors(): { request: OpenInEditorRequest; command: string }[];
	/**
	 * Decide what the Changes tab of one worktree, named by its path, lists
	 * from now on, each file with the text Git would print for it. Pass null
	 * to go back to files made up from the worktree's modified and untracked
	 * files. The interface is not told.
	 */
	setFileChanges(path: string, files: MockFileChange[] | null): void;
	/** Make every later read of changed files and diffs fail with this message, or pass null to let them work again. */
	failFileChanges(message: string | null): void;
	/**
	 * Put a file on the pretend disk of the worktree at `worktree`, for the
	 * file viewer: its text, bytes that are not text, or a folder. Pass null
	 * to remove it, so the viewer says it is missing. `failFileChanges` makes
	 * these reads fail too.
	 */
	setWorktreeFile(worktree: string, path: string, file: MockWorktreeFile | null): void;
	/** The text of a file on the pretend disk, as a save left it, or null when it is not text there. */
	readWorktreeFileNow(worktree: string, path: string): string | null;
	/** Make every later save of a file take this long, to see the File tab while it saves. */
	delayFileSaves(milliseconds: number): void;
	/** How many files the window last said hold unsaved edits (`reportUnsavedFiles`). */
	unsavedFilesReported(): number;
	/**
	 * Decide how fetches end from now on: "fetches" (the start), or failing as
	 * "offline", "authentication", or "failed". The mock fetches nothing in the
	 * background; only Fetch now runs one.
	 */
	endFetches(ending: FetchEnding): void;
	/** How long a fetch takes from now on, to look at the running state. */
	setFetchDelay(milliseconds: number): void;
	/**
	 * Act out a fetch that found the upstream of `branch` rewritten in the
	 * repository at `path`: its worktree shows as force-pushed and behind, and
	 * the interface is told. Answers the mark's `at`, or null when no worktree
	 * of that repository is on that branch.
	 */
	forcePush(path: string, branch: string): number | null;
	/** Every force-push the interface said the person saw, oldest first. */
	seenForcePushes(): ForcePushSeen[];
}

export const FETCH_ENDINGS = ["fetches", "offline", "authentication", "failed"] as const;
export type FetchEnding = typeof FETCH_ENDINGS[number];

/** What a failed fetch prints, in the mock, for each way it can fail. */
const MOCK_FETCH_FAILURES: Record<FetchFailureKind, string> = {
	offline: "fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com",
	authentication: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
	failed: "fatal: 'origin' does not appear to be a git repository\nfatal: Could not read from remote repository.",
};

export const EDITOR_ENDINGS = ["opens", "not-found", "fails"] as const;
export type EditorEnding = typeof EDITOR_ENDINGS[number];

export const RESTART_ENDINGS = ["restarts", "fails", "unavailable"] as const;
export type RestartEnding = typeof RESTART_ENDINGS[number];

export const APP_UPDATE_ENDINGS = ["up-to-date", "update", "offline", "unavailable"] as const;
export type AppUpdateEnding = typeof APP_UPDATE_ENDINGS[number];

/** The newer release the mock finds. */
export const MOCK_APP_UPDATE_VERSION = "0.2.0";

export const UNINSTALL_ENDINGS = ["uninstalls", "keeps-settings", "fails", "unavailable"] as const;
export type UninstallEnding = typeof UNINSTALL_ENDINGS[number];

/** An installed copy, as the main process would describe it. */
export const sampleUninstallPlan: AvailableUninstallPlan = {
	available: true,
	command: ["/home/sam/.local/share/com.codingm8s.timber-app/stable/uninstall", ...UNINSTALL_ARGUMENTS],
	removes: [
		"/home/sam/.local/share/com.codingm8s.timber-app/stable",
		"/home/sam/.cache/com.codingm8s.timber-app/stable",
		"/home/sam/.local/share/applications/Timber.desktop",
		"/home/sam/Desktop/Timber.desktop",
	],
	settingsFolder: "/home/sam/.config/timber-app",
};

export interface MockEngineOptions {
	/** How long an acted `timber new` or `timber open` takes. None by default; the browser build waits, so the running state shows. */
	commandMilliseconds?: number;
	/** Where the mock keeps the open sessions between runs. A second engine made with the same storage is the app after a restart. Memory of its own when left out. */
	savedSessions?: MockSessionStorage;
	/** How long an acted openTerminal takes. None by default. */
	terminalMilliseconds?: number;
}

/** A command the mock did not act out, with the reason. */
function notRun(diagnostic: string): WorktreeCommandResult {
	return { outcome: "failed", failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null }, worktree: null, created: false, setupSkipped: false };
}

/** Timber's order: the primary checkout first, then by path. */
function inTimberOrder(worktrees: Worktree[]): Worktree[] {
	return [...worktrees].sort((a, b) => Number(b.primary) - Number(a.primary) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Where the mock app's bundled Timber is. */
export const MOCK_BUNDLED_TIMBER = "/opt/Timber/Resources/app/timber/timber";

/** What looking for Timber finds with each choice in Settings, Timber, Executable, when every Timber answers. */
export function mockTimberFor(choice: TimberChoice): TimberStatus {
	switch (choice.kind) {
		case "bundled":
			return { state: "ready", source: "bundled", path: MOCK_BUNDLED_TIMBER, version: TIMBER_PIN.version };
		case "path":
			return sampleTimberStatuses.ready;
		case "file":
			return { state: "ready", source: "setting", path: choice.path, version: TIMBER_PIN.version };
	}
}

/**
 * `timber` is the answer to every look for Timber. Pass a function to change
 * the answer between looks, for example to act out an install before Retry.
 * Without it, the answer follows the saved Timber choice (`mockTimberFor`).
 */
export function createMockEngine(
	repositories: Repository[] = sampleRepositories,
	timber?: TimberStatus | (() => TimberStatus),
	options: MockEngineOptions = {},
): MockEngine {
	let current = repositories;
	let failure: string | null = null;
	const timberFailures = new Map<string, string>();
	// As the main process does: a failed listing brings the diagnostic and no worktrees.
	const asRead = (repository: Repository): Repository => {
		const diagnostic = timberFailures.get(repository.path);
		return diagnostic === undefined || !repository.available ? repository : { ...repository, failure: diagnostic, setup: "unknown", worktrees: [] };
	};
	let picked: string | null = samplePickableRepository.path;
	// Everything on the pretend disk: whatever was ever listed, plus one repository to add.
	const onDisk = new Map<string, Repository>([samplePickableRepository, ...repositories].map(repository => [repository.path, repository]));
	const owns = (repository: Repository, folder: string) =>
		repository.path === folder || repository.worktrees.some(candidate => candidate.path === folder);
	const add = (): AddRepositoryResult => {
		const folder = picked;
		if (folder === null) return { outcome: "cancelled" };
		const listed = current.find(repository => owns(repository, folder));
		if (listed) return { outcome: "already-listed", repository: listed.path };
		const found = [...onDisk.values()].find(repository => repository.available && owns(repository, folder));
		if (!found) return { outcome: "not-a-repository", folder };
		current = [...current, found];
		return { outcome: "added", repository: found };
	};
	// The groups live in memory too, beside the list, by the same rules as the main process. None to start with.
	let groups: RepositoryGroup[] = [];
	let membership: Record<string, string> = {};
	let groupIds = 0;
	const groupedList = (): GroupedList<{ path: string; group?: string }> => ({
		groups,
		repositories: current.map(({ path }) => (Object.hasOwn(membership, path) ? { path, group: membership[path]! } : { path })),
	});
	const changeGroups = async (change: (list: GroupedList<{ path: string; group?: string }>) => GroupChange<{ path: string; group?: string }>): Promise<RepositoryGroupsResult> => {
		const changed = change(groupedList());
		if (changed.outcome === "changed") {
			groups = changed.next.groups;
			membership = groupsOfList(changed.next).membership;
			current = applyOrder(current, changed.next.repositories.map(entry => entry.path));
		} else if (changed.outcome !== "unchanged") {
			return changed;
		}
		return { outcome: "saved", groups: groupsOfList(groupedList()) };
	};
	// The layout lives in memory, for as long as this engine does.
	let layout: Layout = defaultLayout();
	let layoutFailure: string | null = null;
	// So do the preferences.
	let preferences: Preferences = defaultPreferences();
	let preferencesFailure: string | null = null;
	const listeners = new Set<(path: string) => void>();
	// The mock watches nothing: changes are acted out with `announceChange`. It only keeps what it was told.
	let attended: Attention | null = null;
	let unsaved = 0;
	let ready = 0;
	const notices: StatusNotice[] = [];
	const alertSounds: string[] = [];
	const previews: SoundChoice[] = [];
	let pickedSound: string | null = "/home/me/sounds/bell.ogg";
	let previewEnding: SoundOutcome["outcome"] = "played";
	const showSessionListeners = new Set<(id: string) => void>();
	const handoffListeners = new Set<(handoff: WorktreeHandoff) => void>();

	// Fetching, acted out: Fetch now only, ended as `fetchEnding` says. Nothing reaches a network.
	const fetches = new Map<string, RepositoryFetch>();
	const fetchListeners = new Set<(status: RepositoryFetch) => void>();
	const timberListeners = new Set<() => void>();
	const currentTimber = (): TimberStatus => timber === undefined ? mockTimberFor(preferences.timber) : typeof timber === "function" ? timber() : timber;
	let fetchEnding: FetchEnding = "fetches";
	let fetchDelay = 0;
	const running = new Map<string, Promise<FetchResult>>();
	const seen: ForcePushSeen[] = [];
	const fetchOf = (path: string): RepositoryFetch => fetches.get(path) ?? { repository: path, fetching: false, lastFetched: null, failure: null };
	const tellFetch = (status: RepositoryFetch) => {
		fetches.set(status.repository, status);
		for (const listener of [...fetchListeners]) listener(structuredClone(status));
	};
	const announce = (path: string) => {
		for (const listener of [...listeners]) listener(path);
	};
	/** Change the sync state of every worktree of `path` on `branch`. Answers whether one was there. */
	const changeSync = (path: string, branch: string, change: (sync: SyncState | null) => SyncState | null): boolean => {
		let found = false;
		current = current.map(repository => repository.path !== path ? repository : {
			...repository,
			worktrees: repository.worktrees.map(candidate => {
				if (candidate.branch !== branch) return candidate;
				found = true;
				return { ...candidate, sync: change(candidate.sync) };
			}),
		});
		return found;
	};

	// The Done dialog. As in the main process, what a preview printed stays here and the interface gets a name for it.
	const ignored = new Map<string, readonly string[]>(Object.entries(sampleIgnored));
	const heldPreviews = new Map<string, { text: string; repository: string; path: string; options: DoneOptions; expiresAt: number }>();
	let lastPreview = 0;
	let previewLifetime: number | null = null;
	let branchDeletionFails = false;
	let doneDelay = 0;
	const removalRefusals = new Map<string, string>(Object.entries(sampleRemovalRefusals));

	/**
	 * What Timber would print for a preview right now, or why there is none.
	 * `ran` is false when the app itself stopped before running Timber.
	 */
	const previewRecord = (repositoryPath: string, path: string, options: DoneOptions): { text: string } | { refused: string; ran?: false } => {
		const status = currentTimber();
		if (status.state !== "ready") return { refused: "Timber is not ready. Nothing was run.", ran: false };
		const repository = current.find(candidate => candidate.path === repositoryPath);
		if (!repository) return { refused: `${repositoryPath} is not a repository in this app's list. Nothing was run.`, ran: false };
		const target = asRead(repository).worktrees.find(candidate => candidate.path === path);
		if (!target) return { refused: `Timber lists no worktree at ${path} in ${repositoryPath}. Nothing was run. Refresh the list.`, ran: false };
		// From here on Timber runs, and the words are its own.
		if (target.primary) return { refused: "Select an existing linked worktree; the primary worktree cannot be removed." };
		if (target.locked) return { refused: `Worktree at ${path} is locked; unlock it explicitly before cleanup.` };
		if (target.changes.kind !== "known") return { refused: "Cannot verify worktree file status." };
		const ignoredHere = ignored.get(path) ?? [];
		if (options.keepIgnored && ignoredHere.length > 0) return { refused: "Ignored files exist. Move them out of the worktree or choose to discard ignored files." };
		if (options.base !== null && !repository.worktrees.some(candidate => candidate.branch === options.base)) {
			return { refused: `Base branch ${options.base} is missing or ambiguous. Select an exact branch.` };
		}
		if (!options.keepBranch && target.branch !== null && target.branch === options.base) return { refused: "The cleanup target is the base branch and cannot be deleted." };
		const record = {
			repository: { commonGitDir: `${repository.path}/.git`, primaryWorktreeRoot: repository.path, currentWorktreeRoot: repository.path },
			worktree: {
				path, branch: target.branch, head: target.head, isPrimary: false, locked: null, prunable: null, pathExists: true,
				status: { kind: "known", modified: target.changes.modified, untracked: target.changes.untracked, ignored: ignoredHere },
				canonicalPath: target.canonicalPath ?? path, detached: target.detached,
			},
			options: { keepBranch: options.keepBranch, discardIgnored: !options.keepIgnored, ...(options.base === null ? {} : { base: options.base }) },
		};
		const expiresAt = Date.now() + (previewLifetime ?? DONE_PREVIEW_MINUTES * 60_000);
		return { text: `${JSON.stringify({ schemaVersion: 1, snapshot: fingerprint(JSON.stringify(record)), expiresAt, ...record })}\n` };
	};
	const snapshotOf = (text: string): unknown => (JSON.parse(text) as { snapshot: unknown }).snapshot;

	const previewDone = (repositoryPath: string, path: string, options: DoneOptions): DonePreviewResult => {
		const command = describeDonePreview(path, options);
		const printed = previewRecord(repositoryPath, path, options);
		if ("refused" in printed) return { outcome: "failed", failure: { command: printed.ran === false ? null : command, diagnostic: printed.refused, output: null } };
		// Read exactly as the main process reads what the real Timber prints.
		const reading = readDonePreview(printed.text);
		if (!reading.ok) return { outcome: "failed", failure: { command, diagnostic: reading.message, output: null } };
		const id = `mock-preview-${++lastPreview}`;
		heldPreviews.set(id, { text: printed.text, repository: repositoryPath, path, options, expiresAt: reading.preview.expiresAt });
		return { outcome: "previewed", id, preview: reading.preview };
	};

	const applyDone = (repositoryPath: string, path: string, id: string): DoneApplyResult => {
		const refused = (diagnostic: string): DoneApplyResult => ({ outcome: "failed", ran: false, failure: { command: null, diagnostic, output: null } });
		const approved = heldPreviews.get(id);
		heldPreviews.delete(id);
		if (!approved) return refused("The app no longer holds that preview, so there is nothing to approve. Nothing was run. Ask for a new preview.");
		if (approved.repository !== repositoryPath || approved.path !== path) return refused(`That preview is for ${approved.path}, not for ${path}. Nothing was run. Ask for a new preview.`);
		if (approved.expiresAt <= Date.now()) return refused("The preview expired. Nothing was run. Ask for a new preview.");

		// What Timber would write to its result file, read exactly as the main process reads the real one.
		const command = describeDoneApply(path);
		const approvedRecord = JSON.parse(approved.text) as { repository: unknown; worktree: { branch: string | null; head: string | null } };
		const ended = (diagnostic: string | null, printed: string): DoneApplyResult => {
			const exitCode = diagnostic === null ? 0 : 1;
			const text = JSON.stringify({
				schemaVersion: 1, command: "done", outcome: diagnostic === null ? "succeeded" : "failed", exitCode,
				repository: approvedRecord.repository, worktree: approvedRecord.worktree, materialized: false, diagnostic,
			});
			const failure = failureOf({ command, result: readTimberResult("done", text, exitCode), output: { text: printed, truncated: false } });
			return failure ? { outcome: "failed", ran: true, failure } : { outcome: "removed" };
		};
		const now = previewRecord(repositoryPath, path, approved.options);
		if ("refused" in now) return now.ran === false ? refused(now.refused) : ended(now.refused, `error: ${now.refused}\n`);
		if (snapshotOf(now.text) !== snapshotOf(approved.text)) {
			const changed = "Worktree, files, settings or repository changed. Review the updated preview before removing.";
			return ended(changed, `error: ${changed}\n`);
		}

		const refusal = removalRefusals.get(path);
		if (refusal !== undefined) return ended(refusal, `error: ${refusal}\n`);

		// The folder goes, and with it the worktree's place in the list.
		current = current.map(repository => repository.path === repositoryPath
			? { ...repository, worktrees: repository.worktrees.filter(candidate => candidate.path !== path) }
			: repository);
		ignored.delete(path);
		const { branch, head } = approvedRecord.worktree;
		if (branchDeletionFails && branch !== null && !approved.options.keepBranch) {
			const partial = `The worktree was removed from ${path}, but local branch ${branch} was not deleted: Could not conditionally delete local branch ${branch}. Local branch ${branch} was retained at ${head}. Inspect the branch and retry cleanup.`;
			return ended(partial, `error: ${partial}\n`);
		}
		return ended(null, `Removed worktree at ${path}\n`);
	};

	// "Open in editor", acted out with the same checks as the main process, and nothing started.
	let editorEnding: EditorEnding = "opens";
	let uninstallEnding: UninstallEnding = "uninstalls";
	const uninstalls: UninstallRequest[] = [];
	let restartEnding: RestartEnding = "restarts";
	let restarts = 0;
	let appUpdateEnding: AppUpdateEnding = "up-to-date";
	let appUpdate: AppUpdateState = { kind: "idle" };
	const appUpdateListeners = new Set<(state: AppUpdateState) => void>();
	const appUpdateRequests: AppUpdateInstallRequest[] = [];
	let appUpdateInstallFailure: string | null = null;
	const setAppUpdate = (next: AppUpdateState) => {
		appUpdate = next;
		for (const listener of [...appUpdateListeners]) listener(next);
	};
	/** What a look finds, told the way the main process tells it: checking first, then the answer. */
	const lookForAppUpdate = async () => {
		if (appUpdateEnding === "unavailable") return setAppUpdate({ kind: "unavailable", reason: UPDATES_FROM_SOURCE });
		setAppUpdate({ kind: "checking" });
		await Promise.resolve();
		if (appUpdateEnding === "offline") return setAppUpdate({ kind: "failed", stage: "check", message: "Unable to connect. Is the computer able to access the url?" });
		if (appUpdateEnding === "up-to-date") return setAppUpdate({ kind: "up-to-date", checkedAt: Date.now() });
		setAppUpdate({ kind: "downloading", version: MOCK_APP_UPDATE_VERSION });
		await Promise.resolve();
		setAppUpdate({ kind: "ready", version: MOCK_APP_UPDATE_VERSION });
	};
	const NOT_RESTARTABLE = "This copy of the app runs from source in /home/sam/timber-app, so it cannot restart itself. Quit it and run the command again to use the saved setting.";
	const NOT_INSTALLED = "This copy of the app was not installed, so there is nothing to uninstall. It runs from /home/sam/timber-app.";
	const launches: { request: OpenInEditorRequest; command: string }[] = [];
	const openInEditor = (request: OpenInEditorRequest): OpenInEditorResult => {
		const { editor } = preferences;
		if (editor === null) return { outcome: "not-configured" };
		const repository = current.find(candidate => candidate.path === request.repository);
		if (!repository) return { outcome: "not-listed", message: `${request.repository} is not a repository in this app's list. No editor was started.` };
		if (!repository.available) return { outcome: "not-listed", message: `Git cannot read the repository at ${request.repository}. No editor was started.` };
		const read = asRead(repository);
		if (read.failure !== null) return { outcome: "not-listed", message: `Timber could not list the worktrees of ${request.repository}, so no editor was started: ${read.failure}` };
		const target = read.worktrees.find(candidate => candidate.path === request.worktree);
		if (!target) return { outcome: "not-listed", message: `Timber lists no worktree at ${request.worktree} in ${request.repository}. No editor was started. Refresh the list.` };
		if (!target.pathExists) return { outcome: "not-listed", message: `The folder ${request.worktree} is missing. No editor was started.` };
		const opened = editorTarget(request.worktree, request.file);
		if (!opened.ok) return { outcome: "failed", command: null, message: `${opened.message} No editor was started.` };
		const built = editorCommand(editor, opened.path);
		if (!built.ok) return { outcome: "failed", command: null, message: `${built.message} Change it in Settings, Editor.` };
		const command = describeCommandLine([built.executable, ...built.arguments]);
		if (editor.terminal) return { outcome: "terminal-editor", command, message: TERMINAL_EDITOR_REASON };
		switch (editorEnding) {
			case "not-found":
				return {
					outcome: "not-found", command, executable: built.executable,
					message: `Could not start the editor. ${notFoundOnPath([built.executable, ...otherExecutableNames(built.executable)], MOCK_PATH, ":")} A change to PATH needs a restart of the app, or use the full path in Settings, Editor.`,
				};
			case "fails":
				return { outcome: "failed", command, message: "The editor exited with code 1 right after it started. Try the command in a terminal to see why." };
			case "opens":
				launches.push({ request: structuredClone(request), command });
				return { outcome: "opened", command };
		}
	};

	// The Changes tab, read from the pretend files with the same checks as the main process.
	const fileChangeLists = new Map<string, MockFileChange[]>();
	let fileChangeFailure: string | null = null;
	type Listed = { ok: true; worktree: Worktree } | { ok: false; outcome: "not-listed" | "failed"; message: string };
	const listedForChanges = (repositoryPath: string, worktreePath: string): Listed => {
		const notListed = (message: string): Listed => ({ ok: false, outcome: "not-listed", message: `${message} No changes were read.` });
		if (fileChangeFailure !== null) return { ok: false, outcome: "failed", message: fileChangeFailure };
		const repository = current.find(candidate => candidate.path === repositoryPath);
		if (!repository) return notListed(`${repositoryPath} is not a repository in this app's list.`);
		if (!repository.available) return notListed(`Git cannot read the repository at ${repositoryPath}.`);
		const read = asRead(repository);
		if (read.failure !== null) return { ok: false, outcome: "not-listed", message: `Timber could not list the worktrees of ${repositoryPath}, so no changes were read: ${read.failure}` };
		const target = read.worktrees.find(candidate => candidate.path === worktreePath);
		if (!target) return notListed(`Timber lists no worktree at ${worktreePath} in ${repositoryPath}.`);
		if (!target.pathExists) return notListed(`The folder ${worktreePath} is missing.`);
		return { ok: true, worktree: target };
	};
	const filesOf = (worktree: Worktree) => fileChangeLists.get(worktree.path) ?? derivedFileChanges(worktree);
	const worktreeFiles = createMockWorktreeFiles();
	let writeDelay = 0;
	const chopFiles = createMockChops();
	/** As the main process: a repository in the list, its main checkout's file. The mock's main checkouts are always there. */
	const listMockChops = (repositoryPath: string): ChopList => {
		const repository = current.find(candidate => candidate.path === repositoryPath);
		if (!repository) return { outcome: "not-listed", message: `${repositoryPath} is not a repository in this app's list. No chops were read.` };
		// As when the main checkout's folder is missing: Git cannot read it.
		if (!repository.available) return { outcome: "not-listed", message: `The folder of the main checkout, ${repositoryPath}, cannot be read. No chops were read.` };
		return chopFiles.list(repositoryPath, preferences.chops);
	};
	const portReader = createMockPorts();

	const look = async () => structuredClone(currentTimber());
	const read = async <Result>(result: () => Result): Promise<Result> => {
		if (failure !== null) throw new Error(failure);
		return structuredClone(result());
	};
	let ending: CommandEnding = "succeeds";
	let rebaseEnding: RebaseEnding = "rebased";
	let syncEnding: SyncEnding = "pulled";
	const syncRequests: SyncActionRequest[] = [];
	let pullRequestEnding: PullRequestEnding = "created";
	const headSubjects = new Map<string, string | null>();
	const branchLists = new Map<string, BranchSuggestion[] | null>();
	const listedBranches = (repository: Repository) =>
		branchLists.has(repository.path) ? branchLists.get(repository.path)! : branchesOf(repository);
	const { commandMilliseconds = 0 } = options;
	// As the main process does: only with a usable Timber, and only in a repository from the list.
	const command = async (path: string, act: (repository: Repository) => { result: WorktreeCommandResult; created: Worktree | null; replaced?: Worktree }): Promise<WorktreeCommandResult> => {
		if (commandMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, commandMilliseconds));
		if ((await look()).state !== "ready") return notRun("Timber is not ready.");
		const repository = current.find(candidate => candidate.path === path && candidate.available);
		if (!repository) return notRun(`${path} is not a repository in the app's list.`);
		const { result, created, replaced } = act(repository);
		if (created || replaced) {
			const kept = repository.worktrees.map(worktree => (replaced && worktree.path === replaced.path ? replaced : worktree));
			const changed = { ...repository, worktrees: inTimberOrder(created ? [...kept, created] : kept) };
			current = current.map(candidate => candidate === repository ? changed : candidate);
			onDisk.set(path, changed);
		}
		return structuredClone(result);
	};
	/**
	 * A save through Timber's settings commands sets a repository up: the
	 * repository's own settings, as Timber writes its `.timber.toml`, or the
	 * machine defaults, which every repository with none of its own then has.
	 */
	const saveSetup = (scope: TimberConfigScope, path: string | null) => {
		const saved = (repository: Repository): Repository =>
			scope === "repository" ? (repository.path === path ? { ...repository, setup: "repository" } : repository)
				: repository.setup === "none" ? { ...repository, setup: "machine" } : repository;
		current = current.map(saved);
		for (const [key, repository] of onDisk) onDisk.set(key, saved(repository));
	};
	// As the main process does: only a worktree listed right now, whose folder is there.
	const { attendSessions, ...terminals } = createMockTerminals((path, worktreePath) => {
		const repository = current.find(candidate => candidate.path === path && candidate.available);
		const worktree = timberFailures.has(path) ? undefined : repository?.worktrees.find(candidate => candidate.path === worktreePath);
		return worktree && worktree.pathExists ? worktree : null;
	}, () => preferences.agents, () => currentTimber(), () => preferences.sessionNames, (...asked) => arenas.arenaLaunch(...asked),
	// Read when a workflow's agent starts, as the main process reads Timber's settings again then.
	repository => workflows.listWorkflows(repository), {
		...(options.savedSessions ? { savedSessions: options.savedSessions } : {}),
		...(options.terminalMilliseconds ? { terminalMilliseconds: options.terminalMilliseconds } : {}),
		unsavedFiles: () => unsaved,
	});
	// As the main process does, every change is weighed for a desktop notification and a sound, which are only kept here.
	const alertSettings = (): AlertSettings => ({ notify: preferences.statusNotifications, notifyStates: preferences.notifyStates, soundStates: preferences.soundStates });
	const alerts = createAlertRunner({
		attention: () => attended ?? assumedAttention,
		settings: alertSettings,
		act: action => {
			if (action.kind === "sound") alertSounds.push(action.session);
			else if (action.kind === "withdraw") {
				const at = notices.findIndex(notice => notice.session === action.session);
				if (at !== -1) notices.splice(at, 1);
			} else {
				const at = notices.findIndex(notice => notice.session === action.notice.session);
				if (at === -1) notices.push(action.notice);
				else notices[at] = action.notice;
				if (action.sound) alertSounds.push(action.notice.session);
			}
		},
	});
	terminals.onTerminalChanged(change => alerts.changed(change));
	const timberConfig = createMockTimberConfig(path => current.some(repository => repository.path === path), () => currentTimber(), saveSetup);
	const { workflowNames, ...workflows } = createMockWorkflows(path => current.some(repository => repository.path === path), () => currentTimber());
	const pullRequests = createMockPullRequests(path => current.find(repository => repository.path === path && repository.available), () => currentTimber());
	const issues = createMockIssues(path => current.find(repository => repository.path === path && repository.available), () => currentTimber());
	const issueLists = createMockIssueLists(path => current.find(repository => repository.path === path && repository.available), () => currentTimber());
	const backups = createMockBackups({
		listed: path => current.find(repository => repository.path === path && repository.available),
		timber: () => currentTimber(),
		// As `git worktree add -b` would: the recovery worktree is listed from now on, in Timber's order.
		addWorktree: (repositoryPath, path, branch) => {
			current = current.map(repository => repository.path !== repositoryPath ? repository : {
				...repository,
				worktrees: inTimberOrder([...repository.worktrees, {
					id: worktreeId(`${repositoryPath}/.git`, { path, canonicalPath: path }),
					path, canonicalPath: path, branch, head: "1111111111111111111111111111111111111111",
					primary: false, detached: false, locked: false, prunable: false, pathExists: true,
					changes: { kind: "known", modified: [], untracked: [] }, base: { kind: "unassigned" }, sync: { kind: "unpublished" }, issue: null,
				}]),
			});
		},
		delay: () => options.commandMilliseconds ?? 0,
	});
	const arenas = createMockArenas({
		listed: path => current.find(repository => repository.path === path && repository.available),
		timber: () => currentTimber(),
		// As Timber's `git worktree add -b` would: each attempt is listed from now on, in Timber's order.
		addWorktree: (repositoryPath, path, branch) => {
			current = current.map(repository => repository.path !== repositoryPath ? repository : {
				...repository,
				worktrees: inTimberOrder([...repository.worktrees, {
					id: worktreeId(`${repositoryPath}/.git`, { path, canonicalPath: path }),
					path, canonicalPath: path, branch, head: "2222222222222222222222222222222222222222",
					primary: false, detached: false, locked: false, prunable: false, pathExists: true,
					changes: { kind: "known", modified: [], untracked: [] }, base: { kind: "unassigned" }, sync: { kind: "unpublished" }, issue: null,
				}]),
			});
		},
		removeWorktree: (repositoryPath, path) => {
			current = current.map(repository => repository.path === repositoryPath ? { ...repository, worktrees: repository.worktrees.filter(candidate => candidate.path !== path) } : repository);
		},
		endSessionsIn: async paths => {
			const inThem = async () => (await terminals.listTerminals()).filter(session => paths.includes(session.path));
			await Promise.all((await inThem()).map(session => terminals.closeTerminal(session.id)));
			return (await inThem()).filter(session => session.state.kind === "running").map(session => session.name);
		},
		delay: () => options.commandMilliseconds ?? 0,
	});
	return {
		...terminals,
		...arenas,
		...timberConfig,
		...createMockThemeFiles(),
		...workflows,
		...createMockIssueTrackers(request => timberConfig.readTimberSettings(request)),
		...pullRequests,
		...issues,
		...issueLists,
		...backups,
		// As a Linux machine where Auto left the renderer on.
		appInfo: async () => ({ version: APP_VERSION, rendering: { applies: true, dmabuf: true, decidedBy: "auto", choice: "auto" } }),
		timberStatus: look,
		recheckTimber: look,
		onTimberChanged(listener) {
			timberListeners.add(listener);
			return () => void timberListeners.delete(listener);
		},
		announceTimberChange() {
			for (const listener of [...timberListeners]) listener();
		},
		listRepositories: () => read(() => current.map(asRead)),
		loadRepository: path => read(() => {
			const found = current.find(repository => repository.path === path && repository.available);
			return found ? asRead(found) : null;
		}),
		addRepository: async () => structuredClone(add()),
		async removeRepository(path) {
			current = current.filter(repository => repository.path !== path);
			layout = forgetRepository(layout, path);
			// Its group stays, as it does on disk.
			delete membership[path];
			return { outcome: "removed" };
		},
		async reorderRepositories(order) {
			current = applyOrder(current, order);
			return { outcome: "saved" };
		},
		listRepositoryGroups: async () => groupsOfList(groupedList()),
		async createRepositoryGroup(name, repository) {
			// Numbered in the order they are made: an id is used up only by a group that was made.
			const id = `group-${groupIds + 1}`;
			const result = await changeGroups(list => createGroupIn(list, id, name, repository));
			if (result.outcome === "saved") groupIds++;
			return result;
		},
		renameRepositoryGroup: (id, name) => changeGroups(list => renameGroupIn(list, id, name)),
		async deleteRepositoryGroup(id) {
			const result = await changeGroups(list => deleteGroupIn(list, id));
			layout = forgetGroup(layout, id);
			return result;
		},
		reorderRepositoryGroups: order => changeGroups(list => reorderGroupsIn(list, order)),
		placeRepository: (path, group, order) => changeGroups(list => placeIn(list, path, group, order)),
		newWorktree: request => command(request.repository, repository => actOutNew(repository, request, ending, workflowNames(repository.path))),
		openWorktree: request => command(request.repository, repository => actOutOpen(repository, request, ending, listedBranches(repository) ?? [], workflowNames(repository.path))),
		async rebaseWorktree(request) {
			const refuse = (diagnostic: string): RebaseResult => ({ outcome: "failed", ran: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } });
			if (commandMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, commandMilliseconds));
			// As the main process does: a repository from the list, a worktree it lists with its folder there, then a Timber that is ready.
			const repository = current.find(candidate => candidate.path === request.repository && candidate.available);
			if (!repository) return refuse(`${request.repository} is not a repository in the app's list.`);
			const worktree = timberFailures.has(repository.path) ? undefined : repository.worktrees.find(candidate => candidate.path === request.worktree);
			if (!worktree) return refuse(`Timber lists no worktree at ${request.worktree} in ${request.repository}. Refresh the list.`);
			if (!worktree.pathExists) return refuse(`The folder ${worktree.path} is missing.`);
			const status = await look();
			if (status.state !== "ready") return refuse("Timber is not ready.");
			return structuredClone(actOutRebase(repository, worktree, request, rebaseEnding));
		},
		async runSyncAction(request) {
			syncRequests.push(structuredClone(request));
			if (!isSyncActionKind(request.action)) return syncNotRun("pull", "The request names no sync action this app knows.");
			if (commandMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, commandMilliseconds));
			// As the main process does: a repository from the list, and a worktree it lists with its folder there.
			const repository = current.find(candidate => candidate.path === request.repository && candidate.available);
			if (!repository) return syncNotRun(request.action, `${request.repository} is not a repository in this app's list.`);
			const worktree = timberFailures.has(repository.path) ? undefined : repository.worktrees.find(candidate => candidate.path === request.worktree);
			if (!worktree) return syncNotRun(request.action, `Timber lists no worktree at ${request.worktree} in ${request.repository}. Refresh the list.`);
			if (!worktree.pathExists) return syncNotRun(request.action, `The folder ${worktree.path} is missing.`);
			const acted = actOutSyncAction[request.action](worktree, request, syncEnding, Date.now());
			if (acted.sync !== null && worktree.branch !== null) {
				const after = acted.sync;
				changeSync(repository.path, worktree.branch, () => after);
			}
			return structuredClone(acted.result);
		},
		async setWorktreeBase(request) {
			const refuse = (diagnostic: string): SetBaseResult => ({ outcome: "failed", ran: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } });
			if (commandMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, commandMilliseconds));
			// As the main process does: a repository from the list, a worktree it lists with its folder there, then a Timber that is ready.
			const repository = current.find(candidate => candidate.path === request.repository && candidate.available);
			if (!repository) return refuse(`${request.repository} is not a repository in the app's list.`);
			const worktree = timberFailures.has(repository.path) ? undefined : repository.worktrees.find(candidate => candidate.path === request.worktree);
			if (!worktree) return refuse(`Timber lists no worktree at ${request.worktree} in ${request.repository}. Refresh the list.`);
			if (!worktree.pathExists) return refuse(`The folder ${worktree.path} is missing.`);
			const status = await look();
			if (status.state !== "ready") return refuse("Timber is not ready.");
			const { result, saved } = actOutSetBase(repository, worktree, request, listedBranches(repository) ?? []);
			if (saved) {
				// Timber keeps the base in the worktree's metadata, so the next read of the list shows it.
				const changed = { ...repository, worktrees: repository.worktrees.map(candidate => candidate === worktree ? saved : candidate) };
				current = current.map(candidate => candidate === repository ? changed : candidate);
				onDisk.set(repository.path, changed);
			}
			return structuredClone(result);
		},
		async createPullRequest(request) {
			const refuse = (diagnostic: string): CreatePullRequestResult => ({ outcome: "failed", ran: false, published: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } });
			if (commandMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, commandMilliseconds));
			// As the main process does: a repository from the list, a worktree it lists with its folder there, then a Timber that is ready.
			const repository = current.find(candidate => candidate.path === request.repository && candidate.available);
			if (!repository) return refuse(`${request.repository} is not a repository in the app's list.`);
			const worktree = timberFailures.has(repository.path) ? undefined : repository.worktrees.find(candidate => candidate.path === request.worktree);
			if (!worktree) return refuse(`Timber lists no worktree at ${request.worktree} in ${request.repository}. Refresh the list.`);
			if (!worktree.pathExists) return refuse(`The folder ${worktree.path} is missing.`);
			const status = await look();
			if (status.state !== "ready") return refuse("Timber is not ready.");
			const acted = actOutPullRequest(repository, worktree, request, pullRequestEnding);
			if (acted.opened) pullRequests.openedPullRequest(repository.path, worktree.path, acted.opened);
			return structuredClone(acted.result);
		},
		async readHeadSubject({ repository: path, worktree: worktreePath }) {
			const repository = current.find(candidate => candidate.path === path && candidate.available);
			const worktree = repository?.worktrees.find(candidate => candidate.path === worktreePath);
			if (!worktree) return null;
			if (headSubjects.has(worktree.path)) return headSubjects.get(worktree.path)!;
			return worktree.head === null ? null : `Work on ${worktree.branch ?? "a detached HEAD"}`;
		},
		endPullRequestResults(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!isPullRequestEnding(next)) throw new Error(`Unknown ending: ${String(next)}`);
			pullRequestEnding = next;
		},
		setHeadSubject(path, subject) {
			headSubjects.set(path, subject);
		},
		listBranches: path => read(() => {
			const found = current.find(repository => repository.path === path && repository.available);
			return found ? listedBranches(found) : null;
		}),
		previewDone: async ({ repository, path, options }) => structuredClone(previewDone(repository, path, options)),
		async applyDone({ repository, path, preview }) {
			if (doneDelay > 0) await new Promise(resolve => setTimeout(resolve, doneDelay));
			return structuredClone(applyDone(repository, path, preview));
		},
		// A browser shows the page itself, so this only counts.
		windowReady() {
			ready += 1;
		},
		readyCalls: () => ready,
		reportUnsavedFiles(count) {
			unsaved = count;
		},
		unsavedFilesReported: () => unsaved,
		attend(attention) {
			attended = attention;
			// As the main process does, for the save at quit: the selected worktree and the chip that shows there.
			attendSessions(attention);
			alerts.review();
		},
		onRepositoryChanged(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		endCommands(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!isCommandEnding(next)) throw new Error(`Unknown ending: ${String(next)}`);
			ending = next;
			// Setup runs in its own session, so that is where "setup-fails" fails.
			terminals.endWorktreeSetups(next === "setup-fails" ? 1 : 0);
		},
		endSyncActions(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!isSyncEnding(next)) throw new Error(`Unknown ending: ${String(next)}`);
			syncEnding = next;
		},
		syncActionRequests: () => structuredClone(syncRequests),
		endRebaseResults(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!isRebaseEnding(next)) throw new Error(`Unknown ending: ${String(next)}`);
			rebaseEnding = next;
		},
		setBranches(path, branches) {
			branchLists.set(path, branches);
		},
		loadLayout: async () => structuredClone(layout),
		async saveLayout(next) {
			if (layoutFailure !== null) return { outcome: "failed", message: layoutFailure };
			layout = readLayout(structuredClone(next));
			return { outcome: "saved" };
		},
		failLayoutSaves(message) {
			layoutFailure = message;
		},
		loadPreferences: async () => structuredClone(preferences),
		async savePreferences(change) {
			if (preferencesFailure !== null) return { outcome: "failed", message: preferencesFailure };
			const { preferences: next, unreadable } = applyPreferenceChange(preferences, structuredClone(change));
			if (unreadable.length > 0) return { outcome: "failed", message: `Nothing was saved, because these settings could not be read: ${unreadable.join(", ")}.` };
			const timberChanged = !sameTimberChoice(preferences.timber, next.timber);
			preferences = next;
			alerts.review();
			// As the main process does: another Timber is looked for at once, and the window told.
			if (timberChanged) for (const listener of [...timberListeners]) listener();
			return { outcome: "saved", preferences: structuredClone(preferences) };
		},
		failPreferenceSaves(message) {
			preferencesFailure = message;
		},
		openInEditor: async request => structuredClone(openInEditor(request)),
		endEditorLaunches(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!EDITOR_ENDINGS.includes(next)) throw new Error(`Unknown ending: ${String(next)}`);
			editorEnding = next;
		},
		launchedEditors: () => structuredClone(launches),
		uninstallPlan: async () => uninstallEnding === "unavailable" ? { available: false, reason: NOT_INSTALLED } : structuredClone(sampleUninstallPlan),
		async uninstall(request) {
			if (uninstallEnding === "unavailable") return { outcome: "unavailable", message: NOT_INSTALLED };
			if (uninstallEnding === "fails") return { outcome: "failed", message: "The uninstaller ended with exit code 1: error: InvalidUninstallManifest" };
			uninstalls.push(structuredClone(request));
			const kept = uninstallEnding === "keeps-settings" && request.forgetSettings;
			return { outcome: "uninstalled", settingsProblem: kept ? `EACCES: permission denied, unlink '${sampleUninstallPlan.settingsFolder}/settings.json'` : null };
		},
		endUninstalls(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!UNINSTALL_ENDINGS.includes(next)) throw new Error(`Unknown ending: ${String(next)}`);
			uninstallEnding = next;
		},
		uninstallRequests: () => structuredClone(uninstalls),
		restartPlan: async () => restartEnding === "unavailable" ? { available: false, reason: NOT_RESTARTABLE } : { available: true },
		async restart() {
			if (restartEnding === "unavailable") return { outcome: "unavailable", message: NOT_RESTARTABLE };
			if (restartEnding === "fails") return { outcome: "failed", message: "Something kept the app open, so it did not restart. Try again in a moment." };
			restarts += 1;
			return { outcome: "restarting" };
		},
		endRestarts(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!RESTART_ENDINGS.includes(next)) throw new Error(`Unknown ending: ${String(next)}`);
			restartEnding = next;
		},
		restartCount: () => restarts,
		appUpdate: async () => appUpdate,
		async checkForAppUpdate() {
			if (appUpdate.kind !== "unavailable" && appUpdate.kind !== "checking" && appUpdate.kind !== "downloading" && appUpdate.kind !== "installing") void lookForAppUpdate();
			return appUpdate;
		},
		onAppUpdateChanged(listener) {
			appUpdateListeners.add(listener);
			return () => void appUpdateListeners.delete(listener);
		},
		async installAppUpdate(request) {
			if (appUpdate.kind !== "ready") return { outcome: "failed", message: "No update is ready to install yet." };
			const live = (await terminals.listTerminals()).filter(session => session.state.kind === "running").length;
			if (live > 0 && !request.endSessions) return { outcome: "sessions-running", live };
			appUpdateRequests.push(structuredClone(request));
			const ready = appUpdate;
			setAppUpdate({ kind: "installing", version: ready.version });
			if (appUpdateInstallFailure === null) return { outcome: "restarting" };
			// As the main process does: the update stays ready, and the answer says why.
			await Promise.resolve();
			setAppUpdate(ready);
			return { outcome: "failed", message: appUpdateInstallFailure };
		},
		failAppUpdateInstalls(message) {
			appUpdateInstallFailure = message;
		},
		endAppUpdateChecks(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!APP_UPDATE_ENDINGS.includes(next)) throw new Error(`Unknown ending: ${String(next)}`);
			appUpdateEnding = next;
		},
		appUpdateInstalls: () => structuredClone(appUpdateRequests),
		async readFileChanges(request) {
			const listed = listedForChanges(request.repository, request.worktree);
			if (!listed.ok) return { outcome: listed.outcome, message: listed.message };
			return listMockFileChanges(filesOf(listed.worktree), listed.worktree, request.compare);
		},
		async readFileDiff(request) {
			const listed = listedForChanges(request.repository, request.worktree);
			if (!listed.ok) return { outcome: listed.outcome, message: listed.message };
			return diffMockFileChange(filesOf(listed.worktree), listed.worktree, structuredClone(request));
		},
		async readWorktreeFile(request) {
			const listed = listedForChanges(request.repository, request.worktree);
			if (!listed.ok) return { outcome: listed.outcome, message: listed.message.replace("No changes were read.", "The file was not read.").replace("so no changes were read", "so the file was not read") };
			return worktreeFiles.read(listed.worktree.path, request.path, filesOf(listed.worktree));
		},
		async writeWorktreeFile(request) {
			const listed = listedForChanges(request.repository, request.worktree);
			if (!listed.ok) return { outcome: listed.outcome, message: listed.message.replace("No changes were read.", "Nothing was saved.").replace("so no changes were read", "so nothing was saved") };
			if (writeDelay > 0) await new Promise(resolve => setTimeout(resolve, writeDelay));
			return worktreeFiles.write(request, listed.worktree.path, filesOf(listed.worktree));
		},
		async listChops(request) {
			return listMockChops(request.repository);
		},
		onChopsChanged: listener => chopFiles.onChopsChanged(listener),
		async runChop(request) {
			// The pretend terminals check the worktree is listed, with its folder there, as the main process does.
			return chopFiles.run(structuredClone(request), listMockChops(request.repository), terminals, preferences.agents);
		},
		...chopFiles.controls,
		async readPorts(request) {
			// As the main process: nothing is read while the window is hidden.
			if (attended?.visible === false) return { outcome: "hidden" };
			const repository = current.find(candidate => candidate.path === request.repository);
			const worktrees = repository?.available ? asRead(repository).worktrees : [];
			const target = repository?.available && asRead(repository).failure === null ? worktrees.find(candidate => candidate.path === request.worktree) : undefined;
			if (!target || !target.pathExists) return { outcome: "not-listed", message: `Timber lists no worktree at ${request.worktree} in ${request.repository}. No ports were read.` };
			return portReader.read(target, worktrees);
		},
		...portReader.controls,
		setFileChanges(path, files) {
			if (files === null) fileChangeLists.delete(path);
			else fileChangeLists.set(path, structuredClone(files));
		},
		failFileChanges(message) {
			fileChangeFailure = message;
		},
		setWorktreeFile(worktree, path, file) {
			worktreeFiles.set(worktree, path, structuredClone(file));
		},
		readWorktreeFileNow(worktree, path) {
			const result = worktreeFiles.read(worktree, path, []);
			return result.outcome === "read" && result.content.kind === "text" ? result.content.text : null;
		},
		delayFileSaves(milliseconds) {
			writeDelay = milliseconds;
		},
		setChanges(path, files) {
			if (files.ignored) ignored.set(path, files.ignored);
			current = current.map(repository => ({
				...repository,
				worktrees: repository.worktrees.map(candidate => {
					if (candidate.path !== path) return candidate;
					const before = candidate.changes.kind === "known" ? candidate.changes : { modified: [], untracked: [] };
					return { ...candidate, changes: { kind: "known", modified: files.modified ?? before.modified, untracked: files.untracked ?? before.untracked } };
				}),
			}));
		},
		expirePreviewsAfter(milliseconds) {
			previewLifetime = milliseconds;
		},
		failBranchDeletion(fail) {
			branchDeletionFails = fail;
		},
		refuseRemovals(path, diagnostic) {
			if (diagnostic === null) removalRefusals.delete(path);
			else removalRefusals.set(path, diagnostic);
		},
		setDoneDelay(milliseconds) {
			doneDelay = milliseconds;
		},
		setRepositories(next) {
			current = next;
			for (const repository of next) onDisk.set(repository.path, repository);
		},
		pickFolder(folder) {
			picked = folder;
		},
		attention: () => attended,
		notices: () => structuredClone(notices),
		alertSounds: () => [...alertSounds],
		previewSounds: () => structuredClone(previews),
		pickSoundFile(path) {
			pickedSound = path;
		},
		endSoundPreviews(outcome) {
			previewEnding = outcome;
		},
		async chooseSoundFile(): Promise<ChooseSoundResult> {
			if (pickedSound === null) return { outcome: "cancelled" };
			// As the main process does: only a path the preference would accept.
			const read = readSoundChoice({ kind: "custom", path: pickedSound });
			return read?.kind === "custom" ? { outcome: "chosen", path: read.path } : { outcome: "refused", message: "The app cannot play that file. Choose a WAV, Ogg, FLAC, MP3, or AIFF file." };
		},
		async playSound(choice) {
			previews.push(structuredClone(choice));
			return { outcome: previewEnding };
		},
		clickNotice(session) {
			for (const listener of [...showSessionListeners]) listener(session);
		},
		onShowSession(listener) {
			showSessionListeners.add(listener);
			return () => void showSessionListeners.delete(listener);
		},
		typeTimberNew(path, name, agent) {
			const repository = current.find(candidate => candidate.path === path && candidate.available);
			// Timber in a terminal works in any repository, listed or not; one not in the list makes a pretend worktree beside it.
			let worktree = `${path}-worktrees/${name}`;
			if (repository) {
				const { created } = actOutNew(repository, { repository: path, name, base: null }, "succeeds");
				if (!created) return null;
				const changed = { ...repository, worktrees: inTimberOrder([...repository.worktrees, created]) };
				current = current.map(candidate => candidate === repository ? changed : candidate);
				onDisk.set(path, changed);
				worktree = created.path;
			}
			const handoff: WorktreeHandoff = { repository: path, worktree, agent };
			for (const listener of [...handoffListeners]) listener(structuredClone(handoff));
			return handoff;
		},
		onWorktreeHandedOff(listener) {
			handoffListeners.add(listener);
			return () => void handoffListeners.delete(listener);
		},
		announceChange: announce,
		fetchStatuses: async () => current.filter(repository => repository.available).map(repository => structuredClone(fetchOf(repository.path))),
		fetchNow(path) {
			const ongoing = running.get(path);
			if (ongoing) return ongoing;
			if (!current.some(repository => repository.path === path && repository.available)) {
				return Promise.resolve({ outcome: "not-listed", message: `${path} is not a repository in this app's list. Nothing was fetched.` });
			}
			const run = (async (): Promise<FetchResult> => {
				tellFetch({ ...fetchOf(path), fetching: true });
				if (fetchDelay > 0) await new Promise(resolve => setTimeout(resolve, fetchDelay));
				const before = fetchOf(path);
				if (fetchEnding === "fetches") {
					const fetch = { ...before, fetching: false, lastFetched: Date.now(), failure: null };
					tellFetch(fetch);
					return { outcome: "fetched", fetch: structuredClone(fetch) };
				}
				const fetch = { ...before, fetching: false, failure: { kind: fetchEnding, message: MOCK_FETCH_FAILURES[fetchEnding], at: Date.now() } };
				tellFetch(fetch);
				return { outcome: "failed", fetch: structuredClone(fetch) };
			})();
			running.set(path, run);
			// Taken away once it ended, which can be before this line when it does not wait.
			void run.finally(() => {
				if (running.get(path) === run) running.delete(path);
			});
			return run;
		},
		onFetchChanged(listener) {
			fetchListeners.add(listener);
			return () => void fetchListeners.delete(listener);
		},
		forcePushSeen(next) {
			seen.push(structuredClone(next));
			// As the main process does: told only when a mark went, and only the mark of that time.
			let cleared = false;
			changeSync(next.repository, next.branch, sync => {
				if (sync?.kind !== "tracking" || sync.forcePushed?.at !== next.at) return sync;
				cleared = true;
				const { forcePushed: _seen, ...rest } = sync;
				return rest;
			});
			if (cleared) announce(next.repository);
		},
		endFetches(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!FETCH_ENDINGS.includes(next)) throw new Error(`Unknown ending: ${String(next)}`);
			fetchEnding = next;
		},
		setFetchDelay(milliseconds) {
			fetchDelay = milliseconds;
		},
		forcePush(path, branch) {
			const at = Date.now();
			const found = changeSync(path, branch, sync => sync?.kind === "tracking"
				? { ...sync, behind: Math.max(1, sync.behind), forcePushed: { at } }
				: { kind: "tracking", upstream: `origin/${branch}`, ahead: 0, behind: 1, forcePushed: { at } });
			if (!found) return null;
			announce(path);
			return at;
		},
		seenForcePushes: () => structuredClone(seen),
		failReads(message) {
			failure = message;
		},
		failTimber(path, diagnostic) {
			if (diagnostic === null) timberFailures.delete(path);
			else timberFailures.set(path, diagnostic);
		},
	};
}
