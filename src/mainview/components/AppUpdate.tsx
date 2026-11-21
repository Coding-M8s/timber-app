import type { ReactNode } from "react";
import { type InstallStep, UPDATE_RESTARTING, appUpdateBannerText, appUpdateStatus, canCheckForUpdate, updateConfirmText } from "../app-update-format";
import type { AppUpdateState } from "../../shared/app-update";
import { useAppState, useStore } from "../store/react";

export interface InstallControlsViewProps {
	step: InstallStep;
	onRestart: () => void;
	/** Restart while sessions run, after the person agreed. */
	onConfirm: () => void;
	onCancel: () => void;
	/** Said beside Restart to update when there is one, such as Later in the banner. */
	later?: () => void;
}

/**
 * Restart to update, as drawn from its data. While sessions run it asks
 * first, with focus on Cancel, the button that changes nothing.
 */
export function InstallControlsView({ step, onRestart, onConfirm, onCancel, later }: InstallControlsViewProps) {
	if (step.kind === "restarting") return <p className="update-banner-line" role="status">{UPDATE_RESTARTING}</p>;
	if (step.kind === "confirm") {
		return (
			<div className="update-install" role="group" aria-label="Restart to update">
				<p className="update-banner-line">{updateConfirmText(step.live)}</p>
				<div className="update-install-buttons">
					<button type="button" className="button quiet" autoFocus onClick={onCancel}>Cancel</button>
					<button type="button" className="button danger" onClick={onConfirm}>Restart</button>
				</div>
			</div>
		);
	}
	return (
		<div className="update-install" role="group" aria-label="Restart to update">
			{step.kind === "failed" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Could not install the update</p>
					<p className="sidebar-error-text">{step.message}</p>
				</div>
			)}
			<div className="update-install-buttons">
				{later !== undefined && <button type="button" className="button quiet" onClick={later}>Later</button>}
				<button type="button" className="button primary" onClick={onRestart}>Restart to update</button>
			</div>
		</div>
	);
}

/**
 * Restart to update, for the banner and for About. Nothing restarts without a
 * click, and never past running sessions without a second one. Where it
 * stands is the store's, so a failure stays on screen in both places.
 */
function InstallControls({ later }: { later?: () => void }) {
	const store = useStore();
	const step = useAppState().appUpdateStep;
	return (
		<InstallControlsView
			step={step}
			onRestart={() => void store.restartForUpdate(false)}
			onConfirm={() => void store.restartForUpdate(true)}
			onCancel={() => store.cancelUpdateRestart()}
			{...later === undefined ? {} : { later }}
		/>
	);
}

/**
 * Across the top of the window once a newer release of the app is
 * downloaded. Nothing changes until the person restarts: Later hides it
 * until another version is ready.
 */
export function AppUpdateBanner() {
	const store = useStore();
	const state = useAppState();
	const text = appUpdateBannerText(state.appUpdate, state.appUpdateLater);
	if (text === null) return null;
	return (
		<div className="update-banner" role="status">
			<div className="update-banner-text">
				<p className="update-banner-line">{text}</p>
			</div>
			{/* Kept through installing, so a restart that did not happen can say why. */}
			<InstallControls later={() => store.appUpdateLater()} />
		</div>
	);
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export interface AppUpdatePanelViewProps {
	state: AppUpdateState;
	onCheck: () => void;
	/** What shows under the status when an update is ready: Restart to update. */
	install?: ReactNode;
	at?: (milliseconds: number) => string;
}

/** About's part on updates, as drawn from its data. */
export function AppUpdatePanelView({ state, onCheck, install, at = milliseconds => clock.format(milliseconds) }: AppUpdatePanelViewProps) {
	const status = appUpdateStatus(state, at);
	return (
		<div className="app-update-panel">
			<p className="about-text" role="status">
				<span>{status.text}</span>
				{status.note !== null && <span className="about-note">{status.note}</span>}
			</p>
			{state.kind !== "unavailable" && (
				<div className="update-install-buttons">
					<button type="button" className="button" disabled={!canCheckForUpdate(state)} onClick={onCheck}>
						{state.kind === "checking" ? "Looking" : "Check for updates"}
					</button>
				</div>
			)}
			{(state.kind === "ready" || state.kind === "installing") && install}
		</div>
	);
}

/** Check for updates by hand, and Restart to update once one is downloaded. */
export function AppUpdatePanel() {
	const store = useStore();
	const state = useAppState().appUpdate;
	return <AppUpdatePanelView state={state} onCheck={() => void store.checkForAppUpdate()} install={<InstallControls />} />;
}
