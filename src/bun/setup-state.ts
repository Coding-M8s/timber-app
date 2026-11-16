import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SetupState } from "../shared/model";
import { REPOSITORY_CONFIG_FILE, machineConfigPath } from "../shared/timber-config";

type Environment = Record<string, string | undefined>;

/** Whether a file is there: true, false when it surely is not, or null when that could not be told. */
async function present(path: string | null): Promise<boolean | null> {
	if (path === null) return null;
	try {
		await stat(path);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? false : null;
	}
}

/**
 * Which Timber settings apply to the repository whose primary checkout is
 * `primaryRoot`. Only reads whether the two files Timber reads are there,
 * found as Timber finds them (`machineConfigPath`), never what is in them
 * and never through Timber: `timber ls` already reports settings it cannot
 * read as a failure. A `.timber.toml` in a linked worktree does not count,
 * because Timber does not read it.
 */
export async function readSetupState(
	primaryRoot: string,
	environment: Environment = process.env,
	platform: string = process.platform,
	home: () => string = homedir,
): Promise<SetupState> {
	const own = await present(join(primaryRoot, REPOSITORY_CONFIG_FILE));
	if (own === true) return "repository";
	const machine = await present(machineConfigPath(environment, platform, home()));
	if (machine === true) return "machine";
	return own === false && machine === false ? "none" : "unknown";
}
