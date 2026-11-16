import { useCallback, useEffect, useId, useRef, useState } from "react";
import { describeTimberCommand } from "../../../shared/timber-result";
import {
	type IntegrationStatuses, type TimberConfigFile, type TimberConfigScope, type TimberSettings, INTEGRATIONS, REPOSITORY_CONFIG_FILE,
	timberSetupArguments,
} from "../../../shared/timber-config";
import { useAppState, useStore } from "../../store/react";
import { timberReady, timberSetupTarget } from "../../store/state";
import { INTEGRATION_LABELS, describeIntegration, rowSourceNote, timberSettingRows } from "../../timber-settings-format";

/** A read that is under way, answered, or failed with the reason. */
type Reading<Value> = { state: "reading" } | { state: "read"; value: Value } | { state: "failed"; message: string };

/**
 * Read something when the section shows and whenever `key` changes, and
 * again when asked. An older answer that arrives after a newer request is
 * dropped, so switching repositories quickly never shows the wrong one.
 */
function useReading<Value>(read: () => Promise<Value | string>, key: string): [Reading<Value>, () => void] {
	const [reading, setReading] = useState<Reading<Value>>({ state: "reading" });
	const ticket = useRef(0);
	const latest = useRef(read);
	latest.current = read;
	const run = useCallback(() => {
		const mine = ++ticket.current;
		setReading({ state: "reading" });
		void latest.current().then(answer => {
			if (mine !== ticket.current) return;
			setReading(typeof answer === "string" ? { state: "failed", message: answer } : { state: "read", value: answer });
		});
	}, []);
	useEffect(run, [run, key]);
	return [reading, run];
}

/** The values of one of Timber's files, or why there are none. Never empty defaults in place of a file. */
export function TimberFileView({ file, scope, machine }: { file: TimberConfigFile; scope: TimberConfigScope; machine: TimberConfigFile | null }) {
	if (file.state === "missing") {
		return (
			<div className="timber-file-state" role="status">
				<p className="timber-file-title">Not configured</p>
				<p className="settings-section-text">
					{scope === "repository"
						? `This repository has no ${REPOSITORY_CONFIG_FILE}, so Timber uses the machine defaults and its own. Run timber setup to configure it.`
						: "There is no machine settings file, so Timber uses its own defaults. Run timber setup to configure them."}
				</p>
			</div>
		);
	}
	if (file.state === "error") {
		return (
			<div className="sidebar-error" role="alert">
				<p className="sidebar-error-title">Could not read these settings</p>
				<p className="sidebar-error-text">{file.message}</p>
				{file.problems.length > 0 && (
					<ul className="timber-problems">
						{file.problems.map(problem => <li key={problem} className="sidebar-error-text mono">{problem}</li>)}
					</ul>
				)}
				<p className="sidebar-error-text">Nothing is shown from this file. Fix it in an editor, or run timber setup.</p>
			</div>
		);
	}
	const fallback = scope === "repository" && machine?.state === "read" ? machine.values : null;
	const rows = timberSettingRows(file.values, scope, fallback);
	return (
		<>
			<dl className="timber-settings">
				{rows.map(row => {
					const note = rowSourceNote(row);
					return (
						<div key={row.key} className={row.source === "file" ? "timber-setting" : "timber-setting inherited"}>
							<dt className="timber-setting-label">{row.label}</dt>
							<dd className="timber-setting-value">
								<span className={row.mono ? "mono" : undefined}>{row.value}</span>
								{note !== null && <span className="timber-setting-note">{note}</span>}
							</dd>
						</div>
					);
				})}
			</dl>
			{file.unknown.length > 0 && (
				<p className="dialog-note">
					This app does not show {file.unknown.length === 1 ? "this key" : "these keys"}: <span className="mono">{file.unknown.join(", ")}</span>.
				</p>
			)}
		</>
	);
}

/** Whether Timber can reach each service. Credentials are never shown, only whether they are there. */
export function IntegrationsView({ reading }: { reading: Reading<IntegrationStatuses> }) {
	return (
		<div className="timber-block">
			<h4 className="timber-block-title">Integrations</h4>
			{reading.state === "reading" && <p className="settings-section-text" role="status">Checking</p>}
			{reading.state === "failed" && <p className="settings-section-text" role="alert">Could not check: {reading.message}</p>}
			{reading.state === "read" && (
				<dl className="timber-settings">
					{INTEGRATIONS.map(integration => {
						const { text } = describeIntegration(integration, reading.value[integration]);
						return (
							<div key={integration} className="timber-setting">
								<dt className="timber-setting-label">{INTEGRATION_LABELS[integration]}</dt>
								<dd className="timber-setting-value">{text}</dd>
							</div>
						);
					})}
				</dl>
			)}
		</div>
	);
}

/** The exact setup command, where it runs, and the button that starts it in a session. */
function SetupRunner({ scope, repository }: { scope: TimberConfigScope; repository: string | null }) {
	const store = useStore();
	const state = useAppState();
	const hintId = useId();
	const ready = timberReady(state);
	const target = timberSetupTarget(state, scope, repository);
	const command = describeTimberCommand(timberSetupArguments(scope));
	const reason = !ready ? "No usable Timber was found." : target.ok ? null : target.reason;
	return (
		<div className="timber-block">
			<h4 className="timber-block-title">Change these settings</h4>
			<p className="settings-section-text">
				The app cannot change Timber's settings yet. Timber setup asks about each one in a terminal session and saves them itself.
				Settings closes while it runs, and shows the new values the next time it opens.
			</p>
			<div className="field">
				<span className="field-label">{target.ok ? `Runs in ${target.worktree.path}` : "Runs"}</span>
				<pre className="dialog-command" aria-label="Setup command">{command}</pre>
			</div>
			{reason !== null && <p id={hintId} className="dialog-note">{reason}</p>}
			<div className="settings-section-foot">
				<span />
				<button
					type="button"
					className="button primary"
					disabled={reason !== null}
					aria-describedby={reason !== null ? hintId : undefined}
					onClick={() => void store.runTimberSetup(scope, repository)}
				>
					Run timber setup
				</button>
			</div>
		</div>
	);
}

function ReadAgain({ onClick, busy }: { onClick: () => void; busy: boolean }) {
	return <button type="button" className="button quiet" disabled={busy} onClick={onClick}>{busy ? "Reading" : "Read again"}</button>;
}

function FileReading({ reading, scope, pick }: { reading: Reading<TimberSettings>; scope: TimberConfigScope; pick: (settings: TimberSettings) => TimberConfigFile | null }) {
	if (reading.state === "reading") return <p className="settings-section-text" role="status">Reading</p>;
	if (reading.state === "failed") {
		return (
			<div className="sidebar-error" role="alert">
				<p className="sidebar-error-title">Could not read these settings</p>
				<p className="sidebar-error-text">{reading.message}</p>
			</div>
		);
	}
	const file = pick(reading.value);
	if (file === null) return null;
	return (
		<>
			<p className="settings-section-text">From <span className="mono">{file.path}</span></p>
			<TimberFileView file={file} scope={scope} machine={reading.value.machine} />
		</>
	);
}

/** Timber's defaults for every repository on this machine, read-only, with how to change them. */
export function MachineSection() {
	const store = useStore();
	const [settings, readSettings] = useReading(() => store.readTimberSettings(null), "machine");
	const [integrations, readIntegrations] = useReading(() => store.readTimberIntegrations(), "integrations");
	const titleId = useId();
	return (
		<section className="settings-section" aria-labelledby={titleId}>
			<div className="timber-head">
				<h3 id={titleId} className="settings-section-title">Machine</h3>
				<ReadAgain busy={settings.state === "reading"} onClick={() => {
					readSettings();
					readIntegrations();
				}} />
			</div>
			<p className="settings-section-text">
				Timber's defaults for every repository on this machine. A repository's own settings take their place where it sets them. Shown here, not changed.
			</p>
			<FileReading reading={settings} scope="machine" pick={value => value.machine} />
			<IntegrationsView reading={integrations} />
			<SetupRunner scope="machine" repository={null} />
		</section>
	);
}

/** One repository's Timber settings, read-only, with the repository to show chosen here. */
export function RepositorySection() {
	const store = useStore();
	const state = useAppState();
	const pickerId = useId();
	const titleId = useId();
	const { repositories } = state;
	const [chosen, setChosen] = useState<string | null>(null);
	// The repository of the selected worktree until another is chosen.
	const fallback = state.selection?.repository ?? repositories[0]?.path ?? null;
	const repository = chosen !== null && repositories.some(candidate => candidate.path === chosen) ? chosen : fallback;
	const [settings, readSettings] = useReading(() => store.readTimberSettings(repository), repository ?? "");
	return (
		<section className="settings-section" aria-labelledby={titleId}>
			<div className="timber-head">
				<h3 id={titleId} className="settings-section-title">Repository</h3>
				{repository !== null && <ReadAgain busy={settings.state === "reading"} onClick={readSettings} />}
			</div>
			<p className="settings-section-text">
				Timber's settings for one repository, from {REPOSITORY_CONFIG_FILE} in its primary checkout. What it does not set comes from the machine defaults. Shown here, not changed.
			</p>
			{repository === null ? (
				<p className="dialog-note">Add a repository to see its settings.</p>
			) : (
				<>
					<div className="field">
						<label className="field-label" htmlFor={pickerId}>Repository</label>
						<select id={pickerId} className="field-input" value={repository} onChange={event => setChosen(event.target.value)}>
							{repositories.map(candidate => <option key={candidate.path} value={candidate.path}>{candidate.name}</option>)}
						</select>
					</div>
					<FileReading reading={settings} scope="repository" pick={value => value.repository} />
					<SetupRunner scope="repository" repository={repository} />
				</>
			)}
		</section>
	);
}
