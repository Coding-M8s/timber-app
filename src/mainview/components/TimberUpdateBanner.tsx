import { TIMBER_INSTALL_COMMAND, describeTimberUpdate } from "../format";
import { useAppState, useStore } from "../store/react";
import { isRunning } from "../store/state";

/**
 * Across the top of the window while a newer Timber release is out than the
 * one in use. Nothing is taken away: terminals, agents, and Timber keep
 * working until the next start, which needs the newest release.
 */
export function TimberUpdateBanner() {
	const store = useStore();
	const state = useAppState();
	const text = describeTimberUpdate(state.timber?.known ? state.timber.status : null);
	if (text === null) return null;
	const checking = isRunning(state, "find-timber");
	return (
		<div className="update-banner" role="status">
			<div className="update-banner-text">
				<p className="update-banner-line">{text}</p>
				<code className="update-banner-command">{TIMBER_INSTALL_COMMAND}</code>
			</div>
			<button type="button" className="button" disabled={checking} onClick={() => void store.retryTimber()}>
				{checking ? "Checking" : "Check again"}
			</button>
		</div>
	);
}
