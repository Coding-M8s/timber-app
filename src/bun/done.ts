import { randomUUID } from "node:crypto";
import type { Repository, TimberFailure, TimberStatus } from "../shared/model";
import { createOutputCapture } from "../shared/captured-output";
import {
	type DoneApplyRequest, type DoneApplyResult, type DonePreviewRequest, type DonePreviewResult,
	describeDonePreview, doneApplyArguments, donePreviewArguments, previewMatchesOptions, readDonePreview,
} from "../shared/timber-done";
import { APPROVAL_FILE_PLACEHOLDER, failureOf } from "../shared/timber-result";
import { describeTimberStatus } from "./timber";
import { runTimberWithResultFile } from "./timber-run";

/** A preview only reads the repository, so anything this slow is stuck. */
const PREVIEW_TIMEOUT_MS = 30_000;

/** How many previews are kept for approval at once. The oldest go first. */
const HELD_PREVIEWS = 16;

export interface DoneDependencies {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/**
	 * The repository in the app's list whose primary checkout is `path`, read
	 * again, so that its worktrees are the ones Timber lists right now. Null
	 * when the list has no such repository (see `RepositoryList.find`).
	 */
	findRepository: (path: string) => Promise<Repository | null>;
	environment?: Record<string, string | undefined>;
	/** Where the private folder for the approval and result files is made. The system's temporary folder by default. */
	temporaryRoot?: string;
	/** The time in Unix milliseconds. Tests pass their own clock. */
	now?: () => number;
}

/** Removing a worktree: the main process side of the Done dialog. */
export interface Done {
	/** Run `timber __ide-done preview` and keep what it printed. Read-only. */
	preview(request: DonePreviewRequest): Promise<DonePreviewResult>;
	/** Run `timber __ide-done apply` with one kept preview as the approval. A preview is used up by one call. */
	apply(request: DoneApplyRequest): Promise<DoneApplyResult>;
}

/** A preview waiting for the person's answer. */
interface HeldPreview {
	/** Exactly the bytes Timber printed on standard output. Never changed, never logged. */
	bytes: Uint8Array;
	repository: string;
	path: string;
	expiresAt: number;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The Done dialog's two commands.
 *
 * - Both act only on a repository in the app's list and on a worktree path
 *   that Timber lists for it at that moment. That registered path, verbatim,
 *   is what goes after `--`.
 * - Timber's safety rules are not repeated here. Whether a worktree may be
 *   removed, and what is lost, is Timber's answer: the preview says it, and
 *   the removal is refused by Timber when anything changed since.
 * - What the preview printed is kept here, in the main process, and the
 *   interface only gets a name for it. On Remove those same bytes become the
 *   approval file, so the interface cannot alter what is approved, and the
 *   name ties the approval to the one preview the person was shown.
 * - Nothing is ever retried, and nothing that a command printed is logged.
 */
export function createDone(dependencies: DoneDependencies): Done {
	const { timber, findRepository, environment = process.env, temporaryRoot, now = Date.now } = dependencies;
	const held = new Map<string, HeldPreview>();

	function hold(preview: HeldPreview): string {
		for (const [id, entry] of held) if (entry.expiresAt <= now()) held.delete(id);
		// A Map keeps the order of insertion, so the first key is the oldest preview.
		while (held.size >= HELD_PREVIEWS) held.delete(held.keys().next().value!);
		const id = randomUUID();
		held.set(id, preview);
		return id;
	}

	/** The Timber to run for this worktree, or why nothing may be run. */
	async function locate(repositoryPath: string, worktreePath: string): Promise<{ executable: string } | { refused: string }> {
		const status = await timber();
		if (status.state !== "ready") return { refused: `${describeTimberStatus(status)}. Nothing was run.` };
		let repository: Repository | null;
		try {
			repository = await findRepository(repositoryPath);
		} catch (error) {
			return { refused: `Could not read the repository at ${repositoryPath}: ${messageOf(error)}. Nothing was run.` };
		}
		if (repository === null) return { refused: `${repositoryPath} is not a repository in this app's list. Nothing was run.` };
		if (!repository.available) return { refused: `Git cannot read the repository at ${repositoryPath}. Nothing was run.` };
		if (repository.failure !== null) return { refused: `Timber could not list the worktrees of ${repositoryPath}, so nothing was run: ${repository.failure}` };
		if (!repository.worktrees.some(worktree => worktree.path === worktreePath)) {
			return { refused: `Timber lists no worktree at ${worktreePath} in ${repositoryPath}. Nothing was run. Refresh the list.` };
		}
		return { executable: status.path };
	}

	async function preview(request: DonePreviewRequest): Promise<DonePreviewResult> {
		const { repository, path, options } = request;
		const shown = describeDonePreview(path, options);
		const failed = (failure: TimberFailure): DonePreviewResult => ({ outcome: "failed", failure });

		const located = await locate(repository, path);
		if ("refused" in located) return failed({ command: null, diagnostic: located.refused, output: null });

		// Standard output is the preview. Standard error is Timber's diagnostic when it refuses.
		let bytes: Uint8Array;
		let exitCode: number | null;
		let stopped: boolean;
		const errors = createOutputCapture();
		try {
			const child = Bun.spawn([located.executable, ...donePreviewArguments(path, options)], {
				cwd: repository,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				env: environment,
				timeout: PREVIEW_TIMEOUT_MS,
			});
			const collect = async (stream: ReadableStream<Uint8Array>) => {
				for await (const chunk of stream) errors.add(chunk);
			};
			const [printed] = await Promise.all([new Response(child.stdout).arrayBuffer(), collect(child.stderr), child.exited]);
			bytes = new Uint8Array(printed);
			exitCode = child.exitCode;
			stopped = child.signalCode !== null;
		} catch (error) {
			return failed({ command: shown, diagnostic: `Could not run the preview in ${repository}: ${messageOf(error)}`, output: null });
		}

		const output = errors.finish();
		if (stopped) {
			return failed({ command: shown, diagnostic: `The preview was stopped before it finished. The app waits ${PREVIEW_TIMEOUT_MS / 1000} seconds for it. Nothing was removed.`, output });
		}
		if (exitCode !== 0) {
			// Timber says why on one line of standard error. That line is shown as it is, not interpreted.
			const said = output.text.trim();
			if (said !== "" && !said.includes("\n") && !output.truncated) return failed({ command: shown, diagnostic: said.replace(/^error: /, ""), output: null });
			return failed({ command: shown, diagnostic: `The preview exited with code ${exitCode} and gave no preview. The details below show what it printed. Nothing was removed.`, output });
		}

		const reading = readDonePreview(new TextDecoder().decode(bytes));
		if (!reading.ok) return failed({ command: shown, diagnostic: reading.message, output: null });
		// The preview must answer the question that was asked, or it is not shown and cannot be approved.
		if (reading.preview.worktree.path !== path || reading.preview.repository.primaryWorktreeRoot !== repository) {
			return failed({ command: shown, diagnostic: `Timber answered with a preview for ${reading.preview.worktree.path} in ${reading.preview.repository.primaryWorktreeRoot}, not for ${path} in ${repository}. It was not used.`, output: null });
		}
		if (!previewMatchesOptions(reading.preview, options)) {
			return failed({ command: shown, diagnostic: "Timber answered with a preview for other options than the ones asked for. It was not used.", output: null });
		}

		const id = hold({ bytes, repository, path, expiresAt: reading.preview.expiresAt });
		return { outcome: "previewed", id, preview: reading.preview };
	}

	async function apply(request: DoneApplyRequest): Promise<DoneApplyResult> {
		const refused = (diagnostic: string): DoneApplyResult => ({ outcome: "failed", ran: false, failure: { command: null, diagnostic, output: null } });

		const approved = held.get(request.preview);
		// Used up by this call, whatever comes of it: a second Remove needs a preview the person has seen again.
		held.delete(request.preview);
		if (!approved) return refused("The app no longer holds that preview, so there is nothing to approve. Nothing was run. Ask for a new preview.");
		if (approved.repository !== request.repository || approved.path !== request.path) {
			return refused(`That preview is for ${approved.path}, not for ${request.path}. Nothing was run. Ask for a new preview.`);
		}
		// Timber checks this too. Stopping here spares a run that it would refuse.
		if (approved.expiresAt <= now()) return refused("The preview expired. Nothing was run. Ask for a new preview.");

		const located = await locate(request.repository, request.path);
		if ("refused" in located) return refused(located.refused);

		const run = await runTimberWithResultFile({
			executable: located.executable,
			command: "done",
			arguments: (resultFile, approvalFile) => doneApplyArguments(approvalFile, resultFile, approved.path),
			input: { bytes: approved.bytes, shownAs: APPROVAL_FILE_PLACEHOLDER },
			folder: request.repository,
			environment,
			...(temporaryRoot === undefined ? {} : { temporaryRoot }),
		});
		switch (run.result.outcome) {
			case "succeeded":
				return { outcome: "removed" };
			case "cancelled":
				return { outcome: "failed", ran: true, failure: { command: run.command, diagnostic: "Timber reported that the removal was cancelled.", output: run.output } };
			case "failed":
				return { outcome: "failed", ran: true, failure: failureOf(run)! };
		}
	}

	return { preview, apply };
}
