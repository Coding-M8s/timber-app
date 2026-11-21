import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { promptTarget, reviewWaiting, runningAgents, waitsOnPerson } from "../agent-sessions";
import { AgentChoices } from "./AgentChoices";
import { estimateTerminalSize } from "./TerminalPanel";
import { describeAgentCommand } from "../../shared/agent";
import { type ReviewNote, noteLocation, noteSpan, quotedParts } from "../../shared/review";
import { cleanLine } from "../../shared/safe-text";
import { splitPath } from "../changes-format";
import { PASTE_TEXT_LIMIT, type PasteResult } from "../../shared/terminal";
import { useAppState, useStore } from "../store/react";
import {
	CLOSE_REVIEW, EMPTY_LINE, NEW_REVIEW_AGENT_NOTE, NO_REVIEW_AGENT, OUTDATED_REFERENCE, REVIEW_PASTE_NOTE, REVIEW_TOGGLE_TITLE, REVIEW_WAITS_WARNING,
	describeNewReviewAgent, describeNoteCount, describeReference, reviewAlreadyWaiting, reviewTooLong,
} from "../review-format";

/** The radio value of the "new agent" choice; session ids never take this form. */
const NEW_AGENT = "\0new";

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

/** The reference a note leads with: where it is and its first line, as a button that shows those lines in the diff. */
function NoteReference({ note, chosen, onShow }: { note: ReviewNote; chosen: boolean; onShow: () => void }) {
	const location = noteLocation(note);
	const { folder, name } = splitPath(cleanLine(note.file.path));
	const { lines, removed } = noteSpan(note);
	const first = quotedParts(note.lines[0]!);
	return (
		<button
			type="button"
			className={`review-ref${chosen ? " chosen" : ""}`}
			data-note-id={note.id}
			aria-current={chosen ? "true" : undefined}
			aria-label={describeReference(location, note.outdated)}
			title={note.outdated ? OUTDATED_REFERENCE : `Show ${location}`}
			onClick={onShow}
		>
			<span className="review-ref-place">
				<span className="review-ref-path">
					{folder !== "" && <span className="review-ref-folder">{folder}/</span>}
					<span className="review-ref-name">{name}:{lines}</span>
				</span>
				{note.outdated
					? <span className="review-ref-tag outdated">outdated</span>
					: removed && <span className="review-ref-tag">{note.lines.length === 1 ? "removed line" : "removed lines"}</span>}
			</span>
			<span className="review-ref-line">
				<span className={`review-ref-marker ${note.lines[0]!.kind}`}>{first.marker}</span>
				{first.text.trim() === "" ? <span className="review-ref-empty">{EMPTY_LINE}</span> : first.text}
			</span>
		</button>
	);
}

/** One note in the Review panel: its reference, what was written, then Edit and Delete. */
function ReviewItem({ worktree, note, chosen, problem, onShow, onDelete }: {
	worktree: string;
	note: ReviewNote;
	chosen: boolean;
	problem: string | null;
	onShow: () => void;
	onDelete: () => void;
}) {
	const store = useStore();
	const [editing, setEditing] = useState(false);
	const item = useRef<HTMLLIElement>(null);
	const location = noteLocation(note);
	// After editing, the keyboard comes back to the note's reference rather than falling to the top of the window.
	const stopEditing = () => {
		setEditing(false);
		setTimeout(() => item.current?.querySelector<HTMLElement>(".review-ref")?.focus());
	};
	return (
		<li ref={item} className="review-item">
			<NoteReference note={note} chosen={chosen} onShow={onShow} />
			{editing ? (
				<NoteForm
					label={`Note on ${location}`}
					initial={note.text}
					onSave={text => {
						const problem = store.editReviewNote(worktree, note.id, text);
						if (problem === null) stopEditing();
						return problem;
					}}
					onCancel={stopEditing}
				/>
			) : (
				<>
					<p className="review-text">{note.text}</p>
					<div className="note-buttons">
						<button type="button" className="text-button" aria-label={`Edit the note on ${location}`} onClick={() => setEditing(true)}>Edit</button>
						<button type="button" className="text-button" aria-label={`Delete the note on ${location}`} onClick={onDelete}>Delete</button>
					</div>
				</>
			)}
			{problem !== null && <p className="review-problem" aria-hidden="true">{problem}</p>}
		</li>
	);
}

/**
 * The review of a worktree, in a panel beside the diff: every note it has,
 * on any file and in either comparison, each led by a reference to its
 * lines, with Send review and Discard below. Nothing is sent from here:
 * Send review opens the preview. In a narrow window the panel opens over
 * the diff (`open`), and `onClose` closes it.
 */
export function ReviewPanel({ worktree, id, open, onClose, onShown, onGone }: {
	worktree: string;
	id: string;
	open: boolean;
	onClose: () => void;
	/** A reference was chosen. */
	onShown: () => void;
	/** The last note went, and the keyboard needs somewhere to go. */
	onGone: () => void;
}) {
	const store = useStore();
	const state = useAppState();
	const notes = state.reviews[worktree] ?? [];
	const panel = useRef<HTMLElement>(null);
	const closeButton = useRef<HTMLButtonElement>(null);
	const discardButton = useRef<HTMLButtonElement>(null);
	const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
	const [discarding, setDiscarding] = useState(false);
	const chosen = state.chosenNote?.worktree === worktree ? state.chosenNote.id : null;

	// Opened over the diff, the keyboard goes into the panel.
	useEffect(() => {
		if (open) closeButton.current?.focus();
	}, [open]);

	// A review that went some other way, such as sent, does not come back asking to be discarded.
	useEffect(() => {
		if (notes.length === 0) setDiscarding(false);
	}, [notes.length]);

	if (notes.length === 0) return null;

	const remove = (index: number) => {
		const next = notes[index + 1] ?? notes[index - 1];
		store.deleteReviewNote(worktree, notes[index]!.id);
		// The keyboard goes to the next note's reference, or the one before, rather than falling to the top of the window.
		if (next) setTimeout(() => panel.current?.querySelector<HTMLElement>(`.review-ref[data-note-id="${CSS.escape(next.id)}"]`)?.focus());
		else onGone();
	};

	return (
		<aside ref={panel} id={id} className={`review-panel${open ? " open" : ""}`} aria-label="Review">
			<div className="review-head">
				<h2 className="change-group-title">
					Review
					<span className="change-group-count" aria-hidden="true">{notes.length}</span>
					<span className="visually-hidden">{describeNoteCount(notes.length)}</span>
				</h2>
				<button ref={closeButton} type="button" className="text-button review-close" aria-label={CLOSE_REVIEW} onClick={onClose}>Close</button>
			</div>
			<ul className="review-items">
				{notes.map((note, index) => (
					<ReviewItem
						key={note.id}
						worktree={worktree}
						note={note}
						chosen={note.id === chosen}
						problem={problem?.id === note.id ? problem.text : null}
						onShow={() => {
							setProblem(null);
							// Over the diff, the panel closes to show the lines; when they cannot show, it stays open to say why.
							void store.showReviewNote(worktree, note.id).then(text => {
								setProblem(text === null ? null : { id: note.id, text });
								if (text === null) onShown();
							});
						}}
						onDelete={() => remove(index)}
					/>
				))}
			</ul>
			{/* Always there, so what choosing a reference found is heard; the note's box shows it too. */}
			<p className="visually-hidden" role="status">{problem?.text ?? ""}</p>
			{discarding ? (
				<div className="review-bar">
					<span className="review-question">Discard {describeNoteCount(notes.length)}?</span>
					<button
						type="button"
						className="button quiet"
						autoFocus
						onClick={() => {
							setDiscarding(false);
							setTimeout(() => discardButton.current?.focus());
						}}
					>
						Keep
					</button>
					<button
						type="button"
						className="button danger"
						onClick={() => {
							setDiscarding(false);
							store.discardReview(worktree);
							onGone();
						}}
					>
						Discard
					</button>
				</div>
			) : (
				<div className="review-bar">
					<button ref={discardButton} type="button" className="text-button" onClick={() => setDiscarding(true)}>Discard</button>
					<button type="button" className="button primary" onClick={() => store.openDialog({ kind: "send-review", worktree })}>Send review</button>
				</div>
			)}
		</aside>
	);
}

/**
 * The button that opens the Review panel over the diff. It shows only in a
 * narrow window, where the panel does not fit beside the diff.
 */
export function ReviewToggle({ count, panel, open, onToggle, button }: {
	count: number;
	panel: string;
	open: boolean;
	onToggle: () => void;
	button: RefObject<HTMLButtonElement | null>;
}) {
	return (
		<button
			ref={button}
			type="button"
			className="button quiet review-toggle"
			aria-expanded={open}
			aria-controls={panel}
			aria-label={`Review, ${describeNoteCount(count)}`}
			title={REVIEW_TOGGLE_TITLE}
			onClick={onToggle}
		>
			Review
			<span className="change-group-count" aria-hidden="true">{count}</span>
		</button>
	);
}

/**
 * The preview of a review before it goes anywhere: the agent to paste it
 * into, and the message exactly as it will be pasted. The choices are the
 * worktree's running agents and a new one, the first saved agent, with the
 * command that starts it. What is picked at first is as for a prompt chop
 * (`promptTarget`): the new agent when none runs, the only one when it does
 * not wait on the person, and otherwise nothing, so the person picks.
 * Nothing is sent or started until Send. With no agent running and none
 * saved, Copy review is the only way out; it is there in every case.
 */
export function SendReviewDialog({ worktree }: { worktree: string }) {
	const store = useStore();
	const state = useAppState();
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const [message, setMessage] = useState<string | null>(null);
	const [prepared, setPrepared] = useState(false);
	const sessions = runningAgents(state.terminals, worktree);
	const newAgent = state.preferences.agents[0] ?? null;
	const waiting = reviewWaiting(state.terminals, worktree);
	const firstPick = () => {
		const target = promptTarget(state.terminals, worktree);
		return target.kind === "session" ? target.session : target.kind === "new" && newAgent !== null ? NEW_AGENT : null;
	};
	const [picked, setPicked] = useState<string | null>(firstPick);
	// An agent that starts or ends while the dialog is open changes what is picked at first: never a new one beside one that runs now.
	const running = sessions.map(session => session.id).join(" ");
	const seenRunning = useRef(running);
	useEffect(() => {
		if (seenRunning.current === running) return;
		seenRunning.current = running;
		setPicked(firstPick());
	});
	const [sending, setSending] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const chosen = sessions.find(session => session.id === picked) ?? null;
	const startsNew = picked === NEW_AGENT && newAgent !== null && waiting === null;
	const canSend = sessions.length > 0 || newAgent !== null;
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
		if ((chosen === null && !startsNew) || message === null || tooLong || sending) return;
		setSending(true);
		setProblem(null);
		if (chosen === null) {
			const why = await store.startReviewAgent(worktree, message, estimateTerminalSize(document.getElementById("workspace-panel")));
			setSending(false);
			if (why !== null) setProblem(why);
			return;
		}
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
					{!canSend ? (
						<p className="dialog-note">{NO_REVIEW_AGENT}</p>
					) : (
						<AgentChoices sessions={sessions} picked={picked} onPick={setPicked} name="review-agent" legend="Paste into" disabled={sending}>
							{newAgent !== null && (
								<label className="review-agent">
									<input type="radio" name="review-agent" checked={picked === NEW_AGENT} disabled={waiting !== null} onChange={() => setPicked(NEW_AGENT)} />
									<span className="review-agent-name">{describeNewReviewAgent(newAgent.name)}</span>
									<span className="review-agent-state">
										{waiting !== null ? reviewAlreadyWaiting(waiting.name) : <>{NEW_REVIEW_AGENT_NOTE} <code>{describeAgentCommand(newAgent) ?? newAgent.command}</code></>}
									</span>
								</label>
							)}
						</AgentChoices>
					)}
					{chosen !== null && waitsOnPerson(chosen) && <p className="review-warning" role="alert">{REVIEW_WAITS_WARNING}</p>}
					{message === null ? (
						<p className="dialog-note" role="status">Checking the noted lines</p>
					) : (
						<pre className="review-preview" tabIndex={0} aria-label="The review, exactly as it will be pasted">{message}</pre>
					)}
					{tooLong && <p className="review-warning" role="alert">{reviewTooLong(message.length)}</p>}
					{canSend && <p className="dialog-note">{REVIEW_PASTE_NOTE}</p>}
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
						<button type="button" className={canSend ? "button quiet" : "button primary"} disabled={message === null || sending} onClick={() => {
							if (message !== null) void store.copyReview(message).then(copied => copied || setProblem("The review could not be put on the clipboard."));
						}}>
							Copy review
						</button>
						{canSend && (
							<button type="button" className="button primary" disabled={(chosen === null && !startsNew) || message === null || tooLong || sending} onClick={() => void send()}>
								{sending ? (startsNew ? "Starting" : "Pasting") : "Send"}
							</button>
						)}
					</div>
				</footer>
			</div>
		</dialog>
	);
}
