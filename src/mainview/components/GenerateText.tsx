import { type GenerateKind, textNotices } from "../../shared/generate-text";
import { GENERATE_BUTTON, GENERATE_FAILED, STOP_BUTTON, describeHeld } from "../generate-format";
import type { GenerationRun } from "../store/state";
import { useStore } from "../store/react";

/** The spark of every button that has an agent write. */
export function SparkIcon() {
	return (
		<svg className="spark-icon" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
			<path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" />
		</svg>
	);
}

/**
 * Generate, in the corner of the box it writes in, and Stop in its place
 * while it runs. Disabled, it stays reachable by keyboard, so its reason is
 * read: `title` is the reason then, and the exact command otherwise.
 */
export function GenerateButton({ run, title, blocked, onGenerate, onStop }: { run: GenerationRun | undefined; title: string; blocked: boolean; onGenerate: () => void; onStop: () => void }) {
	if (run?.running) return <button type="button" className="text-button generate-in-box" onClick={onStop}>{STOP_BUTTON}</button>;
	return (
		<button type="button" className="text-button spark-button generate-in-box" title={title} aria-disabled={blocked} onClick={() => !blocked && onGenerate()}>
			<SparkIcon />{GENERATE_BUTTON}
		</button>
	);
}

/** What a run left beside its field: text that waits, or why there is none. */
export function GenerationOutcome({ worktree, kind, run, what }: { worktree: string; kind: GenerateKind; run: GenerationRun | undefined; what: string }) {
	const store = useStore();
	if (!run || run.running) return null;
	if (run.problem !== null) {
		return (
			<div className="sidebar-error" role="alert">
				<p className="sidebar-error-title">{GENERATE_FAILED[kind]}</p>
				{run.problem.command !== null && <p className="sidebar-error-text"><code>{run.problem.command}</code></p>}
				<pre className="commit-output">{run.problem.message}</pre>
			</div>
		);
	}
	if (run.held === null) return null;
	const { title, text, use, drop } = describeHeld(run, what);
	return (
		<div className="generated-held" role="status">
			<p className="generated-held-title">{title}</p>
			<p className="generated-held-text">{text}</p>
			<pre className="commit-output">{run.held.kind === "commit" ? run.held.message : `${run.held.title}\n\n${run.held.body}`}</pre>
			<div className="generated-held-actions">
				<button type="button" className="text-button" onClick={() => store.fillHeld(worktree, kind)}>{use}</button>
				<button type="button" className="text-button" onClick={() => store.dropGenerated(worktree, kind)}>{drop}</button>
			</div>
		</div>
	);
}

/** What text for a host holds that should be seen before it is published. Nothing when there is none. */
export function GeneratedNotices({ text }: { text: string }) {
	const notices = textNotices(text);
	if (notices.length === 0) return null;
	return (
		<div className="generated-notice" role="note">
			<p className="generated-held-title">Check before you publish</p>
			<ul>{notices.map(notice => <li key={notice}>{notice}</li>)}</ul>
		</div>
	);
}
