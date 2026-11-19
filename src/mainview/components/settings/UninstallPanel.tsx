import { useContext, useEffect, useRef, useState } from "react";
import type { UninstallPlan } from "../../../shared/uninstall";
import { useAppState, useStore } from "../../store/react";
import { describeEndingTerminals, liveTerminalCount } from "../../terminal-format";
import {
	UNINSTALL_CHECKING,
	UNINSTALL_DONE,
	UNINSTALL_FORGET_LABEL,
	UNINSTALL_KEEPS,
	UNINSTALL_NO_UNDO,
	UNINSTALL_SUMMARY,
	type UninstallRun,
	describeForgetHint,
	describeUninstallCommand,
	uninstallRemovals,
	uninstallRunOf,
} from "../../uninstall-format";
import { SettingsSavingContext } from "./SettingsSection";

export interface UninstallPanelViewProps {
	/** Undefined while the main process is asked. */
	plan: UninstallPlan | undefined;
	/** Whether the person asked to uninstall and now sees what that does. */
	confirming: boolean;
	/** Whether the person cancelled, so focus goes back to the button they came from. */
	cancelled: boolean;
	forgetSettings: boolean;
	run: UninstallRun;
	/** How many terminals run, which end with the app. */
	liveTerminals: number;
	onStart: () => void;
	onCancel: () => void;
	onForgetSettings: (forget: boolean) => void;
	onConfirm: () => void;
	onQuit: () => void;
}

/**
 * The Uninstall part of About as drawn from its data. Nothing is removed
 * from the first button: it only shows what would go and the command that
 * would run, and the second button, marked as dangerous, runs it. Focus
 * starts on Cancel, the button that changes nothing.
 */
export function UninstallPanelView(props: UninstallPanelViewProps) {
	const { plan, confirming, cancelled, forgetSettings, run, liveTerminals, onStart, onCancel, onForgetSettings, onConfirm, onQuit } = props;
	if (plan === undefined) return <p className="about-text" role="status">{UNINSTALL_CHECKING}</p>;
	if (run.state === "done") {
		if (run.settingsProblem === null) return <p className="about-text" role="status">{UNINSTALL_DONE}</p>;
		return (
			<>
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Timber was removed, but its settings were not</p>
					<p className="sidebar-error-text">{run.settingsProblem}</p>
					{plan.available && <p className="sidebar-error-text">Delete {plan.settingsFolder} yourself to forget the repository list.</p>}
				</div>
				<div className="uninstall-buttons">
					<button type="button" className="button primary" onClick={onQuit}>Quit</button>
				</div>
			</>
		);
	}
	if (!plan.available) return <p className="about-text">{plan.reason}</p>;
	if (!confirming) {
		return (
			<>
				<p className="about-text">{UNINSTALL_SUMMARY} {UNINSTALL_KEEPS}</p>
				<div className="uninstall-buttons start">
					<button type="button" className="button quiet" autoFocus={cancelled} onClick={onStart}>Uninstall Timber</button>
				</div>
			</>
		);
	}
	const running = run.state === "running";
	const ending = describeEndingTerminals(liveTerminals);
	return (
		<div className="uninstall-confirm" aria-busy={running}>
			<p className="about-text">This will be removed:</p>
			<ul className="uninstall-list mono">
				{uninstallRemovals(plan, forgetSettings).map(path => <li key={path}>{path}</li>)}
			</ul>
			<label className="check">
				<input type="checkbox" checked={forgetSettings} disabled={running} onChange={event => onForgetSettings(event.target.checked)} />
				<span className="check-text">
					{UNINSTALL_FORGET_LABEL}
					<span className="check-hint">{describeForgetHint(plan.settingsFolder, forgetSettings)}</span>
				</span>
			</label>
			<p className="about-text">{UNINSTALL_KEEPS} {UNINSTALL_NO_UNDO}</p>
			{ending !== null && <p className="about-text" role="note">{ending}</p>}
			<p className="about-text">The app runs this, then quits:</p>
			<pre className="dialog-command">{describeUninstallCommand(plan)}</pre>
			{run.state === "failed" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Could not uninstall</p>
					<p className="sidebar-error-text">{run.message}</p>
					<p className="sidebar-error-text">The settings were not touched. Look at what is still there before trying again.</p>
				</div>
			)}
			<div className="uninstall-buttons">
				<button type="button" className="button quiet" autoFocus disabled={running} onClick={onCancel}>Cancel</button>
				<button type="button" className="button danger" disabled={running} onClick={onConfirm}>
					{running ? "Uninstalling" : "Uninstall and quit"}
				</button>
			</div>
		</div>
	);
}

/**
 * Uninstalling from Settings, About. It asks the main process whether this
 * copy can be uninstalled, shows what would go and the command before
 * anything runs, and keeps the Settings dialog open while the uninstaller
 * runs, so its answer is never lost.
 */
export function UninstallPanel() {
	const store = useStore();
	const terminals = useAppState().terminals;
	const { reportSaving } = useContext(SettingsSavingContext);
	const [plan, setPlan] = useState<UninstallPlan | undefined>(undefined);
	const [confirming, setConfirming] = useState(false);
	const [cancelled, setCancelled] = useState(false);
	const [forgetSettings, setForgetSettings] = useState(false);
	const [run, setRun] = useState<UninstallRun>({ state: "idle" });
	// A ref, not the state: a second press can arrive before the next render.
	const started = useRef(false);

	useEffect(() => {
		let gone = false;
		void store.uninstallPlan().then(answer => {
			if (!gone) setPlan(answer);
		});
		return () => {
			gone = true;
		};
	}, [store]);

	const confirm = async () => {
		if (started.current) return;
		started.current = true;
		reportSaving(true);
		setRun({ state: "running" });
		try {
			const next = uninstallRunOf(await store.uninstall({ forgetSettings }));
			setRun(next);
			// After a failure the same button may be pressed again. After it worked there is nothing left to run.
			if (next.state !== "done") started.current = false;
		} finally {
			reportSaving(false);
		}
	};

	return (
		<UninstallPanelView
			plan={plan}
			confirming={confirming}
			cancelled={cancelled}
			forgetSettings={forgetSettings}
			run={run}
			liveTerminals={liveTerminalCount(terminals)}
			onStart={() => setConfirming(true)}
			onCancel={() => {
				setConfirming(false);
				setCancelled(true);
				setRun({ state: "idle" });
			}}
			onForgetSettings={setForgetSettings}
			onConfirm={() => void confirm()}
			onQuit={() => void store.confirmQuit()}
		/>
	);
}
