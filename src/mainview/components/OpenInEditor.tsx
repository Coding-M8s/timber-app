import { useId } from "react";
import type { Worktree } from "../../shared/model";
import { type EditorAction, OPEN_IN_EDITOR, describeEditorAction, describeEditorProblem } from "../editor-format";
import { folderName, worktreeLabel } from "../format";
import { BEING_REMOVED_REASON } from "../done-format";
import { useAppState, useStore } from "../store/react";
import { isBeingRemoved } from "../store/state";

/** What "Open in editor" offers for one worktree of a repository, or one file in it, and what pressing it does. */
export function useOpenInEditor(repository: string, worktree: Worktree, file?: string): { action: EditorAction; open: () => void } {
	const store = useStore();
	const state = useAppState();
	const running = state.operations.some(operation => operation.kind === "open-in-editor" && operation.worktree === worktree.path);
	const described = describeEditorAction(state.preferences.editor, worktree, running, file);
	// The row already says that Timber removes the worktree, so no reason shows beside the button.
	const action = isBeingRemoved(state, repository, worktree.path)
		? { ...described, available: false, opensSettings: false, tooltip: `${OPEN_IN_EDITOR}. ${BEING_REMOVED_REASON}`, reason: null }
		: described;
	return { action, open: () => void store.openInEditor(file === undefined ? { repository, worktree: worktree.path } : { repository, worktree: worktree.path, file }) };
}

export function EditorIcon() {
	return (
		<svg aria-hidden="true" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
			<path d="M8 2.5h3.5V6" />
			<path d="M11.5 2.5 6.5 7.5" />
			<path d="M10 8.5v3H2.5V4h3" />
		</svg>
	);
}

/** The small "Open in editor" beside a worktree row. Its tooltip shows the exact command. */
export function OpenInEditorIconButton({ repository, worktree }: { repository: string; worktree: Worktree }) {
	const { action, open } = useOpenInEditor(repository, worktree);
	const reasonId = useId();
	return (
		<>
			<button
				type="button"
				className="icon-button row-editor"
				aria-label={`${OPEN_IN_EDITOR}: ${worktreeLabel(worktree)}`}
				aria-describedby={action.reason === null ? undefined : reasonId}
				aria-haspopup={action.opensSettings ? "dialog" : undefined}
				title={action.tooltip}
				disabled={!action.available}
				onClick={open}
			>
				<EditorIcon />
			</button>
			{action.reason !== null && <span id={reasonId} hidden>{action.reason}</span>}
		</>
	);
}

/** "Open in editor" in the workspace header, with the reason beside it when it cannot open anything. */
export function OpenInEditorButton({ repository, worktree }: { repository: string; worktree: Worktree }) {
	const { action, open } = useOpenInEditor(repository, worktree);
	return (
		<>
			<button
				type="button"
				className="button workspace-editor"
				title={action.tooltip}
				aria-haspopup={action.opensSettings ? "dialog" : undefined}
				disabled={!action.available}
				onClick={open}
			>
				<EditorIcon />
				{OPEN_IN_EDITOR}
			</button>
			{action.reason !== null && <span className="workspace-done-note">{action.reason}</span>}
		</>
	);
}

/** Why the last "Open in editor" opened nothing, with the command, until it is dismissed. */
export function EditorProblemNote() {
	const store = useStore();
	const state = useAppState();
	const problem = state.editorProblem;
	if (problem === null) return null;
	const worktree = state.repositories.flatMap(repository => repository.worktrees).find(candidate => candidate.path === problem.worktree);
	const { title, text, command } = describeEditorProblem(problem, problem.file ?? (worktree ? worktreeLabel(worktree) : folderName(problem.worktree)));
	return (
		<div className="sidebar-error editor-problem" role="alert">
			<p className="sidebar-error-title">{title}</p>
			<p className="sidebar-error-text">{text}</p>
			{command !== null && <pre className="dialog-command" aria-label="Editor command">{command}</pre>}
			<button type="button" className="text-button" onClick={() => store.dismissEditorProblem()}>Dismiss</button>
		</div>
	);
}
