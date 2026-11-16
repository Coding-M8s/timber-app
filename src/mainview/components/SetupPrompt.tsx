import type { Repository } from "../../shared/model";
import { TIMBER_SETUP_SESSION_NAME } from "../../shared/terminal";
import { SETUP_COMMAND, showsSetupPrompt } from "../../shared/timber-setup";
import { useAppState, useStore } from "../store/react";
import { timberSetupTarget } from "../store/state";

/**
 * The first-run prompt for a repository that was never set up for Timber:
 * a short explanation, the command that "Set up Timber" runs, and "Not now".
 * Setup is optional. The repository works the same without it, and the
 * prompt goes once Timber's settings exist or the person dismissed it.
 * Setup runs as in Settings: in the repository's primary checkout, where a
 * reason it could not start shows on that worktree's sessions.
 */
export function SetupPrompt({ repository }: { repository: Repository }) {
	const store = useStore();
	const state = useAppState();
	if (!showsSetupPrompt(repository, state.layout.setupDismissed)) return null;

	const target = timberSetupTarget(state, "repository", repository.path);
	const starting = target.ok && state.operations.some(operation =>
		operation.kind === "open-terminal" && operation.worktree === target.worktree.id && operation.agent === TIMBER_SETUP_SESSION_NAME);
	const running = state.terminals.some(session => session.kind === "timber" && session.repository === repository.path && session.state.kind === "running");

	return (
		<section className="setup-prompt" aria-label="Set up Timber">
			<div className="setup-prompt-body">
				<p className="setup-prompt-title">{repository.name} is not set up for Timber yet</p>
				<p className="setup-prompt-text">
					Everything works with Timber's defaults. Setup saves your editor, agent, setup scripts, and starting branch for this repository. It is optional.
				</p>
				<p className="setup-prompt-text">
					{running ? "Setup runs in a session of this repository." : "Runs in a new session in the primary checkout:"} <code className="setup-prompt-command">{SETUP_COMMAND}</code>
				</p>
				{!running && !target.ok && <p className="setup-prompt-text">{target.reason}</p>}
			</div>
			<div className="setup-prompt-actions">
				<button type="button" className="button" disabled={starting || (!running && !target.ok)} onClick={() => void store.setUpRepository(repository.path)}>
					{starting ? "Starting setup" : running ? "Show setup" : "Set up Timber"}
				</button>
				<button type="button" className="button quiet" disabled={starting} onClick={() => store.dismissSetup(repository.path)}>
					Not now
				</button>
			</div>
		</section>
	);
}
