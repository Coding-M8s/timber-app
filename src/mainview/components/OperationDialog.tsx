import { Fragment, type ReactNode, type SubmitEvent, useEffect, useId, useRef } from "react";
import type { SubmissionState } from "../store/submission";
import { TimberFailureDetails } from "./TimberFailureDetails";

interface OperationDialogProps {
	title: string;
	/** Sits beside the title, for example a switch between modes. It is outside the fields, so it disables itself while the command runs. */
	headerAside?: ReactNode;
	/** The exact command the dialog is about to run, shown before it runs: a Timber command, or a chop's text. */
	command: string;
	/**
	 * A label over the command, such as "Timber command". Given, the command
	 * is drawn quieter under it, for a dialog that leads with a plain sentence
	 * and whose command is Timber's machine interface. It is still shown in
	 * full before it runs.
	 */
	commandLabel?: string;
	/** The state of the dialog's submission (see `useSubmission`). */
	submission: SubmissionState;
	/** On the submit button, for example "Create worktree". */
	submitLabel: string;
	/**
	 * Other labels the submit button can show while the dialog is open, such
	 * as those of another step or mode. The button is as wide as the widest of
	 * these, `submitLabel`, and "Running", so the buttons beside it never move.
	 */
	reserveLabels?: readonly string[];
	/**
	 * Set for a dialog that keeps one height across its steps or modes, so its
	 * footer never moves: "steady" and a class of its own that sets
	 * `--steady-height` in styles.css. The fields scroll when taller, and the
	 * header and footer stay.
	 */
	className?: string;
	/** Beside the progress bar while the command runs, for example "Creating the worktree". */
	runningLabel: string;
	/** Above a failure, for example "Could not create the worktree". */
	failureTitle: string;
	/** False while the fields do not make a command that can run. */
	canSubmit?: boolean;
	onSubmit: () => void;
	/** Asked for by Cancel and Escape. Never while the command runs. */
	onClose: () => void;
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
	 * What the app itself starts once the command worked, such as setup and
	 * an agent, in that order, each shown under the command with a note
	 * saying when. Not part of the command: never joined to it as one line.
	 */
	followUps?: readonly { note: string; command: string }[];
	/** The fields. They are disabled as a group while the command runs. */
	children: ReactNode;
}

/** A control a dialog can put the keyboard in, as `HTMLFieldSetElement.elements` lists it. */
interface Focusable {
	localName: string;
	type?: string;
	disabled?: boolean;
	focus(): void;
}

const FIELD_CONTROLS = new Set(["input", "select", "textarea", "button"]);

/**
 * Puts the keyboard in the first field: the first enabled input, select,
 * text area, or button among `controls`, in order. Returns whether one was
 * found, so nothing moves when the fields have no control. A control hidden
 * by style is not told apart, and links or other focusable elements are not
 * fields here.
 */
export function focusFirstField(controls: Iterable<Focusable>): boolean {
	for (const control of controls) {
		if (!FIELD_CONTROLS.has(control.localName) || control.type === "hidden" || control.disabled) continue;
		control.focus();
		return true;
	}
	return false;
}

const TEXT_INPUTS = new Set(["", "text", "search", "url", "email", "password", "tel", "number"]);

/**
 * After a run that failed, puts the keyboard back where the correction is
 * typed: the first enabled text field among `controls`, such as Name. With
 * none, as when New branch offers "Run setup", it goes to `retry`, the button
 * that runs the command again.
 */
export function focusAfterFailure(controls: Iterable<Focusable>, retry: { focus(): void } | null): void {
	for (const control of controls) {
		if (control.disabled) continue;
		const text = control.localName === "textarea" || (control.localName === "input" && TEXT_INPUTS.has(control.type ?? ""));
		if (!text) continue;
		control.focus();
		return;
	}
	retry?.focus();
}

/** On the submit button while the command runs. */
const RUNNING_LABEL = "Running";

/**
 * The `data-reserve` of a button that can show any of `labels`: each label
 * once, one per line, in a fixed order, so it is the same at every step.
 * styles.css makes the button as wide as the widest line.
 */
export function reservedLabels(labels: readonly string[]): string {
	return [...new Set(labels)].sort().join("\n");
}

/**
 * Opens `dialog` as a modal with the keyboard in its first field. React's
 * autoFocus runs while the dialog is still closed, so it does nothing, and
 * showModal() then picks the first control in the dialog, which can be in
 * the header, such as a switch between modes. A destructive dialog is left
 * to put it on the button that changes nothing.
 */
export function openModal(dialog: { open: boolean; showModal(): void }, fields: { elements: Iterable<Focusable> } | null, destructive: boolean): void {
	if (!dialog.open) dialog.showModal();
	if (!destructive && fields) focusFirstField(fields.elements);
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
	const { destructive = false, cancelLabel = "Cancel", failureNote, followUps = [], reserveLabels = [], className, commandLabel } = props;
	const { running, failure } = submission;
	const closable = !running;
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const fields = useRef<HTMLFieldSetElement>(null);
	const retry = useRef<HTMLButtonElement>(null);
	const ran = useRef(false);
	const titleId = useId();
	const reserve = reservedLabels([submitLabel, RUNNING_LABEL, ...reserveLabels]);

	// Opened as a modal, so the rest of the window is inert and focus stays inside.
	// Closing gives the keyboard back to what opened it, such as a worktree row, when that is still there. The
	// dialog is already out of the page when this runs, so the browser cannot do it and would leave it nowhere.
	useEffect(() => {
		const element = dialog.current;
		const opener = document.activeElement;
		if (element) openModal(element, fields.current as { elements: Iterable<Focusable> } | null, destructive);
		return () => {
			element?.close();
			const lost = document.activeElement === null || document.activeElement === document.body;
			if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	}, []);

	// Opening moves focus to the first field, past the header, and a run takes it away, because the buttons are disabled meanwhile.
	// A destructive dialog puts it on the button that changes nothing, at the start and after every run.
	useEffect(() => {
		if (destructive && !running) cancel.current?.focus();
	}, [destructive, running]);

	// A run takes the keyboard away, because the fields and buttons are disabled meanwhile. One that failed gives it
	// back to the field to correct, once the fields are enabled again. A destructive dialog has its own rule above.
	useEffect(() => {
		if (running) {
			ran.current = true;
			return;
		}
		const failed = ran.current && failure !== null;
		ran.current = false;
		if (failed && !destructive && fields.current) focusAfterFailure(fields.current.elements as unknown as Iterable<Focusable>, retry.current);
	}, [running, failure, destructive]);

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
			className={className ? `dialog ${className}` : "dialog"}
			aria-labelledby={titleId}
			onCancel={event => {
				// Escape asks to close. The dialog decides, and never while the command runs.
				event.preventDefault();
				if (closable) onClose();
			}}
		>
			<form className="dialog-form" aria-busy={running} onSubmit={submit}>
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">{title}</h2>
					{headerAside}
				</header>
				{/* What scrolls in a dialog that keeps one height. Elsewhere it is not a box of its own. */}
				<div className="dialog-body">
					<fieldset ref={fields} className="dialog-fields" disabled={running}>{children}</fieldset>
				</div>
				{/* Under the fields, never scrolled out of view with them, so a failure or progress is always seen. */}
				{(failure || running) && (
					<div className="dialog-status">
						{failure && <TimberFailureDetails title={failureTitle} failure={failure} />}
						{failure && failureNote}
						{running && (
							<div className="dialog-progress">
								<div className="progress" role="progressbar" aria-label={runningLabel} />
								<p className="dialog-progress-text" role="status">{runningLabel}</p>
							</div>
						)}
					</div>
				)}
				<footer className={commandLabel ? "dialog-foot labelled" : "dialog-foot"}>
					{commandLabel && <p className="dialog-command-label" aria-hidden="true">{commandLabel}</p>}
					<pre className="dialog-command" aria-label="Command that will run">{command}</pre>
					{followUps.map(followUp => (
						<Fragment key={followUp.command}>
							<p className="dialog-note">{followUp.note}</p>
							<pre className="dialog-command" aria-label="Command that will start next">{followUp.command}</pre>
						</Fragment>
					))}
					<div className="dialog-buttons">
						<button ref={cancel} type="button" className="button quiet" disabled={!closable} autoFocus={destructive} onClick={onClose}>{cancelLabel}</button>
						{destructive ? (
							<button type="button" className="button danger" data-reserve={reserve} disabled={running || !canSubmit} onClick={run}>
								{running ? RUNNING_LABEL : submitLabel}
							</button>
						) : (
							<button ref={retry} type="submit" className="button primary" data-reserve={reserve} disabled={running || !canSubmit}>
								{running ? RUNNING_LABEL : submitLabel}
							</button>
						)}
					</div>
				</footer>
			</form>
		</dialog>
	);
}
