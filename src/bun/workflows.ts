import type { TimberStatus } from "../shared/model";
import { APP_CONFIG_READ_ARGUMENTS, APP_CONFIG_READ_COMMAND, type WorkflowList, readWorkflowList } from "../shared/workflows";
import { runTimberRecord, withReadyTimber } from "./timber-record";

/** Reading settings is offline and takes well under a second, so anything this slow is stuck. */
export const READ_WORKFLOWS_TIMEOUT_MS = 10_000;

/** A settings record is small. Anything past this is not one, and is not read. */
const RECORD_LIMIT_BYTES = 1024 * 1024;

export interface WorkflowReaderOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	environment?: Record<string, string | undefined>;
	/** How long Timber may take. Ten seconds by default. */
	timeoutMs?: number;
}

export interface WorkflowReader {
	/** The named workflows of a repository from the list, named by the path of its primary checkout. */
	list(repository: string): Promise<WorkflowList>;
}

/**
 * Run `timber __app-config read --scope repository` in a folder and read its
 * workflows. Timber is run as an executable plus an argument array, never
 * through a shell, with standard input closed, and reading changes nothing.
 *
 * What Timber printed is private: the record says whether credentials are
 * saved, and workflow arguments can hold tokens. It goes only to the reader,
 * and nothing of it is logged here.
 */
export async function readWorkflows(
	executable: string,
	folder: string,
	environment: Record<string, string | undefined> = process.env,
	timeoutMs: number = READ_WORKFLOWS_TIMEOUT_MS,
): Promise<WorkflowList> {
	const output = await runTimberRecord({
		executable, arguments: APP_CONFIG_READ_ARGUMENTS, folder, environment, timeoutMs, limitBytes: RECORD_LIMIT_BYTES,
		command: APP_CONFIG_READ_COMMAND, where: `in ${folder}`, tooLong: "a settings record holds. Its workflows were not read.",
	});
	if (!output.ok) return output;
	return readWorkflowList(output.record, output.diagnostic, output.exitCode);
}

/** Reading workflows, only for a repository in the app's list and only while Timber is ready. */
export function createWorkflowReader(options: WorkflowReaderOptions): WorkflowReader {
	const { timber, isListed, environment, timeoutMs } = options;
	return {
		async list(repository) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			if (typeof repository !== "string" || repository === "") return { ok: false, message: "The request for workflows names no repository." };
			return withReadyTimber({
				timber, isListed, repository, couldNot: `read the workflows of ${repository}`,
				fail: message => ({ ok: false, message }),
				run: executable => readWorkflows(executable, repository, environment ?? process.env, timeoutMs),
			});
		},
	};
}
