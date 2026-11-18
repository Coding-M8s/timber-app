import type { ShownStatus } from "../../shared/session-status";

/**
 * The shape of a session's status, so it is never told by color alone:
 * an open ring while working, a diamond when it needs the person (a raised
 * hand when what it needs is an answer to a question), a check
 * when done, a hollow circle when idle, a cross for an error, a crossed
 * circle when it crashed, a square once it stopped, and a dot while it runs
 * with no status. The color comes from the `status-<kind>` class. Hidden
 * from assistive technology: the words are always beside it or in a
 * description.
 */
export function StatusGlyph({ status }: { status: ShownStatus }) {
	const { kind } = status;
	const question = status.kind === "needs-you" && status.reason === "question";
	return (
		<svg className={`status-glyph status-${kind}`} aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			{kind === "working" && <path d="M5 1.2a3.8 3.8 0 1 1-3.8 3.8" />}
			{kind === "needs-you" && !question && <path d="M5 0.8 9.2 5 5 9.2 0.8 5Z" fill="currentColor" strokeWidth="1" />}
			{question && (
				// A raised hand: four fingers, the thumb, and the palm.
				<path
					className="status-hand"
					d="M3 5.4V2.6M4.7 4.9V1.4M6.4 4.9V1.8M8.1 5.4V3M3 5.4v.9a3 3 0 0 0 3 3h.1a2 2 0 0 0 2-2V5.4M3 6.6 1.6 5.2"
					strokeWidth="1.2"
				/>
			)}
			{kind === "done" && <path d="M1.5 5.3 4 7.8 8.5 2.4" />}
			{kind === "idle" && <circle cx="5" cy="5" r="3.4" />}
			{kind === "error" && <path d="M2 2 8 8M8 2 2 8" />}
			{kind === "crashed" && (
				<>
					<circle cx="5" cy="5" r="4" strokeWidth="1.2" />
					<path d="M3.3 3.3 6.7 6.7M6.7 3.3 3.3 6.7" strokeWidth="1.3" />
				</>
			)}
			{kind === "stopped" && <rect x="2" y="2" width="6" height="6" rx="0.8" fill="currentColor" strokeWidth="0" />}
			{kind === "unknown" && <circle cx="5" cy="5" r="3" fill="currentColor" strokeWidth="0" />}
		</svg>
	);
}
