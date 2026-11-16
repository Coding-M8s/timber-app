import type { Attention } from "../../shared/attention";
import type { Engine } from "../../shared/engine";
import { type Layout, defaultLayout, forgetRepository, readLayout } from "../../shared/layout";
import { type AddRepositoryResult, type BranchSuggestion, type OpenInEditorRequest, type OpenInEditorResult, type Repository, type SyncState, type TimberStatus, type Worktree, type WorktreeCommandResult, worktreeId } from "../../shared/model";
import { describeCommandLine } from "../../shared/command-line";
import { TERMINAL_EDITOR_REASON, editorCommand, editorTarget } from "../../shared/editor";
import { type Preferences, applyPreferenceChange, defaultPreferences } from "../../shared/preferences";
import {
	type DoneApplyResult, type DoneOptions, type DonePreviewResult, DONE_PREVIEW_MINUTES, describeDoneApply, describeDonePreview, readDonePreview,
} from "../../shared/timber-done";
import { failureOf, readTimberResult } from "../../shared/timber-result";
import { REQUIRED_TIMBER_VERSION } from "../../shared/timber-version";
import { type CommandEnding, actOutNew, actOutOpen, isCommandEnding } from "./mock-commands";
import { type MockFileChange, derivedFileChanges, diffMockFileChange, listMockFileChanges } from "./mock-file-changes";
import { type TerminalControls, createMockTerminals } from "./mock-terminals";
import { type TimberConfigControls, createMockTimberConfig } from "./mock-timber-config";

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
		sync: inSync(branch) as SyncState | null,
		...overrides,
	};
	// As Timber does: a canonical path only for a folder whose status it could read.
	const canonicalPath = sample.pathExists && sample.changes.kind === "known" ? path : null;
	return { ...sample, id: worktreeId(`/work/${repository}/.git`, { path, canonicalPath }), canonicalPath, detached: sample.branch === null };
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
				sync: { kind: "unpublished" },
			}),
		],
	},
	{
		path: "/work/api-server",
		name: "api-server",
		available: true,
		failure: null,
		worktrees: [
			worktree("api-server", "main", { primary: true }),
			worktree("api-server", "feat/rate-limit-headers", {
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
 * status Timber could not read, an upstream state Git could not read, and a
 * row with everything at once. The browser build lists it; most tests do not.
 */
export const sampleStatesRepository: Repository = {
	path: "/work/billing",
	name: "billing",
	available: true,
	failure: null,
	worktrees: [
		worktree("billing", "main", { primary: true }),
		worktree("billing", "review-build", {
			branch: null,
			head: "4f9c2ab81d3e56f7a0b1c2d3e4f5a6b7c8d9e0f1",
			sync: null,
		}),
		worktree("billing", "release/2.4", { locked: true }),
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
			sync: null,
		}),
		worktree("billing", "feat/tax-rules", {
			locked: true,
			changes: sampleChanges(12, 5),
			sync: { kind: "tracking", upstream: "origin/feat/tax-rules", ahead: 1, behind: 14 },
		}),
	],
};

/** A saved repository whose folder is gone. The browser build lists it; most tests do not. */
export const sampleUnavailableRepository: Repository = {
	path: "/work/old-prototype",
	name: "old-prototype",
	available: false,
	failure: null,
	worktrees: [],
};

/** What `bun run dev:web` lists: every row state, and a repository that is unavailable. */
export const browserSampleRepositories: Repository[] = [...sampleRepositories, sampleStatesRepository, sampleUnavailableRepository];

/** A repository on the pretend disk that is not in the list yet. The mock's folder picker chooses it by default. */
export const samplePickableRepository: Repository = {
	path: "/work/docs-site",
	name: "docs-site",
	available: true,
	failure: null,
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
	"ready": { state: "ready", path: "/home/sam/.local/bin/timber", version: REQUIRED_TIMBER_VERSION },
	"not-found": { state: "not-found", override: null },
	"too-old": { state: "too-old", path: "/home/sam/.local/bin/timber", found: "0.1.0", required: REQUIRED_TIMBER_VERSION },
} as const satisfies Record<TimberStatus["state"], TimberStatus>;

/** The mock engine, plus the controls a test or the browser build uses to act out changes. */
/** The controls for terminals are in ./mock-terminals.ts. */
/** The controls for Timber's settings are in ./mock-timber-config.ts. */
export interface MockEngine extends Engine, TerminalControls, TimberConfigControls {
	/** Replace the data, without telling the interface. */
	setRepositories(repositories: Repository[]): void;
	/** Report that a repository changed, as the main process would. */
	announceChange(path: string): void;
	/** What the interface last said through `attend`, or null before it said anything. */
	attention(): Attention | null;
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
	 * (the start), "refused", "ambiguous", "setup-fails", or "no-result". See
	 * ./mock-commands.ts for what each one acts out.
	 */
	endCommands(ending: CommandEnding): void;
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
	 * Decide how "Open in editor" ends from now on, for an editor that is set
	 * and a worktree that is listed: "opens" (the start), "not-found" (the
	 * executable is not on the PATH), or "fails" (the editor stops right away
	 * with an error).
	 */
	endEditorLaunches(ending: EditorEnding): void;
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
}

export const EDITOR_ENDINGS = ["opens", "not-found", "fails"] as const;
export type EditorEnding = typeof EDITOR_ENDINGS[number];

export interface MockEngineOptions {
	/** How long an acted `timber new` or `timber open` takes. None by default; the browser build waits, so the running state shows. */
	commandMilliseconds?: number;
}

/** A command the mock did not act out, with the reason. */
function notRun(diagnostic: string): WorktreeCommandResult {
	return { outcome: "failed", failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null }, worktree: null, created: false };
}

/** Timber's order: the primary checkout first, then by path. */
function inTimberOrder(worktrees: Worktree[]): Worktree[] {
	return [...worktrees].sort((a, b) => Number(b.primary) - Number(a.primary) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * `timber` is the answer to every look for Timber. Pass a function to change
 * the answer between looks, for example to act out an install before Retry.
 */
export function createMockEngine(
	repositories: Repository[] = sampleRepositories,
	timber: TimberStatus | (() => TimberStatus) = sampleTimberStatuses.ready,
	options: MockEngineOptions = {},
): MockEngine {
	let current = repositories;
	let failure: string | null = null;
	const timberFailures = new Map<string, string>();
	// As the main process does: a failed listing brings the diagnostic and no worktrees.
	const asRead = (repository: Repository): Repository => {
		const diagnostic = timberFailures.get(repository.path);
		return diagnostic === undefined || !repository.available ? repository : { ...repository, failure: diagnostic, worktrees: [] };
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
	// The layout lives in memory, for as long as this engine does.
	let layout: Layout = defaultLayout();
	let layoutFailure: string | null = null;
	// So do the preferences.
	let preferences: Preferences = defaultPreferences();
	let preferencesFailure: string | null = null;
	const listeners = new Set<(path: string) => void>();
	// The mock watches nothing: changes are acted out with `announceChange`. It only keeps what it was told.
	let attended: Attention | null = null;

	// The Done dialog. As in the main process, what a preview printed stays here and the interface gets a name for it.
	const ignored = new Map<string, readonly string[]>(Object.entries(sampleIgnored));
	const heldPreviews = new Map<string, { text: string; repository: string; path: string; options: DoneOptions; expiresAt: number }>();
	let lastPreview = 0;
	let previewLifetime: number | null = null;
	let branchDeletionFails = false;
	let doneDelay = 0;

	/**
	 * What Timber would print for a preview right now, or why there is none.
	 * `ran` is false when the app itself stopped before running Timber.
	 */
	const previewRecord = (repositoryPath: string, path: string, options: DoneOptions): { text: string } | { refused: string; ran?: false } => {
		const status = typeof timber === "function" ? timber() : timber;
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
					message: `Could not start the editor. "${built.executable}" was not found on the PATH the app was started with: /usr/local/bin:/usr/bin:/bin. A change to PATH needs a restart of the app, or use the full path in Settings, Editor.`,
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

	const look = async () => structuredClone(typeof timber === "function" ? timber() : timber);
	const read = async <Result>(result: () => Result): Promise<Result> => {
		if (failure !== null) throw new Error(failure);
		return structuredClone(result());
	};
	let ending: CommandEnding = "succeeds";
	const branchLists = new Map<string, BranchSuggestion[] | null>();
	const listedBranches = (repository: Repository) =>
		branchLists.has(repository.path) ? branchLists.get(repository.path)! : branchesOf(repository);
	const { commandMilliseconds = 0 } = options;
	// As the main process does: only with a usable Timber, and only in a repository from the list.
	const command = async (path: string, act: (repository: Repository) => { result: WorktreeCommandResult; created: Worktree | null }): Promise<WorktreeCommandResult> => {
		if (commandMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, commandMilliseconds));
		if ((await look()).state !== "ready") return notRun("Timber is not ready.");
		const repository = current.find(candidate => candidate.path === path && candidate.available);
		if (!repository) return notRun(`${path} is not a repository in the app's list.`);
		const { result, created } = act(repository);
		if (created) {
			const changed = { ...repository, worktrees: inTimberOrder([...repository.worktrees, created]) };
			current = current.map(candidate => candidate === repository ? changed : candidate);
			onDisk.set(path, changed);
		}
		return structuredClone(result);
	};
	// As the main process does: only a worktree listed right now, whose folder is there.
	const terminals = createMockTerminals((path, worktreePath) => {
		const repository = current.find(candidate => candidate.path === path && candidate.available);
		const worktree = timberFailures.has(path) ? undefined : repository?.worktrees.find(candidate => candidate.path === worktreePath);
		return worktree && worktree.pathExists ? worktree : null;
	}, () => preferences.agents, () => typeof timber === "function" ? timber() : timber);
	const timberConfig = createMockTimberConfig(path => current.some(repository => repository.path === path));
	return {
		...terminals,
		...timberConfig,
		timberStatus: look,
		recheckTimber: look,
		listRepositories: () => read(() => current.map(asRead)),
		loadRepository: path => read(() => {
			const found = current.find(repository => repository.path === path && repository.available);
			return found ? asRead(found) : null;
		}),
		addRepository: async () => structuredClone(add()),
		async removeRepository(path) {
			current = current.filter(repository => repository.path !== path);
			layout = forgetRepository(layout, path);
			return { outcome: "removed" };
		},
		newWorktree: request => command(request.repository, repository => actOutNew(repository, request, ending)),
		openWorktree: request => command(request.repository, repository => actOutOpen(repository, request, ending, listedBranches(repository) ?? [])),
		listBranches: path => read(() => {
			const found = current.find(repository => repository.path === path && repository.available);
			return found ? listedBranches(found) : null;
		}),
		previewDone: async ({ repository, path, options }) => structuredClone(previewDone(repository, path, options)),
		async applyDone({ repository, path, preview }) {
			if (doneDelay > 0) await new Promise(resolve => setTimeout(resolve, doneDelay));
			return structuredClone(applyDone(repository, path, preview));
		},
		attend(attention) {
			attended = attention;
		},
		onRepositoryChanged(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		endCommands(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!isCommandEnding(next)) throw new Error(`Unknown ending: ${String(next)}`);
			ending = next;
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
			preferences = next;
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
		async readFileChanges(request) {
			const listed = listedForChanges(request.repository, request.worktree);
			if (!listed.ok) return { outcome: listed.outcome, message: listed.message };
			return listMockFileChanges(filesOf(listed.worktree));
		},
		async readFileDiff(request) {
			const listed = listedForChanges(request.repository, request.worktree);
			if (!listed.ok) return { outcome: listed.outcome, message: listed.message };
			return diffMockFileChange(filesOf(listed.worktree), structuredClone(request));
		},
		setFileChanges(path, files) {
			if (files === null) fileChangeLists.delete(path);
			else fileChangeLists.set(path, structuredClone(files));
		},
		failFileChanges(message) {
			fileChangeFailure = message;
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
		announceChange(path) {
			for (const listener of [...listeners]) listener(path);
		},
		failReads(message) {
			failure = message;
		},
		failTimber(path, diagnostic) {
			if (diagnostic === null) timberFailures.delete(path);
			else timberFailures.set(path, diagnostic);
		},
	};
}
