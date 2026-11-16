import type { TimberFailure } from "../../shared/model";
import { OUTPUT_PRIVACY_NOTE, describeOutput } from "../format";

interface TimberFailureDetailsProps {
	/** What did not work, in the dialog's words, for example "Could not create the worktree". */
	title: string;
	failure: TimberFailure;
}

/**
 * How every failed Timber command is reported: the diagnostic, the command
 * that ran, and what it printed in a details area that starts closed.
 */
export function TimberFailureDetails({ title, failure }: TimberFailureDetailsProps) {
	const { command, diagnostic, output } = failure;
	return (
		<div className="failure" role="alert">
			<p className="failure-title">{title}</p>
			<p className="failure-diagnostic">{diagnostic}</p>
			{(command !== null || output !== null) && (
				<details className="failure-details">
					<summary>Details</summary>
					{command !== null && <pre className="failure-command">{command}</pre>}
					{output !== null && (
						<>
							<p className="failure-note">{describeOutput(output)}</p>
							{output.text.trim() !== "" && (
								<>
									<pre className="failure-output" tabIndex={0} aria-label="What the command printed">{output.text}</pre>
									<p className="failure-note">{OUTPUT_PRIVACY_NOTE}</p>
								</>
							)}
						</>
					)}
				</details>
			)}
		</div>
	);
}
