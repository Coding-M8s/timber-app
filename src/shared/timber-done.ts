import type { TimberFailure } from "./model";
import { type ListedRepository, type ListedWorktree, SUPPORTED_SCHEMA_VERSION, isFields, readRepository, readWorktree } from "./timber-ls";
import { APPROVAL_FILE_PLACEHOLDER, RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "./timber-result";

/**
 * Removing a worktree through Timber's native cleanup approval, version 1 of
 * its machine interface (docs/ide-contract.md in the Timber repository):
 * `timber __ide-done preview` says what would be removed and changes nothing,
 * and `timber __ide-done apply` removes exactly what one preview described.
 *
 * Pure: the main process runs Timber (see src/bun/done.ts). Nothing here
 * decides what is safe to delete. The app shows what the preview says, and
 * Timber decides.
 */

/** The choices in the Done dialog. Each one is a flag of the preview. */
export interface DoneOptions {
	/** Remove the folder but leave the local branch. */
	keepBranch: boolean;
	/** Have Timber refuse while ignored files exist, instead of deleting them. Nothing is copied. */
	keepIgnored: boolean;
	/** The branch Timber checks the worktree against, or null for Timber's own choice. */
	base: string | null;
}

export const DEFAULT_DONE_OPTIONS: DoneOptions = { keepBranch: false, keepIgnored: false, base: null };

/** How long Timber accepts a preview, as its contract says. The preview's own `expiresAt` is what counts. */
export const DONE_PREVIEW_MINUTES = 10;

/**
 * Everything after `timber` for a preview. `path` is the worktree's registered
 * path, verbatim. The base is joined to its flag, so a name that starts with
 * a dash cannot be read as another option.
 */
export function donePreviewArguments(path: string, options: DoneOptions): string[] {
	return [
		"__ide-done", "preview",
		...(options.keepBranch ? ["--keep-branch"] : []),
		...(options.keepIgnored ? ["--keep-ignored"] : []),
		...(options.base === null ? [] : [`--base=${options.base}`]),
		"--", path,
	];
}

/** Everything after `timber` for the removal. The options are not repeated: they come from the approved preview. */
export function doneApplyArguments(approvalFile: string, resultFile: string, path: string): string[] {
	return ["__ide-done", "apply", "--approval-file", approvalFile, "--result-file", resultFile, "--", path];
}

/** The preview command as it is shown. */
export const describeDonePreview = (path: string, options: DoneOptions) => describeTimberCommand(donePreviewArguments(path, options));

/** The removal command as it is shown, with placeholders for its two temporary files. */
export const describeDoneApply = (path: string) => describeTimberCommand(doneApplyArguments(APPROVAL_FILE_PLACEHOLDER, RESULT_FILE_PLACEHOLDER, path));

/** One preview, in the app's words. It describes one state of one worktree and nothing else. */
export interface DonePreview {
	/** Timber's fingerprint of what it looked at. Removal is refused when the state no longer matches it. */
	snapshot: string;
	/** Unix milliseconds. Timber refuses the preview from this moment on. */
	expiresAt: number;
	repository: ListedRepository;
	/**
	 * The exact target. `changes` holds the modified and untracked files that
	 * would be lost, with paths relative to the worktree.
	 */
	worktree: ListedWorktree;
	/** Ignored files and folders in the worktree, as Git reports them. */
	ignored: string[];
	/** The options as Timber understood them. */
	options: {
		keepBranch: boolean;
		/** True when ignored files are deleted with the folder. */
		discardIgnored: boolean;
		base: string | null;
	};
}

/** The fields Timber's version 1 apply command reads from an approval file. */
interface DoneApproval {
	schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
	snapshot: string;
	expiresAt: number;
	repository: ListedRepository & { currentWorktreeRoot: string };
	worktree: { path: string; canonicalPath: string };
	options: { keepBranch: boolean; discardIgnored: boolean; base?: string };
}

export type DonePreviewReading =
	| { ok: true; preview: DonePreview; approval: DoneApproval }
	| { ok: false; message: string };

const PREVIEW_NAME = "timber __ide-done preview";
const SNAPSHOT = /^[a-f0-9]{64}$/;

const unreadable = (detail: string): DonePreviewReading =>
	({ ok: false, message: `${PREVIEW_NAME} did not answer with a preview this app can read: ${detail}.` });

/**
 * Read what one successful run of the preview printed on standard output.
 *
 * A preview is used only as a whole: one version 1 record with a snapshot, an
 * expiry, the repository, the worktree with a known file status, and the
 * options. Anything else is a failure with a message, never part of a
 * preview. Fields the app does not use, or that a later Timber adds within
 * version 1, are ignored.
 */
export function readDonePreview(stdout: string): DonePreviewReading {
	let record: unknown;
	try {
		record = JSON.parse(stdout);
	} catch {
		return unreadable(stdout.trim() === "" ? "it printed nothing" : "the output is not valid JSON");
	}
	if (!isFields(record)) return unreadable("the output is not a JSON object");

	if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
		const found = typeof record.schemaVersion === "number" || typeof record.schemaVersion === "string" ? String(record.schemaVersion) : "none";
		return { ok: false, message: `${PREVIEW_NAME} answered with schema version ${found}, and this app reads version ${SUPPORTED_SCHEMA_VERSION} only. Update Timber app, or install a Timber that matches it.` };
	}

	const { snapshot, expiresAt, options } = record;
	if (typeof snapshot !== "string" || !SNAPSHOT.test(snapshot)) return unreadable("it has no snapshot");
	if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0) return unreadable("it does not say when it expires");
	const repositoryRecord = record.repository;
	const repository = readRepository(repositoryRecord);
	if (!repository || !isFields(repositoryRecord) || typeof repositoryRecord.currentWorktreeRoot !== "string" || repositoryRecord.currentWorktreeRoot === "") {
		return unreadable("it does not say which repository it is for");
	}
	const worktree = readWorktree(record.worktree);
	if (!worktree || !worktree.canonicalPath) return unreadable("its worktree is not a worktree record");
	if (worktree.changes.kind !== "known") return unreadable("it does not list the files in the worktree");
	// `readWorktree` has checked that the status is an object.
	const ignored = (record.worktree as { status: { ignored?: unknown } }).status.ignored;
	if (!Array.isArray(ignored) || !ignored.every(path => typeof path === "string")) return unreadable("it does not list the ignored files");

	if (!isFields(options) || typeof options.keepBranch !== "boolean" || typeof options.discardIgnored !== "boolean") return unreadable("it does not say which options it is for");
	if (options.base !== undefined && typeof options.base !== "string") return unreadable("its base is not text");

	const approvalOptions = {
		keepBranch: options.keepBranch, discardIgnored: options.discardIgnored,
		...(options.base === undefined ? {} : { base: options.base }),
	};
	return {
		ok: true,
		preview: {
			snapshot, expiresAt, repository, worktree, ignored,
			options: { ...approvalOptions, base: options.base ?? null },
		},
		approval: {
			schemaVersion: SUPPORTED_SCHEMA_VERSION, snapshot, expiresAt,
			repository: { ...repository, currentWorktreeRoot: repositoryRecord.currentWorktreeRoot },
			worktree: { path: worktree.path, canonicalPath: worktree.canonicalPath },
			options: approvalOptions,
		},
	};
}

/** Whether a preview is for these options, so that what is approved is what is on screen. */
export function previewMatchesOptions(preview: DonePreview, options: DoneOptions): boolean {
	return preview.options.keepBranch === options.keepBranch
		&& preview.options.discardIgnored === !options.keepIgnored
		&& preview.options.base === options.base;
}

/** What the interface asks to preview. */
export interface DonePreviewRequest {
	/** The path of the repository's primary checkout, as the app lists it. */
	repository: string;
	/** The worktree's registered path (`Worktree.path`), verbatim. */
	path: string;
	options: DoneOptions;
}

/**
 * The answer to a preview request. The interface gets the preview to show and
 * a name for it. The approval stays with the engine, so the
 * interface cannot change what is later approved: it can only name a preview.
 */
export type DonePreviewResult =
	| {
		outcome: "previewed";
		/** Names this one preview for `applyDone`. It can be used once. */
		id: string;
		preview: DonePreview;
	}
	/** Timber refused, could not be run, or answered with something else. Nothing can be approved. */
	| { outcome: "failed"; failure: TimberFailure };

/** What the interface asks after the person pressed Remove. */
export interface DoneApplyRequest {
	repository: string;
	path: string;
	/** The `id` of the preview the person was looking at. */
	preview: string;
}

/** How a removal ended. After every one of these the list must be read again. */
export type DoneApplyResult =
	/** Timber's result says it removed the worktree. */
	| { outcome: "removed" }
	| {
		outcome: "failed";
		failure: TimberFailure;
		/**
		 * False when the app stopped before it ran Timber, so nothing was
		 * changed. True when Timber ran: the folder can be gone even so, for
		 * example when only deleting the branch failed.
		 */
		ran: boolean;
	};
