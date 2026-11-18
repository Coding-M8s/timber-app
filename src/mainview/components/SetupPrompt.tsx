import type { Repository } from "../../shared/model";
import { showsSetupPrompt } from "../../shared/timber-setup";
import { useAppState, useStore } from "../store/react";
import { timberReady } from "../store/state";

/**
 * The first-run prompt for a repository that was never set up for Timber:
 * a short explanation, "Set up Timber", and "Not now". Setup is optional.
 * The repository works the same without it, and the prompt goes once
 * Timber's settings exist or the person dismissed it. "Set up Timber"
 * opens the setup wizard (SetupWizardDialog.tsx) for this repository, which
 * saves through Timber and shows the command before it runs.
 */
export function SetupPrompt({ repository }: { repository: Repository }) {
	const store = useStore();
	const state = useAppState();
	if (!showsSetupPrompt(repository, state.layout.setupDismissed)) return null;
	// The wizard reads and saves through Timber, so it opens only once Timber is ready, in a repository that is there.
	const canOpen = timberReady(state) && repository.available;

	return (
		<section className="setup-prompt" aria-label="Set up Timber">
			<div className="setup-prompt-body">
				<p className="setup-prompt-title">{repository.name} is not set up for Timber yet</p>
				<p className="setup-prompt-text">
					Everything works with Timber's defaults. Setup saves your editor, agent, setup scripts, and starting branch for this repository. It is optional.
				</p>
			</div>
			<div className="setup-prompt-actions">
				<button type="button" className="button" disabled={!canOpen} onClick={() => store.openDialog({ kind: "set-up-timber", repository: repository.path })}>
					Set up Timber
				</button>
				<button type="button" className="button quiet" onClick={() => store.dismissSetup(repository.path)}>
					Not now
				</button>
			</div>
		</section>
	);
}
