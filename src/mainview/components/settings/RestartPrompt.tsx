import { useContext, useEffect, useState } from "react";
import { RESTART_CONFIRM, RESTART_OFFER, RESTARTING, type RestartStep, restartStepAfterPlan, restartStepOf } from "../../restart-format";
import { useAppState, useStore } from "../../store/react";
import { describeEndingTerminals, liveTerminalCount } from "../../terminal-format";
import { describeUnsavedFiles, unsavedFilePaths } from "../../file-view-format";
import { SettingsSavingContext } from "./SettingsSection";

export interface RestartPromptViewProps {
	step: RestartStep;
	/** How many terminals run, which end with the app. */
	liveTerminals: number;
	/** The files with unsaved edits, which a restart drops. */
	unsavedFiles?: readonly string[];
	onRestart: () => void;
	onLater: () => void;
	/** Restart while terminals run, after the person agreed. */
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * The offer to restart, as drawn from its data, under a section that saved a
 * preference the app reads only when it starts. Restart now asks first while
 * terminals run, with focus on Cancel, the button that changes nothing.
 */
export function RestartPromptView({ step, liveTerminals, unsavedFiles = [], onRestart, onLater, onConfirm, onCancel }: RestartPromptViewProps) {
	if (step.kind === "later") return null;
	if (step.kind === "restarting") return <p className="restart-prompt-text" role="status">{RESTARTING}</p>;
	if (step.kind === "unavailable") return <p className="restart-prompt-text" role="note">{step.reason}</p>;
	if (step.kind === "confirm") {
		const ending = [describeEndingTerminals(liveTerminals), describeUnsavedFiles(unsavedFiles)].filter(line => line !== null).join(" ");
		return (
			<div className="restart-prompt" role="group" aria-label="Restart">
				<p className="restart-prompt-text">{RESTART_CONFIRM}{ending === "" ? "" : ` ${ending}`}</p>
				<div className="restart-prompt-buttons">
					<button type="button" className="button quiet" autoFocus onClick={onCancel}>Cancel</button>
					<button type="button" className="button danger" onClick={onConfirm}>Restart</button>
				</div>
			</div>
		);
	}
	const checking = step.kind === "checking";
	return (
		<div className="restart-prompt" role="group" aria-label="Restart" aria-busy={checking}>
			<p className="restart-prompt-text">{RESTART_OFFER}</p>
			{step.kind === "failed" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Could not restart</p>
					<p className="sidebar-error-text">{step.message}</p>
				</div>
			)}
			<div className="restart-prompt-buttons">
				<button type="button" className="button quiet" disabled={checking} onClick={onLater}>Later</button>
				<button type="button" className="button primary" disabled={checking} onClick={onRestart}>Restart now</button>
			</div>
		</div>
	);
}

/**
 * Offering to restart after a save, for any section: the section shows it
 * when its save changed a preference marked `restart` in
 * src/shared/preferences.ts. Later leaves the app as it is. While the app
 * checks or restarts, the Settings dialog stays open, so the answer is never
 * lost.
 */
export function RestartPrompt() {
	const store = useStore();
	const { terminals, files } = useAppState();
	const { reportSaving } = useContext(SettingsSavingContext);
	const [step, setStep] = useState<RestartStep>({ kind: "offer" });
	// Whether the restart request waits for its answer, which never comes when the app goes.
	const [asking, setAsking] = useState(false);
	const liveTerminals = liveTerminalCount(terminals);
	const unsavedFiles = unsavedFilePaths(files);

	// Keep the dialog open while a question to the main process waits, so its answer is never lost.
	// Once answered, even with "restarting" (the mock never quits), the dialog can close again.
	const busy = step.kind === "checking" || asking;
	useEffect(() => {
		if (!busy) return;
		reportSaving(true);
		return () => reportSaving(false);
	}, [busy, reportSaving]);

	const restart = async () => {
		setStep({ kind: "restarting" });
		setAsking(true);
		try {
			setStep(restartStepOf(await store.restart()));
		} finally {
			setAsking(false);
		}
	};
	const onRestart = async () => {
		setStep({ kind: "checking" });
		const now = store.getState();
		const next = restartStepAfterPlan(await store.restartPlan(), liveTerminalCount(now.terminals), unsavedFilePaths(now.files).length);
		if (next === "restart") await restart();
		else setStep(next);
	};
	return (
		<RestartPromptView
			step={step}
			liveTerminals={liveTerminals}
			unsavedFiles={unsavedFiles}
			onRestart={() => void onRestart()}
			onLater={() => setStep({ kind: "later" })}
			onConfirm={() => void restart()}
			onCancel={() => setStep({ kind: "offer" })}
		/>
	);
}
