import { describeCommandLine } from "./command-line";
import type { Repository } from "./model";
import { timberSetupArguments } from "./timber-config";

/**
 * First-run setup of a repository: the pure rules of the setup prompt.
 *
 * Until settings can be saved through Timber from the app, "Set up Timber"
 * runs Timber's own guided `timber setup` for the repository in a terminal
 * session (`timberSetup` in `OpenTerminalRequest`). The main process builds
 * that command from the Timber it found, never from a request.
 */

/** What the setup prompt shows before anything runs. */
export const SETUP_COMMAND = describeCommandLine(["timber", ...timberSetupArguments("repository")]);

/**
 * Whether to offer setup for a repository: only one that is there, that
 * Timber could list, that has neither its own settings nor machine defaults,
 * and whose prompt the person did not dismiss. Setup is always optional, so
 * this never blocks anything else.
 */
export function showsSetupPrompt(repository: Pick<Repository, "path" | "available" | "failure" | "setup">, dismissed: readonly string[]): boolean {
	return repository.available
		&& repository.failure === null
		&& repository.setup === "none"
		&& !dismissed.includes(repository.path);
}
