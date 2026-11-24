import { useEffect, useId, useRef } from "react";
import { commitBlocker } from "../../shared/commit-staged";
import type { FileChange } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import {
	COMMITTING, COMMIT_BUTTON, COMMIT_FAILED, COMMIT_FROM_BASE_BUTTON, COMMIT_FROM_BASE_TITLE, COMMIT_MESSAGE_LABEL, COMMIT_MESSAGE_PLACEHOLDER,
	commitStateOf, describeCommitButton, describeCommitted, isCommitKey,
} from "../commit-format";
import { describeSyncControls } from "../sync-action-format";
import { useAppState, useStore } from "../store/react";
import { type ChangesView, syncOptionsOf, writesWait } from "../store/state";

const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/**
 * The top of the Changes view in Uncommitted: the commit message box and
 * Commit, which commits only what is staged (`git commit -F -`, shown in its
 * tooltip and while it runs). Ctrl+Enter, or Cmd+Enter on macOS, commits from
 * the box. Commit is disabled, with the reason beside it, while nothing is
 * staged, the message is empty, a merge or rebase is in progress, or HEAD is
 * detached. After a commit it says the commit, with the row's Push when the
 * row offers one; when none is made, it shows what Git and the hooks printed,
 * and the message stays.
 *
 * `focusWanted` gives the box the keyboard once, as Base's Commit… asks.
 */
export function CommitBox({ repository, worktree, view, focusWanted, onFocused }: {
	repository: Repository;
	worktree: Worktree;
	view: ChangesView & { files: readonly FileChange[] };
	focusWanted: boolean;
	onFocused: () => void;
}) {
	const store = useStore();
	const state = useAppState();
	const boxId = useId();
	const noteId = useId();
	const box = useRef<HTMLTextAreaElement>(null);
	const message = state.commitMessages[worktree.id] ?? "";
	const blocker = commitBlocker(commitStateOf(view, message));
	const run = state.commitRuns[worktree.id];
	const running = run?.running === true;
	const disabled = blocker !== null || writesWait(state, view);
	const committed = run?.committed ?? null;
	const problem = run?.problem ?? null;
	const push = committed === null ? undefined : describeSyncControls(worktree, syncOptionsOf(state, repository.path, worktree.path)).find(control => control.action === "push");

	useEffect(() => {
		if (!focusWanted) return;
		box.current?.focus();
		onFocused();
	}, [focusWanted, onFocused]);

	const commit = () => {
		if (!disabled) void store.commitStaged();
	};

	return (
		<div className="commit-box">
			<label htmlFor={boxId} className="visually-hidden">{COMMIT_MESSAGE_LABEL}</label>
			<textarea
				id={boxId}
				ref={box}
				className="commit-message"
				rows={3}
				placeholder={COMMIT_MESSAGE_PLACEHOLDER}
				value={message}
				readOnly={running}
				spellCheck={true}
				aria-describedby={noteId}
				onChange={event => store.setCommitMessage(worktree.id, event.target.value)}
				onKeyDown={event => {
					if (!isCommitKey(event)) return;
					event.preventDefault();
					commit();
				}}
			/>
			<div className="commit-actions">
				<p className="commit-note" id={noteId} role="status">{running ? COMMITTING : blocker ?? ""}</p>
				<button type="button" className="button primary commit-button" disabled={disabled} title={describeCommitButton(mac)} aria-describedby={noteId} onClick={commit}>
					{COMMIT_BUTTON}
				</button>
			</div>
			{committed !== null && (
				<div className="commit-done">
					<span role="status">{describeCommitted(committed.short)}</span>
					{push && (
						<button
							type="button"
							className="text-button"
							title={push.title}
							aria-haspopup="dialog"
							onClick={() => store.openDialog({ kind: "sync-action", action: "push", repository: repository.path, worktree: worktree.id })}
						>
							Push
						</button>
					)}
				</div>
			)}
			{problem !== null && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">{COMMIT_FAILED}</p>
					{problem.command !== null && <p className="sidebar-error-text"><code>{problem.command}</code></p>}
					<pre className="commit-output">{problem.message}</pre>
				</div>
			)}
		</div>
	);
}

/** Base's stand-in for the box: switches to Uncommitted, where the box takes the keyboard. */
export function CommitFromBase({ onChoose }: { onChoose: () => void }) {
	return (
		<div className="commit-box commit-from-base">
			<button type="button" className="text-button" title={COMMIT_FROM_BASE_TITLE} onClick={onChoose}>{COMMIT_FROM_BASE_BUTTON}</button>
		</div>
	);
}
