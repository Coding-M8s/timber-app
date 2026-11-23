import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { HookDetails, StatusHookView } from "../../../shared/status-hooks";
import { type HookAction, describeHookDialog, describeStatusLine } from "../../status-hook-format";

/** The status line under a saved agent's row in Settings, Agents, with its buttons. Nothing for an agent that shows none. */
export function StatusHookLine({ view, rowLabel, idOf, lineId, onOpen }: {
	view: StatusHookView;
	/** The line's own id. */
	lineId: string;
	/** The row's name, for the buttons' accessible names. */
	rowLabel: string;
	/** The id of a button of the line, for focus to come back to it. */
	idOf: (action: HookAction) => string;
	onOpen: (action: HookAction) => void;
}) {
	const line = describeStatusLine(view);
	if (line === null) return null;
	const buttons = line.actions.map(({ action, label }) => (
		<button key={action} type="button" id={idOf(action)} className="button quiet" aria-label={`${label.replace("…", "")} for ${rowLabel}`} onClick={() => onOpen(action)}>{label}</button>
	));
	if (line.tone === "error") {
		return (
			<div id={lineId} className="agent-status">
				<p className="field-error" role="status">{line.label}: {line.text}</p>
				{buttons.length > 0 && <div className="agent-status-buttons">{buttons}</div>}
			</div>
		);
	}
	return (
		<div id={lineId} className="agent-status agent-status-inline">
			<p className="field-hint"><span className="agent-status-label">{line.label}</span> {line.text}</p>
			{buttons}
		</div>
	);
}

/**
 * A status hook dialog, over Settings: Turn on, Remove, by hand, or what
 * differs. Shows the exact text before anything is written. Drawn outside the
 * section's form, as a modal of its own, so Escape closes only it.
 */
export function StatusHookDialog({ hook, reports, action, running, problem, onClose, onConfirm, onCopy, onSwitch }: {
	hook: HookDetails;
	reports: StatusHookView["reports"];
	action: HookAction;
	running: boolean;
	problem: string | null;
	onClose: () => void;
	onConfirm: () => void;
	onCopy: (text: string) => void;
	onSwitch: (action: HookAction) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const model = describeHookDialog(hook, reports, action);

	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		// The button that changes nothing has the keyboard first, as in every dialog that removes something.
		cancel.current?.focus();
		return () => element?.close();
	}, [action]);

	return createPortal(
		<dialog
			ref={dialog}
			className="dialog status-hook-dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				// Escape closes this dialog only, never Settings under it.
				event.preventDefault();
				event.stopPropagation();
				if (!running) onClose();
			}}
		>
			<div className="dialog-form">
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">{model.title}</h2>
				</header>
				<div className="dialog-body">
					<p className="dialog-note">{model.lead}</p>
					{model.note !== null && <p className="field-hint">{model.note}</p>}
					{model.blocks.map(block => (
						<div key={block.label} className="status-hook-block">
							<p className="dialog-command-label">{block.label}</p>
							<pre className="dialog-command status-hook-text" aria-label={block.label}>{block.text}</pre>
						</div>
					))}
					{problem !== null && <p className="field-error" role="alert">{problem}</p>}
				</div>
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button ref={cancel} type="button" className="button quiet" disabled={running} onClick={onClose}>{model.cancel}</button>
						{model.copy !== null && <button type="button" className="button quiet" disabled={running} onClick={() => onCopy(model.copy!)}>Copy</button>}
						{model.next !== null && <button type="button" className="button quiet" disabled={running} onClick={() => onSwitch(model.next!.action)}>{model.next.label}</button>}
						{model.confirm !== null && (
							<button type="button" className={model.confirm.danger ? "button danger" : "button primary"} disabled={running} onClick={onConfirm}>
								{running ? model.confirm.running : model.confirm.label}
							</button>
						)}
					</div>
				</footer>
			</div>
		</dialog>,
		document.body,
	);
}
