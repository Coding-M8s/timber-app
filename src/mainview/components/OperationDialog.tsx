import { type ReactNode, type SubmitEvent, useEffect, useId, useRef } from "react";
import type { SubmissionState } from "../store/submission";
import { TimberFailureDetails } from "./TimberFailureDetails";

interface OperationDialogProps {
	title: string;
	/** Sits beside the title, for example a switch between modes. It is outside the fields, so it disables itself while the command runs. */
	headerAside?: ReactNode;
	/** The exact Timber command the dialog is about to run, shown before it runs. */
	command: string;
	/** The state of the dialog's submission (see `useSubmission`). */
	submission: SubmissionState;
	/** On the submit button, for example "Create worktree". */
	submitLabel: string;
	/** Beside the progress bar while the command runs, for example "Creating the worktree". */
	runningLabel: string;
	/** Above a failure, for example "Could not create the worktree". */
	failureTitle: string;
	/** False while the fields do not make a command that can run. */
	canSubmit?: boolean;
	onSubmit: () => void;
	/** Asked for by Cancel and Escape. Never while the command runs, unless `closableWhileRunning`. */
	onClose: () => void;
	/**
	 * For a command that goes on in the background once started, such as a
	 * removal. While it runs, the button that closes the dialog reads "Close"
	 * and stays enabled, Escape closes, and focus moves to that button.
	 * Closing never stops the command.
	 */
	closableWhileRunning?: boolean;
	/**
	 * For a command that deletes work. The submit button is marked as such,
	 * and nothing but pressing that button itself submits: Enter in a field
	 * does not, and focus starts on the other button, the one that closes the
	 * dialog and changes nothing.
	 */
	destructive?: boolean;
	/** On the button that closes the dialog. "Cancel" unless given, for example "Keep". */
	cancelLabel?: string;
	/** Shown right below a failure, for what the person should know next. */
	failureNote?: ReactNode;
	/**
	 * What the app itself starts once the command worked, such as an agent,
	 * shown under the command with a note saying when. Not part of the
	 * command: it is never joined to it as one line.
	 */
	followUp?: { note: string; command: string } | null;
	/** The fields. They are disabled as a group while the command runs. */
	children: ReactNode;
}

/**
 * The frame every dialog that runs a Timber command shares, so they all
 * behave the same. While the command runs, the fields and buttons are
 * disabled, progress is shown, and the dialog cannot be submitted again or,
 * unless the command goes on in the background, closed. A failure is shown
 * in the dialog, which stays open for a correction and a retry.
 */
export function OperationDialog(props: OperationDialogProps) {
	const { title, headerAside, command, submission, submitLabel, runningLabel, failureTitle, canSubmit = true, onSubmit, onClose, children } = props;
	const { destructive = false, cancelLabel = "Cancel", failureNote, followUp, closableWhileRunning = false } = props;
	const { running, failure } = submission;
	const closable = !running || closableWhileRunning;
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const titleId = useId();

	// Opened as a modal, so the rest of the window is inert and focus stays inside.
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);

	// Opening moves focus to the first control, and a run takes it away, because the buttons are disabled meanwhile.
	// A destructive dialog puts it on the button that changes nothing, at the start and after every run.
	// A dialog that may close while its command runs puts it on Close once the command starts, so Escape and Enter work.
	useEffect(() => {
		if ((destructive && !running) || (running && closableWhileRunning)) cancel.current?.focus();
	}, [destructive, running, closableWhileRunning]);

	const run = () => {
		if (!running && canSubmit) onSubmit();
	};
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		// Enter in a field submits a form. A destructive command runs only from its own button.
		if (!destructive) run();
	};

	return (
		<dialog
			ref={dialog}
			className="dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				// Escape asks to close. The dialog decides, and never while the command runs unless it goes on in the background.
				event.preventDefault();
				if (closable) onClose();
			}}
		>
			<form className="dialog-form" aria-busy={running} onSubmit={submit}>
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">{title}</h2>
					{headerAside}
				</header>
				<fieldset className="dialog-fields" disabled={running}>{children}</fieldset>
				{failure && <TimberFailureDetails title={failureTitle} failure={failure} />}
				{failure && failureNote}
				{running && (
					<div className="dialog-progress">
						<div className="progress" role="progressbar" aria-label={runningLabel} />
						<p className="dialog-progress-text" role="status">{runningLabel}</p>
					</div>
				)}
				<footer className="dialog-foot">
					<pre className="dialog-command" aria-label="Command that will run">{command}</pre>
					{followUp && (
						<>
							<p className="dialog-note">{followUp.note}</p>
							<pre className="dialog-command" aria-label="Command that will start next">{followUp.command}</pre>
						</>
					)}
					<div className="dialog-buttons">
						<button ref={cancel} type="button" className="button quiet" disabled={!closable} autoFocus={destructive} onClick={onClose}>{running && closableWhileRunning ? "Close" : cancelLabel}</button>
						{destructive ? (
							<button type="button" className="button danger" disabled={running || !canSubmit} onClick={run}>
								{running ? "Running" : submitLabel}
							</button>
						) : (
							<button type="submit" className="button primary" disabled={running || !canSubmit}>
								{running ? "Running" : submitLabel}
							</button>
						)}
					</div>
				</footer>
			</form>
		</dialog>
	);
}
