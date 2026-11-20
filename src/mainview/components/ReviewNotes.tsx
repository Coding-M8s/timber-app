import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { type ReviewNote, noteLocation } from "../../shared/review";
import { PASTE_TEXT_LIMIT, type PasteResult } from "../../shared/terminal";
import { useAppState, useStore } from "../store/react";
import {
	NO_REVIEW_AGENT, REVIEW_PASTE_NOTE, REVIEW_WAITS_WARNING, describeNoteCount, firstReviewSession, noteSummary, reviewSessions, reviewTooLong, waitsOnPerson,
} from "../review-format";
import { describeTerminalState } from "../terminal-format";

/** Ctrl+Enter, or Cmd+Enter, saves a note from its text field; Escape cancels. */
function noteKeys(event: KeyboardEvent<HTMLTextAreaElement>, save: () => void, cancel: () => void): void {
	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		save();
	} else if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		cancel();
	}
}

/**
 * The field a note is written or changed in, with Save and Cancel. Saving
 * keeps the note in the window: nothing is sent.
 */
export function NoteForm({ label, initial, onChange, onSave, onCancel }: {
	label: string;
	initial: string;
	/** Hears every change of the text, for a draft that keeps it. */
	onChange?: (text: string) => void;
	onSave: (text: string) => string | null;
	onCancel: () => void;
}) {
	const [text, setText] = useState(initial);
	const [problem, setProblem] = useState<string | null>(null);
	const problemId = useId();
	const save = () => setProblem(onSave(text));
	return (
		<div className="note-form">
			<textarea
				className="note-field"
				aria-label={label}
				aria-describedby={problem === null ? undefined : problemId}
				aria-invalid={problem !== null}
				value={text}
				rows={3}
				autoFocus
				onChange={event => {
					setText(event.target.value);
					onChange?.(event.target.value);
				}}
				onKeyDown={event => noteKeys(event, save, onCancel)}
			/>
			{problem !== null && <p className="note-problem" id={problemId} role="alert">{problem}</p>}
			<div className="note-buttons">
				<button type="button" className="button quiet" onClick={onCancel}>Cancel</button>
				<button type="button" className="button primary" onClick={save}>Save note</button>
			</div>
		</div>
	);
}

/** A kept note under the lines it is on, in the diff. */
export function InlineNote({ worktree, note }: { worktree: string; note: ReviewNote }) {
	const store = useStore();
	const [editing, setEditing] = useState(false);
	const shown = useRef<HTMLDivElement>(null);
	const [refocus, setRefocus] = useState(false);
	// After editing, the keyboard comes back to the note rather than falling to the top of the window.
	useEffect(() => {
		if (!editing && refocus) {
			shown.current?.focus();
			setRefocus(false);
		}
	}, [editing, refocus]);
	const stopEditing = () => {
		setEditing(false);
		setRefocus(true);
	};
	if (editing) {
		return (
			<div className="diff-note" data-note-id={note.id}>
				<NoteForm
					label={`Note on ${noteLocation(note)}`}
					initial={note.text}
					onSave={text => {
						const problem = store.editReviewNote(worktree, note.id, text);
						if (problem === null) stopEditing();
						return problem;
					}}
					onCancel={stopEditing}
				/>
			</div>
		);
	}
	return (
		<div ref={shown} className="diff-note" data-note-id={note.id} tabIndex={-1} aria-label={`Note on ${noteLocation(note)}`}>
			{note.outdated && <span className="note-outdated">outdated</span>}
			<p className="diff-note-text">{note.text}</p>
			<div className="note-buttons">
				<button type="button" className="text-button" onClick={() => setEditing(true)}>Edit</button>
				<button
					type="button"
					className="text-button"
					onClick={event => {
						// The note goes: the keyboard stays in the diff.
						const diff = event.currentTarget.closest<HTMLElement>(".diff-body");
						store.deleteReviewNote(worktree, note.id);
						diff?.focus();
					}}
				>
					Delete
				</button>
			</div>
		</div>
	);
}

/** One note in the Review list: where it is and its first line, which shows it in the diff, then Edit and Delete. */
function ReviewItem({ worktree, note, onShow }: { worktree: string; note: ReviewNote; onShow: () => void }) {
	const store = useStore();
	const [editing, setEditing] = useState(false);
	const location = noteLocation(note);
	if (editing) {
		return (
			<li className="review-item">
				<p className="review-location">{location}</p>
				<NoteForm
					label={`Note on ${location}`}
					initial={note.text}
					onSave={text => {
						const problem = store.editReviewNote(worktree, note.id, text);
						if (problem === null) setEditing(false);
						return problem;
					}}
					onCancel={() => setEditing(false)}
				/>
			</li>
		);
	}
	return (
		<li className="review-item">
			<button
				type="button"
				className="review-note"
				title={note.outdated ? "These lines changed or left the diff since the note. It is sent with the lines as they were." : `Show ${location}`}
				onClick={onShow}
			>
				<span className="review-location">{location}</span>
				{note.outdated && <span className="note-outdated">outdated</span>}
				<span className="review-summary">{noteSummary(note.text)}</span>
			</button>
			<div className="review-actions">
				<button type="button" className="text-button" aria-label={`Edit the note on ${location}`} onClick={() => setEditing(true)}>Edit</button>
				<button type="button" className="text-button" aria-label={`Delete the note on ${location}`} onClick={() => store.deleteReviewNote(worktree, note.id)}>Delete</button>
			</div>
		</li>
	);
}

/**
 * The review of a worktree: every note it has, on any file and in either
 * comparison, with Send review and Discard. Nothing is sent from here: Send
 * review opens the preview.
 */
export function ReviewList({ worktree }: { worktree: string }) {
	const store = useStore();
	const state = useAppState();
	const notes = state.reviews[worktree] ?? [];
	const [problem, setProblem] = useState<string | null>(null);
	const [discarding, setDiscarding] = useState(false);
	if (notes.length === 0) return null;
	return (
		<section className="review" aria-label="Review">
			<h2 className="change-group-title">
				Review
				<span className="change-group-count" aria-hidden="true">{notes.length}</span>
				<span className="visually-hidden">{describeNoteCount(notes.length)}</span>
			</h2>
			<ul className="review-items">
				{notes.map(note => (
					<ReviewItem
						key={note.id}
						worktree={worktree}
						note={note}
						onShow={() => void store.showReviewNote(worktree, note.id).then(setProblem)}
					/>
				))}
			</ul>
			{problem !== null && <p className="review-problem" role="status">{problem}</p>}
			{discarding ? (
				<div className="review-bar">
					<span className="review-question">Discard {describeNoteCount(notes.length)}?</span>
					<button type="button" className="button quiet" autoFocus onClick={() => setDiscarding(false)}>Keep</button>
					<button
						type="button"
						className="button danger"
						onClick={() => {
							setDiscarding(false);
							store.discardReview(worktree);
						}}
					>
						Discard
					</button>
				</div>
			) : (
				<div className="review-bar">
					<button type="button" className="text-button" onClick={() => setDiscarding(true)}>Discard</button>
					<button type="button" className="button primary" onClick={() => store.openDialog({ kind: "send-review", worktree })}>Send review</button>
				</div>
			)}
		</section>
	);
}

/**
 * The preview of a review before it goes anywhere: the agent to paste it
 * into, picked at first when there is only one, and the message exactly as
 * it will be pasted. Nothing is sent until Send. With no agent running, Copy
 * review is the way out.
 */
export function SendReviewDialog({ worktree }: { worktree: string }) {
	const store = useStore();
	const state = useAppState();
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const [message, setMessage] = useState<string | null>(null);
	const [prepared, setPrepared] = useState(false);
	const sessions = reviewSessions(state.terminals, worktree);
	const [picked, setPicked] = useState<string | null>(() => firstReviewSession(sessions));
	const [sending, setSending] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const chosen = sessions.find(session => session.id === picked) ?? null;
	const tooLong = message !== null && message.length > PASTE_TEXT_LIMIT;

	useEffect(() => {
		const element = dialog.current;
		const opener = document.activeElement;
		if (element && !element.open) element.showModal();
		return () => {
			element?.close();
			const lost = document.activeElement === null || document.activeElement === document.body;
			if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	}, []);

	useEffect(() => {
		let current = true;
		void store.prepareReview(worktree).then(text => {
			if (!current) return;
			setMessage(text);
			setPrepared(true);
		});
		return () => {
			current = false;
		};
	}, [store, worktree]);

	// A worktree whose notes are gone, such as one that left the list, has nothing to send.
	useEffect(() => {
		if (prepared && message === null) store.closeDialog();
	}, [prepared, message, store]);

	const send = async () => {
		if (chosen === null || message === null || tooLong || sending) return;
		setSending(true);
		setProblem(null);
		const result: PasteResult = await store.sendReview(worktree, chosen.id, message);
		setSending(false);
		if (result.outcome !== "pasted") setProblem(result.message);
	};

	return (
		<dialog
			ref={dialog}
			className="dialog review-dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				event.preventDefault();
				if (!sending) store.closeDialog();
			}}
		>
			<div className="dialog-form" aria-busy={sending || !prepared}>
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">Send review</h2>
				</header>
				<div className="dialog-fields">
					{sessions.length === 0 ? (
						<p className="dialog-note">{NO_REVIEW_AGENT}</p>
					) : (
						<fieldset className="review-agents" disabled={sending}>
							<legend className="field-label">Paste into</legend>
							{sessions.map(session => (
								<label key={session.id} className="review-agent">
									<input type="radio" name="review-agent" checked={picked === session.id} onChange={() => setPicked(session.id)} />
									<span className="review-agent-name">{session.name}</span>
									<span className="review-agent-state">{describeTerminalState(session)}</span>
								</label>
							))}
						</fieldset>
					)}
					{chosen !== null && waitsOnPerson(chosen) && <p className="review-warning" role="alert">{REVIEW_WAITS_WARNING}</p>}
					{message === null ? (
						<p className="dialog-note" role="status">Checking the noted lines</p>
					) : (
						<pre className="review-preview" tabIndex={0} aria-label="The review, exactly as it will be pasted">{message}</pre>
					)}
					{tooLong && <p className="review-warning" role="alert">{reviewTooLong(message.length)}</p>}
					{sessions.length > 0 && <p className="dialog-note">{REVIEW_PASTE_NOTE}</p>}
				</div>
				{problem !== null && (
					<div className="sidebar-error" role="alert">
						<p className="sidebar-error-title">The review was not pasted</p>
						<p className="sidebar-error-text">{problem}</p>
					</div>
				)}
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button type="button" className="button quiet" disabled={sending} onClick={() => store.closeDialog()}>Cancel</button>
						<button type="button" className={sessions.length === 0 ? "button primary" : "button quiet"} disabled={message === null || sending} onClick={() => {
							if (message !== null) void store.copyReview(message).then(copied => copied || setProblem("The review could not be put on the clipboard."));
						}}>
							Copy review
						</button>
						{sessions.length > 0 && (
							<button type="button" className="button primary" disabled={chosen === null || message === null || tooLong || sending} onClick={() => void send()}>
								{sending ? "Pasting" : "Send"}
							</button>
						)}
					</div>
				</footer>
			</div>
		</dialog>
	);
}
