import type { TimberStatus } from "../../shared/model";
import { TIMBER_INSTALL_COMMAND, TIMBER_INSTALL_GUIDE, describeTimberProblem } from "../format";

interface TimberNoticeProps {
	/** Null when looking for Timber itself failed; `failure` then says why. */
	status: TimberStatus | null;
	failure: string | null;
	checking: boolean;
	onRetry: () => void;
	/** Open Settings, Timber, Executable, to choose another Timber. */
	onChoose: () => void;
}

/** Fills the window while Timber is missing or too old, in place of the worktree list. */
export function TimberNotice({ status, failure, checking, onRetry, onChoose }: TimberNoticeProps) {
	const problem = status ? describeTimberProblem(status) : null;
	return (
		<main className="notice" aria-live="polite">
			<h1 className="notice-title">{problem?.title ?? "Could not look for Timber"}</h1>
			<p className="notice-text">{problem?.text ?? failure}</p>
			{problem && problem.action !== null && (
				<>
					<p className="notice-text">{problem.action}</p>
					<pre className="notice-command">{TIMBER_INSTALL_COMMAND}</pre>
					<p className="notice-hint">
						The installer puts timber in ~/.local/bin, so that folder must be on your PATH.
						For other platforms and manual steps, see {TIMBER_INSTALL_GUIDE}
					</p>
				</>
			)}
			<div className="notice-actions">
				<button type="button" className="button" disabled={checking} onClick={onRetry}>
					{checking ? "Checking" : "Retry"}
				</button>
				<button type="button" className="button quiet" onClick={onChoose}>Choose Timber</button>
			</div>
		</main>
	);
}
