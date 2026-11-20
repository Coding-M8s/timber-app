import { TIMBER_LS_ARGUMENTS, TIMBER_LS_COMMAND, type TimberListing, readTimberListing } from "../shared/timber-ls";
import { messageOf } from "../shared/error-message";

/** Listing is offline and takes well under a second, so anything this slow is stuck. */
const LIST_TIMEOUT_MS = 10_000;

/**
 * Run `timber ls --json` with `folder` as the working directory and read its
 * record. Timber is run as an executable plus an argument array, never through
 * a shell, and listing changes nothing in the repository.
 *
 * Only standard output is the record. Timber's warnings go to standard error,
 * which is not read: a failure is explained by the record's own diagnostic.
 */
export async function listWorktrees(
	executable: string,
	folder: string,
	environment: Record<string, string | undefined> = process.env,
): Promise<TimberListing> {
	let stdout: string;
	let exitCode: number | null;
	let stopped: boolean;
	try {
		const child = Bun.spawn([executable, ...TIMBER_LS_ARGUMENTS], {
			cwd: folder,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			env: environment,
			timeout: LIST_TIMEOUT_MS,
		});
		stdout = await new Response(child.stdout).text();
		await child.exited;
		exitCode = child.exitCode;
		stopped = child.signalCode !== null;
	} catch (error) {
		return { ok: false, message: `Could not run ${TIMBER_LS_COMMAND} in ${folder}: ${messageOf(error)}` };
	}
	if (stopped) {
		return { ok: false, message: `${TIMBER_LS_COMMAND} in ${folder} was stopped before it finished. The app waits ${LIST_TIMEOUT_MS / 1000} seconds for it.` };
	}
	return readTimberListing(stdout, exitCode);
}
