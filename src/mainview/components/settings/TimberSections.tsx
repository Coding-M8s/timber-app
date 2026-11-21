import { type ReactNode, type SubmitEvent, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import {
	type Integration, type TimberConfigScope, type TimberSettingsReadResult, type TimberSettingsRequest,
	type TimberSettingsSnapshot, type TimberValues, REPOSITORY_CONFIG_FILE, invalidFieldPath, shownApplyArguments, shownCheckArguments,
} from "../../../shared/timber-config";
import { describeTimberCommand } from "../../../shared/timber-result";
import { useAppState, useStore } from "../../store/react";
import {
	type CheckOutcome, type GitDraft, type GroupDrafts, type GroupOutcome, type LauncherDraft, type LauncherPreset, type Mode, type ScriptsDraft, type TimberGroup,
	type TrackingDraft, AGENT_PRESETS, DRAWN_PATHS, EDITOR_PRESETS, IDLE_OUTCOME as IDLE, INTEGRATION_LABELS, TIMBER_GROUPS, TIMBER_GROUP_TITLES, TRACKER_CHOICES,
	credentialsToCheck, credentialsToSave, describeCheck, describeJiraLogin, describeLinearLogin, draftsOf, fieldMessage, groupChanged, groupMessages, inheritLabel,
	jiraDefault, machineDefault, outcomeOfSave, placeholderFor, trackerPlaceholder, typingPutsAway, valuesWith, withPreset,
} from "../../timber-settings-format";
import { TimberFailureDetails } from "../TimberFailureDetails";
import { SettingsSavingContext } from "./SettingsSection";

/** What a connection check asks about: the scope, and its values with the tracking group as typed. */
interface CheckTarget {
	scope: TimberConfigScope;
	repository: string | null;
	tracking: TrackingDraft;
	values: TimberValues;
}

/**
 * What was typed in each group, kept until it is saved, and the connection
 * checks, which typing in the tracking group puts away. Settings and the
 * setup wizard both edit Timber's settings with it.
 */
export function useTimberDrafts() {
	const store = useStore();
	const [edited, setEdited] = useState<Partial<GroupDrafts>>({});
	const [checks, setChecks] = useState<Partial<Record<Integration, CheckOutcome>>>({});

	/** Keep what was typed in `group`. `putAway` sets its outcome back to idle, called when typing puts `outcome` away. */
	const change = <Group extends TimberGroup>(group: Group, draft: GroupDrafts[Group], outcome: GroupOutcome | undefined, putAway: () => void) => {
		setEdited(previous => ({ ...previous, [group]: draft }));
		if (outcome && typingPutsAway(outcome)) putAway();
		if (group === "tracking") setChecks({});
	};

	const check = async (integration: Integration, { scope, repository, tracking, values }: CheckTarget) => {
		setChecks(previous => ({ ...previous, [integration]: { state: "checking" } }));
		const credentials = credentialsToCheck(tracking, integration);
		const answer = await store.checkTimberConnection({
			scope,
			repository,
			integration,
			values: valuesWith("tracking", tracking, values),
			...(credentials === undefined ? {} : { credentials }),
		});
		setChecks(previous => ({ ...previous, [integration]: { state: "done", result: answer } }));
	};

	return { edited, setEdited, checks, clearChecks: () => setChecks({}), change, check };
}

/**
 * Read one scope through Timber when shown, when `key` changes, and again
 * when asked. The last answer stays on screen while reading again, and an
 * older answer that arrives after a newer request is dropped.
 */
export function useTimberRead(request: TimberSettingsRequest | null, key: string): [{ result: TimberSettingsReadResult | null; reading: boolean }, () => Promise<void>] {
	const store = useStore();
	const [state, setState] = useState<{ result: TimberSettingsReadResult | null; reading: boolean }>({ result: null, reading: request !== null });
	const ticket = useRef(0);
	const latest = useRef(request);
	latest.current = request;
	const run = useCallback(async () => {
		const asked = latest.current;
		if (asked === null) return;
		const mine = ++ticket.current;
		setState(previous => ({ ...previous, reading: true }));
		const result = await store.readTimberSettings(asked);
		if (mine === ticket.current) setState({ result, reading: false });
	}, [store]);
	useEffect(() => {
		setState({ result: null, reading: latest.current !== null });
		void run();
	}, [run, key]);
	return [state, run];
}

interface FieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
	messages: readonly string[];
	placeholder?: string;
	hint?: string;
	mono?: boolean;
	secret?: boolean;
}

/** One text field, with Timber's words about it beside it. */
function TextField({ label, value, onChange, messages, placeholder, hint, mono = true, secret = false }: FieldProps) {
	const id = useId();
	const hintId = useId();
	const errorId = useId();
	const described = [hint ? hintId : null, messages.length > 0 ? errorId : null].filter(Boolean).join(" ") || undefined;
	return (
		<div className="field">
			<label className="field-label" htmlFor={id}>{label}</label>
			<input
				id={id}
				className={mono ? "field-input mono" : "field-input"}
				type={secret ? "password" : "text"}
				spellCheck={false}
				autoComplete={secret ? "new-password" : "off"}
				placeholder={placeholder}
				aria-invalid={messages.length > 0}
				aria-describedby={described}
				value={value}
				onChange={event => onChange(event.target.value)}
			/>
			{hint && <span id={hintId} className="field-hint">{hint}</span>}
			<FieldMessages id={errorId} messages={messages} />
		</div>
	);
}

function FieldMessages({ id, messages }: { id?: string; messages: readonly string[] }) {
	if (messages.length === 0) return null;
	return <span id={id} className="field-error" role="alert">{messages.map(fieldMessage).join(" ")}</span>;
}

/**
 * A list of free-form entries, such as arguments or script commands, each
 * edited on its own, so an entry can hold spaces, quotes, or several lines.
 */
function ListField({ label, items, onChange, at, path, multiline, addLabel, empty }: {
	label: string;
	items: readonly string[];
	onChange: (items: string[]) => void;
	at: (path: string) => string[];
	path: string;
	multiline: boolean;
	addLabel: string;
	empty: string;
}) {
	const idPrefix = useId();
	// Messages about the whole list, such as "editor.args is invalid". Those about one entry show at it.
	const own = at(path).filter(message => invalidFieldPath(message) === path);
	return (
		<fieldset className="list-field">
			<legend className="field-label">{label}</legend>
			{items.length === 0 && <p className="dialog-note">{empty}</p>}
			{items.map((item, index) => {
				const id = `${idPrefix}-${index}`;
				const messages = at(`${path}.${index}`);
				const props = {
					id,
					className: "field-input mono",
					spellCheck: false,
					autoComplete: "off",
					"aria-label": `${label} ${index + 1}`,
					"aria-invalid": messages.length > 0,
					value: item,
					onChange: (event: { target: { value: string } }) => onChange(items.map((old, at) => at === index ? event.target.value : old)),
				};
				return (
					<div key={index} className="list-field-row">
						<div className="list-field-entry">
							{multiline ? <textarea rows={Math.min(6, Math.max(1, item.split("\n").length))} {...props} /> : <input type="text" {...props} />}
							<FieldMessages messages={messages} />
						</div>
						<button type="button" className="button quiet" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(items.filter((_, at) => at !== index))}>Remove</button>
					</div>
				);
			})}
			<FieldMessages messages={own} />
			<div>
				<button type="button" className="button quiet" onClick={() => onChange([...items, ""])}>{addLabel}</button>
			</div>
		</fieldset>
	);
}

/** Inherit, off, or set here. */
function ModeChoice({ legend, mode, onChange, scope, setLabel, inherited }: {
	legend: string;
	mode: Mode;
	onChange: (mode: Mode) => void;
	scope: TimberConfigScope;
	setLabel: string;
	/** What inheriting gives, when known. */
	inherited: string | null;
}) {
	const name = useId();
	const options: { value: Mode; label: string }[] = [
		{ value: "inherit", label: inherited !== null ? `${inheritLabel(scope)}: ${inherited}` : inheritLabel(scope) },
		{ value: "off", label: "Off" },
		{ value: "set", label: setLabel },
	];
	return (
		<fieldset className="settings-choice">
			<legend className="field-label">{legend}</legend>
			{options.map(option => (
				<label key={option.value} className="check">
					<input type="radio" name={name} value={option.value} checked={mode === option.value} onChange={() => onChange(option.value)} />
					<span className="check-text">{option.label}</span>
				</label>
			))}
		</fieldset>
	);
}

function Presets({ presets, onPick }: { presets: readonly LauncherPreset[]; onPick: (preset: LauncherPreset) => void }) {
	return (
		<div className="preset-row" role="group" aria-label="Presets">
			<span className="field-label">Presets</span>
			{presets.map(preset => <button key={preset.label} type="button" className="button quiet" onClick={() => onPick(preset)}>{preset.label}</button>)}
		</div>
	);
}

export interface GroupViewProps<Draft> {
	draft: Draft;
	onChange: (draft: Draft) => void;
	scope: TimberConfigScope;
	/** The machine defaults, for what a repository inherits. Null for the machine scope, or when they could not be read. */
	machine: TimberValues | null;
	/** Timber's messages about this group's fields. */
	messages: readonly string[];
}

/** The editor or the coding assistant: a command Timber may start, with its arguments. */
export function LauncherFields({ kind, draft, onChange, scope, machine, messages }: GroupViewProps<LauncherDraft> & { kind: "editor" | "agent" }) {
	const { at } = groupMessages(messages, []);
	const set = (change: Partial<LauncherDraft>) => onChange({ ...draft, ...change });
	return (
		<>
			<ModeChoice
				legend={kind === "editor" ? "Editor" : "Coding assistant"}
				mode={draft.mode}
				onChange={mode => set({ mode })}
				scope={scope}
				setLabel={kind === "editor" ? "This editor" : "This assistant"}
				inherited={machine === null ? null : machineDefault(kind, machine)}
			/>
			{draft.mode === "set" && (
				<>
					<Presets presets={kind === "editor" ? EDITOR_PRESETS : AGENT_PRESETS} onPick={preset => onChange(withPreset(draft, preset))} />
					<TextField
						label="Program"
						value={draft.command}
						onChange={command => set({ command })}
						messages={at(`${kind}.command`)}
						hint="A program name found on the PATH, or a full path."
					/>
					<ListField label="Argument" items={draft.args} onChange={args => set({ args })} at={at} path={`${kind}.args`} multiline={false} addLabel="Add argument" empty="No arguments." />
					<label className="check">
						<input type="checkbox" checked={draft.enabled} onChange={event => set({ enabled: event.target.checked })} />
						<span className="check-text">
							{kind === "editor" ? "Open it by itself when opening a workspace" : "Start it by itself when opening a workspace"}
							<FieldMessages messages={at(`${kind}.enabled`)} />
						</span>
					</label>
					{kind === "editor" ? (
						<label className="check">
							<input type="checkbox" checked={draft.orca} onChange={event => set({ orca: event.target.checked })} />
							<span className="check-text">
								Orca terminals
								<span className="check-hint">Setup scripts and the assistant run in the Orca window.</span>
								<FieldMessages messages={at("editor.integration")} />
							</span>
						</label>
					) : (
						<label className="check">
							<input type="checkbox" checked={draft.waitForSetup === true} onChange={event => set({ waitForSetup: event.target.checked })} />
							<span className="check-text">
								Wait for setup scripts first
								<span className="check-hint">Used with Orca terminals.</span>
								<FieldMessages messages={at("agent.wait_for_setup")} />
							</span>
						</label>
					)}
				</>
			)}
		</>
	);
}

/** The starting branch, the remote, and where worktrees go. Blank inherits. */
export function GitFields({ draft, onChange, scope, machine, messages }: GroupViewProps<GitDraft>) {
	const { at } = groupMessages(messages, []);
	return (
		<>
			<TextField label="Starting branch" value={draft.base_branch} onChange={base_branch => onChange({ ...draft, base_branch })} messages={at("base_branch")} placeholder={placeholderFor("base_branch", scope, machine)} />
			<TextField label="Git remote" value={draft.remote} onChange={remote => onChange({ ...draft, remote })} messages={at("remote")} placeholder={placeholderFor("remote", scope, machine)} />
			<TextField
				label="Worktree folder"
				value={draft.worktree_dir}
				onChange={worktree_dir => onChange({ ...draft, worktree_dir })}
				messages={at("worktree_dir")}
				placeholder={placeholderFor("worktree_dir", scope, machine)}
				hint="A relative folder is taken from the repository's primary checkout. Leave a field blank to use what is shown in it."
			/>
		</>
	);
}

/** Setup scripts and pre-done scripts: trusted shell commands, each one an entry. */
export function ScriptsFields({ draft, onChange, scope, machine, messages }: GroupViewProps<ScriptsDraft>) {
	const { at } = groupMessages(messages, []);
	return (
		<>
			<ModeChoice legend="Scripts" mode={draft.mode} onChange={mode => onChange({ ...draft, mode })} scope={scope} setLabel="These scripts" inherited={machine === null ? null : machineDefault("scripts", machine)} />
			{draft.mode === "set" && (
				<>
					<p className="field-hint">Trusted shell commands, run with your permissions. Each entry is one command, and may span lines.</p>
					<ListField label="Setup script" items={draft.setup} onChange={setup => onChange({ ...draft, setup })} at={at} path="hooks.post_create" multiline addLabel="Add setup script" empty="No setup scripts. They run when a workspace is first created." />
					<ListField label="Pre-done script" items={draft.preDone} onChange={preDone => onChange({ ...draft, preDone })} at={at} path="hooks.pre_delete" multiline addLabel="Add pre-done script" empty="No pre-done scripts. They run before a workspace is removed; a failure stops the removal." />
				</>
			)}
		</>
	);
}

export interface TrackingFieldsProps extends GroupViewProps<TrackingDraft> {
	credentials: TimberSettingsSnapshot["credentials"];
	checks: Partial<Record<Integration, CheckOutcome>>;
	onCheck: (integration: Integration) => void;
	/** Nothing may start while a save runs. */
	busy: boolean;
}

/** One "Test connection", with the exact command it runs and what came of it. */
function ConnectionTest({ integration, scope, outcome, onCheck, busy }: { integration: Integration; scope: TimberConfigScope; outcome: CheckOutcome | undefined; onCheck: () => void; busy: boolean }) {
	const checking = outcome?.state === "checking";
	return (
		<div className="connection-test">
			<div className="connection-test-row">
				<pre className="dialog-command" aria-label={`${INTEGRATION_LABELS[integration]} check command`}>{describeTimberCommand(shownCheckArguments(integration, scope))}</pre>
				<button type="button" className="button quiet" disabled={checking || busy} onClick={onCheck}>{checking ? "Testing" : "Test connection"}</button>
			</div>
			{outcome?.state === "done" && outcome.result.outcome === "checked" && (
				<p className={outcome.result.check.ok ? "connection-result ok" : "connection-result"} role="status">{describeCheck(outcome.result.check)}</p>
			)}
			{outcome?.state === "done" && outcome.result.outcome === "failed" && <TimberFailureDetails title="Could not test the connection" failure={outcome.result.failure} />}
		</div>
	);
}

/** The default tracker, the Jira site, the logins, and their checks. A login is typed only to save or check it. */
export function TrackingFields({ draft, onChange, scope, machine, messages, credentials, checks, onCheck, busy }: TrackingFieldsProps) {
	const { at } = groupMessages(messages, []);
	const trackerId = useId();
	const set = (change: Partial<TrackingDraft>) => onChange({ ...draft, ...change });
	return (
		<>
			<div className="field">
				<label className="field-label" htmlFor={trackerId}>Default issue tracker</label>
				<select id={trackerId} className="field-input" value={draft.tracker} aria-invalid={at("default_tracker").length > 0} onChange={event => set({ tracker: event.target.value as TrackingDraft["tracker"] })}>
					<option value="">{trackerPlaceholder(scope, machine)}</option>
					{TRACKER_CHOICES.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
				</select>
				<FieldMessages messages={at("default_tracker")} />
			</div>

			<h5 className="timber-subtitle">GitHub</h5>
			<p className="field-hint">Timber uses the GitHub CLI login, or GH_TOKEN or GITHUB_TOKEN. It stores no GitHub token. Sign in with gh auth login.</p>
			<ConnectionTest integration="github" scope={scope} outcome={checks.github} onCheck={() => onCheck("github")} busy={busy} />

			<h5 className="timber-subtitle">Jira</h5>
			<ModeChoice legend="Jira site" mode={draft.jiraMode} onChange={jiraMode => set({ jiraMode })} scope={scope} setLabel="This site" inherited={jiraDefault(scope, machine)} />
			{draft.jiraMode === "set" && (
				<>
					<TextField label="Site address" value={draft.siteUrl} onChange={siteUrl => set({ siteUrl })} messages={at("jira.site_url")} placeholder="https://your-team.atlassian.net" />
					<TextField label="Cloud ID" value={draft.cloudId} onChange={cloudId => set({ cloudId })} messages={at("jira.cloud_id")} hint="Only for a scoped API token. Leave blank otherwise." />
				</>
			)}
			<p className="dialog-note">{describeJiraLogin(credentials)}</p>
			<TextField label="Jira email" value={draft.jiraEmail} onChange={jiraEmail => set({ jiraEmail, removeJira: false })} messages={[]} mono={false} secret hint="Kept by Timber in its private store, for this site, on this machine." />
			<TextField label="Jira API token" value={draft.jiraToken} onChange={jiraToken => set({ jiraToken, removeJira: false })} messages={at("credentials.jira")} secret />
			{credentials.jira.state === "saved" && (
				<label className="check">
					<input type="checkbox" checked={draft.removeJira} onChange={event => set({ removeJira: event.target.checked, jiraEmail: "", jiraToken: "" })} />
					<span className="check-text">Remove the saved Jira login</span>
				</label>
			)}
			<ConnectionTest integration="jira" scope={scope} outcome={checks.jira} onCheck={() => onCheck("jira")} busy={busy} />

			<h5 className="timber-subtitle">Linear</h5>
			<p className="dialog-note">{describeLinearLogin(credentials)}</p>
			<TextField label="Linear API key" value={draft.linearKey} onChange={linearKey => set({ linearKey, removeLinear: false })} messages={at("credentials.linear")} secret hint="Kept by Timber in its private store, for every repository on this machine." />
			{credentials.linear.state === "saved" && (
				<label className="check">
					<input type="checkbox" checked={draft.removeLinear} onChange={event => set({ removeLinear: event.target.checked, linearKey: "" })} />
					<span className="check-text">Remove the saved Linear key</span>
				</label>
			)}
			<ConnectionTest integration="linear" scope={scope} outcome={checks.linear} onCheck={() => onCheck("linear")} busy={busy} />
		</>
	);
}


export interface TimberGroupFormProps {
	group: TimberGroup;
	scope: TimberConfigScope;
	outcome: GroupOutcome;
	canSave: boolean;
	/** Why Save is held back, when it is. */
	blocked: string | null;
	editTracked: boolean;
	onSave: () => void;
	onReadAgain: () => void;
	children: ReactNode;
}

/**
 * What came of a save that did not work, as Settings and the setup wizard
 * show it. `rest` holds Timber's messages that no field on screen shows.
 */
export function SaveOutcomeNotes({ outcome, rest, onReadAgain, marked = "The fields it named are marked above." }: {
	outcome: GroupOutcome;
	rest: readonly string[];
	onReadAgain: () => void;
	/** Where the fields Timber named are marked, for when no message is left over. */
	marked?: string;
}) {
	return (
		<>
			{outcome.state === "invalid" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Timber refused these settings</p>
					<p className="sidebar-error-text">{rest.length > 0 ? rest.join("; ") : marked}</p>
					<p className="sidebar-error-text">Nothing was saved. What you typed is still here to correct.</p>
				</div>
			)}
			{outcome.state === "conflict" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">These settings changed outside the app</p>
					<p className="sidebar-error-text">{outcome.failure.diagnostic}</p>
					<p className="sidebar-error-text">Read them again, check your changes, which are kept, against what is there now, then save again.</p>
					<div><button type="button" className="button quiet" onClick={onReadAgain}>Read again</button></div>
				</div>
			)}
			{outcome.state === "refused" && <TimberFailureDetails title="Timber did not save" failure={outcome.failure} />}
			{outcome.state === "failed" && <TimberFailureDetails title="Could not save" failure={outcome.failure} />}
		</>
	);
}

/** One group of Timber's settings: its fields, what came of the last save, the exact command, and its own Save. */
export function TimberGroupForm({ group, scope, outcome, canSave, blocked, editTracked, onSave, onReadAgain, children }: TimberGroupFormProps) {
	const titleId = useId();
	const blockedId = useId();
	const saving = outcome.state === "saving";
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!saving && canSave && blocked === null) onSave();
	};
	const rest = outcome.state === "invalid" ? groupMessages(outcome.fields, DRAWN_PATHS[group]).rest : [];
	return (
		<form className="timber-group" aria-labelledby={titleId} aria-busy={saving} onSubmit={submit}>
			<h4 id={titleId} className="timber-block-title">{TIMBER_GROUP_TITLES[group]}</h4>
			<fieldset className="dialog-fields" disabled={saving}>{children}</fieldset>
			<SaveOutcomeNotes outcome={outcome} rest={rest} onReadAgain={onReadAgain} />
			<div className="field">
				<span className="field-label">Save runs</span>
				<pre className="dialog-command" aria-label={`${TIMBER_GROUP_TITLES[group]} save command`}>{describeTimberCommand(shownApplyArguments(scope, editTracked))}</pre>
			</div>
			{blocked !== null && <p id={blockedId} className="dialog-note">{blocked}</p>}
			<div className="settings-section-foot">
				<p className="settings-section-status" role="status">{outcome.state === "saved" ? "Saved" : ""}</p>
				<button type="submit" className="button primary" aria-disabled={saving || !canSave || blocked !== null} aria-describedby={blocked !== null ? blockedId : undefined}>
					{saving ? "Saving" : "Save"}
				</button>
			</div>
		</form>
	);
}

/** Where the scope's file is, as Timber said. */
function FileNote({ settings }: { settings: TimberSettingsSnapshot }) {
	return settings.exists
		? <p className="settings-section-text">From <span className="mono">{settings.path}</span></p>
		: <p className="settings-section-text">No file yet. Saving creates <span className="mono">{settings.path}</span>.</p>;
}

/**
 * Every group of one scope, read and saved through Timber. Each group keeps
 * what was typed in it until it is saved, also across reading again, and
 * saves only its own fields on top of what was last read.
 */
export function TimberScopeSettings({ scope, repository }: { scope: TimberConfigScope; repository: string | null }) {
	const store = useStore();
	const { reportSaving } = useContext(SettingsSavingContext);
	const key = `${scope}:${repository ?? ""}`;
	const [read, readAgain] = useTimberRead({ scope, repository }, key);
	const [machineRead] = useTimberRead(scope === "repository" ? { scope: "machine", repository: null } : null, key);
	const { edited, setEdited, checks, change, check } = useTimberDrafts();
	const [outcomes, setOutcomes] = useState<Partial<Record<TimberGroup, GroupOutcome>>>({});
	const [editTracked, setEditTracked] = useState(false);
	const trackedId = useId();
	// A ref, not the state: a second Enter can arrive before the next render.
	const running = useRef(false);

	const result = read.result;
	if (result === null) return <p className="settings-section-text" role="status">Reading</p>;
	if (result.outcome === "failed") {
		return (
			<>
				<TimberFailureDetails title="Could not read these settings" failure={result.failure} />
				<p className="dialog-note">Nothing can be changed here until Timber can read them. A file Timber cannot read is fixed in an editor.</p>
				<div><button type="button" className="button quiet" disabled={read.reading} onClick={() => void readAgain()}>{read.reading ? "Reading" : "Read again"}</button></div>
			</>
		);
	}
	const settings = result.settings;
	const machine = scope === "repository" && machineRead.result?.outcome === "read" ? machineRead.result.settings.values : null;
	const drafts: GroupDrafts = { ...draftsOf(settings.values), ...edited };
	const anySaving = Object.values(outcomes).some(outcome => outcome?.state === "saving");
	const needsTracked = settings.tracked && !editTracked;

	const setOutcome = (group: TimberGroup, outcome: GroupOutcome) => setOutcomes(previous => ({ ...previous, [group]: outcome }));

	const save = async (group: TimberGroup) => {
		if (running.current) return;
		running.current = true;
		// Told at once, not after a render, so an Escape right after Save cannot close the dialog in between.
		reportSaving(true);
		setOutcome(group, { state: "saving" });
		try {
			const draft = drafts[group];
			const credentials = group === "tracking" ? credentialsToSave(draft as TrackingDraft) : undefined;
			const answer = await store.saveTimberSettings({
				scope,
				repository,
				revision: settings.revision,
				values: valuesWith(group, draft, settings.values),
				...(credentials === undefined ? {} : { credentials }),
				editTracked: settings.tracked && editTracked,
			});
			if (answer.outcome === "saved") {
				// A login is never shown again once it was sent.
				if (group === "tracking") setEdited(previous => ({ ...previous, tracking: { ...(draft as TrackingDraft), jiraEmail: "", jiraToken: "", linearKey: "", removeJira: false, removeLinear: false } }));
				// Asked each time: the next save of a tracked file needs the say-so again.
				setEditTracked(false);
				await readAgain();
				setEdited(previous => {
					const { [group]: _saved, ...rest } = previous;
					return rest;
				});
			}
			setOutcome(group, outcomeOfSave(answer));
		} finally {
			running.current = false;
			reportSaving(false);
		}
	};

	const readAgainFor = (group: TimberGroup) => {
		void readAgain().then(() => setOutcome(group, IDLE));
	};

	const groupProps = <Group extends TimberGroup>(group: Group) => {
		const outcome = outcomes[group] ?? IDLE;
		return {
			draft: drafts[group],
			onChange: (draft: GroupDrafts[Group]) => change(group, draft, outcomes[group], () => setOutcome(group, IDLE)),
			scope,
			machine,
			messages: outcome.state === "invalid" ? outcome.fields : [],
		};
	};

	return (
		<>
			<div className="timber-head">
				<FileNote settings={settings} />
				<button type="button" className="button quiet" disabled={read.reading || anySaving} onClick={() => void readAgain()}>{read.reading ? "Reading" : "Read again"}</button>
			</div>
			{settings.tracked && (
				<div className="sidebar-error info" role="status">
					<p className="sidebar-error-title">Git tracks this {REPOSITORY_CONFIG_FILE}</p>
					<p className="sidebar-error-text">
						Saving changes the file in the working tree, so the change shows in Git status for everyone's next commit. The index is left alone.
					</p>
					<label className="check">
						<input id={trackedId} type="checkbox" checked={editTracked} disabled={anySaving} onChange={event => setEditTracked(event.target.checked)} />
						<span className="check-text">Change the tracked file with the next save</span>
					</label>
				</div>
			)}
			{TIMBER_GROUPS.map(group => {
				const outcome = outcomes[group] ?? IDLE;
				const changed = groupChanged(group, drafts[group], settings.values);
				const blocked = !changed ? null
					: needsTracked ? "Tick \"Change the tracked file\" above to save." : anySaving && outcome.state !== "saving" ? "Another group is saving." : null;
				return (
					<TimberGroupForm
						key={group}
						group={group}
						scope={scope}
						outcome={outcome}
						canSave={changed}
						blocked={blocked}
						editTracked={settings.tracked && editTracked}
						onSave={() => void save(group)}
						onReadAgain={() => readAgainFor(group)}
					>
						{group === "editor" && <LauncherFields kind="editor" {...groupProps("editor")} />}
						{group === "agent" && <LauncherFields kind="agent" {...groupProps("agent")} />}
						{group === "git" && <GitFields {...groupProps("git")} />}
						{group === "scripts" && <ScriptsFields {...groupProps("scripts")} />}
						{group === "tracking" && (
							<TrackingFields {...groupProps("tracking")} credentials={settings.credentials} checks={checks} onCheck={integration => void check(integration, { scope, repository, tracking: drafts.tracking, values: settings.values })} busy={anySaving} />
						)}
					</TimberGroupForm>
				);
			})}
			<p className="dialog-note">Named workflows and arena presets are not edited here. Saving keeps them as they are.</p>
		</>
	);
}

/** Timber's defaults for every repository on this machine, read and saved through Timber. */
export function MachineSection() {
	const titleId = useId();
	return (
		<section className="settings-section" aria-labelledby={titleId}>
			<header className="settings-section-head">
				<h3 id={titleId} className="settings-section-title">Machine</h3>
				<p className="settings-section-text">
					Timber's defaults for every repository on this machine. A repository's own settings take their place where it sets them.
					Timber checks and saves every change; each group saves on its own.
				</p>
			</header>
			<TimberScopeSettings scope="machine" repository={null} />
		</section>
	);
}

/** One repository's Timber settings, read and saved through Timber, with the repository chosen here. */
export function RepositorySection() {
	const state = useAppState();
	const pickerId = useId();
	const titleId = useId();
	const { repositories } = state;
	const [chosen, setChosen] = useState<string | null>(null);
	// The repository of the selected worktree until another is chosen.
	const fallback = state.selection?.repository ?? repositories[0]?.path ?? null;
	const repository = chosen !== null && repositories.some(candidate => candidate.path === chosen) ? chosen : fallback;
	return (
		<section className="settings-section" aria-labelledby={titleId}>
			<header className="settings-section-head">
				<h3 id={titleId} className="settings-section-title">Repository</h3>
				<p className="settings-section-text">
					Timber's settings for one repository, from {REPOSITORY_CONFIG_FILE} in its primary checkout. What it does not set comes from the machine defaults.
					Timber checks and saves every change; each group saves on its own.
				</p>
			</header>
			{repository === null ? (
				<p className="dialog-note">Add a repository to change its settings.</p>
			) : (
				<>
					<div className="field">
						<label className="field-label" htmlFor={pickerId}>Repository</label>
						<select id={pickerId} className="field-input" value={repository} onChange={event => setChosen(event.target.value)}>
							{repositories.map(candidate => <option key={candidate.path} value={candidate.path}>{candidate.name}</option>)}
						</select>
					</div>
					{/* A new repository starts afresh: nothing typed for another one carries over. */}
					<TimberScopeSettings key={repository} scope="repository" repository={repository} />
				</>
			)}
		</section>
	);
}
