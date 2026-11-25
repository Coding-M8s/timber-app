import { useContext, useEffect, useId, useRef, useState } from "react";
import { type AgentSetting, configFolderProblem } from "../../../shared/agent";
import type { AgentLocation } from "../../../shared/agent-lookup";
import { SESSION_NAME_LIMIT } from "../../../shared/terminal";
import {
	AGENT_CHOICES, type AgentDraft, type AgentDraftChange, addAgentDraft, GONE_PICK, type RepositoryDefaultRow, agentDraftsOf, agentLookupLine, agentsDraftModel, generateOptions, editAgentDraft, presetsToAdd, removeAgentDraft, repositoryDefaultChange, repositoryDefaultRows,
} from "../../agent-format";
import type { AgentId } from "../../../shared/agent-registry";
import { GENERATE_INSTRUCTIONS } from "../../../shared/generate-text";
import { useAppState, useStore } from "../../store/react";
import { type SectionSave, SettingsSavingContext, SettingsSection, useDraftSection } from "./SettingsSection";
import type { StatusHookRequest, StatusHookResult, StatusHookView } from "../../../shared/status-hooks";
import type { HookAction } from "../../status-hook-format";
import { StatusHookDialog, StatusHookLine } from "./StatusHookParts";

export interface AgentsSectionViewProps {
	drafts: readonly AgentDraft[];
	saved: readonly AgentSetting[];
	/** Whether each saved agent's executable was found (`AppState.agentLocations`). */
	locations: readonly AgentLocation[] | null;
	save: SectionSave;
	onAdd: (preset?: AgentSetting) => void;
	onEdit: (key: string, change: AgentDraftChange) => void;
	onRemove: (key: string) => void;
	onSave: () => void;
	/** Why nothing can be saved now, or null. */
	blocked?: string | null;
	/** The row that writes commit messages and pull requests' text, by its key, or "" for the first found that can, and whether it differs from what is saved. The choice is not drawn when left out. */
	generateWith?: { key: string; changed: boolean; onChange: (key: string) => void };
	/** "Default agent by repository": a row for each listed repository, and whether any differs from what is saved. Not drawn when left out. */
	repositoryDefaults?: { rows: readonly RepositoryDefaultRow[]; changed: boolean; onChange: (path: string, key: string) => void };
	/** How each saved agent reports its status (`AppState.statusHooks`), by name. None shown when left out. */
	hooks?: readonly StatusHookView[] | null;
	/** Turn on or take out a hook as shown. */
	onHook?: (action: "install" | "remove", request: StatusHookRequest) => Promise<StatusHookResult>;
	onCopy?: (text: string) => void;
}

/** The status of a row, only while it is as saved: a row being edited says nothing until it is saved and read again. */
function viewOf(agent: AgentSetting | undefined, saved: readonly AgentSetting[], hooks: readonly StatusHookView[] | null | undefined): StatusHookView | null {
	if (!agent || !hooks) return null;
	const same = saved.find(candidate => candidate.name === agent.name && candidate.command === agent.command && candidate.agent === agent.agent && (candidate.configFolder ?? "") === (agent.configFolder ?? ""));
	return same === undefined ? null : hooks.find(view => view.name === same.name) ?? null;
}

const blank = (draft: AgentDraft) => draft.name.trim() === "" && draft.command.trim() === "";

/** The Agents section as drawn from its data, so it can be tested without a window. */
export function AgentsSectionView({ drafts, saved, locations, save, onAdd, onEdit, onRemove, onSave, blocked = null, generateWith, repositoryDefaults, hooks, onHook, onCopy }: AgentsSectionViewProps) {
	const { reportSaving } = useContext(SettingsSavingContext);
	// The hook dialog shows the hook of an agent as last read, so it follows every answer.
	const [dialog, setDialog] = useState<{ name: string; action: HookAction; opener: { button: string; line: string }; problem: string | null; running: boolean } | null>(null);
	const dialogView = dialog === null ? null : hooks?.find(view => view.name === dialog.name) ?? null;
	const hintId = useId();
	const idPrefix = useId();
	const model = agentsDraftModel(drafts, saved);
	const presets = presetsToAdd(drafts);
	const choicesChanged = generateWith?.changed === true || repositoryDefaults?.changed === true;
	const addAnotherId = `${idPrefix}-add`;
	const removeId = (key: string) => `${idPrefix}-remove-${key}`;

	// Adding and removing take away or add rows under the keyboard. Once drawn, focus goes to the new row's
	// name, or to the Remove of the row that took the removed one's place, or else to "Add another agent".
	const pendingFocus = useRef<{ kind: "added" } | { kind: "removed"; index: number } | null>(null);
	useEffect(() => {
		const pending = pendingFocus.current;
		if (pending === null) return;
		pendingFocus.current = null;
		if (pending.kind === "added") {
			const last = drafts.at(-1);
			if (last) document.getElementById(`${idPrefix}-name-${last.key}`)?.focus();
			return;
		}
		const next = drafts[Math.min(pending.index, drafts.length - 1)];
		document.getElementById(next ? removeId(next.key) : addAnotherId)?.focus();
	});
	const add = (preset?: AgentSetting) => {
		pendingFocus.current = { kind: "added" };
		onAdd(preset);
	};
	const hookButtonId = (key: string, action: HookAction) => `${idPrefix}-hook-${action}-${key}`;
	const hookLineId = (key: string) => `${idPrefix}-hook-${key}`;
	const closeDialog = () => {
		const opener = dialog?.opener;
		setDialog(null);
		// Back to the button that opened it, or the row's first one when that one is gone.
		if (opener) setTimeout(() => (document.getElementById(opener.button) ?? document.getElementById(opener.line)?.querySelector("button"))?.focus());
	};
	const confirmHook = async () => {
		if (dialog === null || dialogView?.hook == null || !onHook || dialog.running) return;
		const writes = dialog.action === "remove" ? "remove" : "install";
		setDialog({ ...dialog, running: true, problem: null });
		// Settings stays open while the file is written.
		reportSaving(true);
		try {
			const result = await onHook(writes, { agent: dialogView.hook.agent, token: dialogView.hook.token });
			if (result.outcome === "done") closeDialog();
			else setDialog(current => current && { ...current, running: false, problem: result.message });
		} finally {
			reportSaving(false);
		}
	};
	const remove = (key: string) => {
		pendingFocus.current = { kind: "removed", index: drafts.findIndex(draft => draft.key === key) };
		onRemove(key);
	};
	return (
		<SettingsSection
			title="Agents"
			description="Coding agents that the + menu of a worktree's sessions starts, each in a session of its own in the worktree's folder, beside its terminals. The app starts the command without a shell and never reads or answers what an agent prints."
			save={save}
			canSave={blocked === null && (model.canSave || (choicesChanged && model.rows.every(row => row.problem === null) && model.error === null))}
			onSave={onSave}
		>
			<p id={hintId} className="field-hint">
				The executable first, found on the PATH the app was started with, or a full path. Quotes group words with spaces; nothing else is special.
				The agent starts in the worktree's folder, and nothing is added to the command.
				Agent says which agent the command runs, for its mark and for going back to its conversation after a restart; Detect goes by the executable's name.
				Config folder is where that agent keeps its conversations.
			</p>
			{drafts.length === 0 && <p className="dialog-note">No agents. The + menu offers only Terminal.</p>}
			<ul className="agent-rows" aria-label="Agents">
				{drafts.map((draft, index) => {
					const row = model.rows[index]!;
					const nameId = `${idPrefix}-name-${draft.key}`;
					const commandId = `${idPrefix}-command-${draft.key}`;
					const agentId = `${idPrefix}-agent-${draft.key}`;
					const folderId = `${idPrefix}-folder-${draft.key}`;
					const folderWrong = row.folder !== null && configFolderProblem(draft.configFolder.trim()) !== null;
					const label = draft.name.trim() === "" ? `agent ${index + 1}` : draft.name.trim();
					return (
						<li key={draft.key} className="agent-row">
							<div className="agent-row-fields">
								<div className="field agent-name">
									<label className="field-label" htmlFor={nameId}>Name</label>
									<input
										id={nameId}
										className="field-input"
										type="text"
										autoComplete="off"
										maxLength={SESSION_NAME_LIMIT}
										value={draft.name}
										aria-invalid={row.problem !== null}
										onChange={event => onEdit(draft.key, { name: event.target.value })}
									/>
								</div>
								<div className="field agent-command">
									<label className="field-label" htmlFor={commandId}>Command</label>
									<input
										id={commandId}
										className="field-input mono"
										type="text"
										spellCheck={false}
										autoComplete="off"
										aria-describedby={hintId}
										aria-invalid={row.problem !== null}
										value={draft.command}
										onChange={event => onEdit(draft.key, { command: event.target.value })}
									/>
								</div>
								<button type="button" id={removeId(draft.key)} className="text-button agent-remove" aria-label={`Remove ${label}`} onClick={() => remove(draft.key)}>Remove</button>
							</div>
							<div className="agent-row-fields">
								<div className="field agent-which">
									<label className="field-label" htmlFor={agentId}>Agent</label>
									<select id={agentId} className="field-input" value={draft.agent} onChange={event => onEdit(draft.key, { agent: event.target.value as AgentId | "" })}>
										<option value="">{row.detectLabel}</option>
										{AGENT_CHOICES.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
									</select>
								</div>
								{row.folder !== null && (
									<div className="field agent-folder">
										<label className="field-label" htmlFor={folderId}>Config folder <span className="mono">{row.folder.variable}</span></label>
										<input
											id={folderId}
											className="field-input mono"
											type="text"
											spellCheck={false}
											autoComplete="off"
											placeholder={row.folder.placeholder}
											aria-invalid={folderWrong}
											value={draft.configFolder}
											onChange={event => onEdit(draft.key, { configFolder: event.target.value })}
										/>
									</div>
								)}
							</div>
							{/* A row just added is not wrong yet: it says what it needs without an alert. */}
							{row.problem !== null && blank(draft) && <p className="field-hint">Type a name and a command, or remove this row.</p>}
							{row.problem !== null && !blank(draft) && (
								<p className="field-error" role="alert">{row.problem}</p>
							)}
							{row.problem === null && row.example !== null && (
								<pre className="dialog-command" aria-label={`Command of ${label}`}>{row.example}</pre>
							)}
							{row.hint !== null && <p className="field-hint">{row.hint}</p>}
							{row.problem === null && (() => {
								const line = agentLookupLine(model.agents[index]!, saved, locations);
								return line && <p className={line.missing ? "field-error" : "field-hint"}>{line.text}</p>;
							})()}
							{row.problem === null && (() => {
								const view = viewOf(model.agents[index], saved, hooks);
								return view && (
									<StatusHookLine
										view={view}
										rowLabel={label}
										idOf={action => hookButtonId(draft.key, action)}
										lineId={hookLineId(draft.key)}
										onOpen={action => setDialog({ name: view.name, action, opener: { button: hookButtonId(draft.key, action), line: hookLineId(draft.key) }, problem: null, running: false })}
									/>
								);
							})()}
						</li>
					);
				})}
			</ul>
			{model.error !== null && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Too many agents</p>
					<p className="sidebar-error-text">{model.error}</p>
				</div>
			)}
			{dialog !== null && dialogView?.hook && (
				<StatusHookDialog
					hook={dialogView.hook}
					reports={dialogView.reports}
					action={dialog.action}
					running={dialog.running}
					problem={dialog.problem}
					onClose={closeDialog}
					onConfirm={() => void confirmHook()}
					onCopy={text => onCopy?.(text)}
					onSwitch={action => setDialog({ ...dialog, action, problem: null })}
				/>
			)}
			{generateWith && (() => {
				const options = generateOptions(drafts, model.agents);
				const shown = options.find(option => option.key === generateWith.key) ?? (generateWith.key === "" ? options[0] : undefined);
				return (
					<div className="field agent-generate">
						<label className="field-label" htmlFor={`${idPrefix}-generate`}>Generate text with</label>
						<select id={`${idPrefix}-generate`} className="field-input" value={generateWith.key} onChange={event => generateWith.onChange(event.target.value)}>
							<option value="">First agent found that can</option>
							{options.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}
							{generateWith.key !== "" && shown === undefined && <option value={generateWith.key}>An agent that cannot</option>}
						</select>
						<p className="field-hint">
							Writes commit messages, and pull requests' titles and descriptions, when you press Generate or Create pull request. The diff goes to that agent's provider.
							Only its executable and config folder are used, never the other words of its command. A picked agent that is not found is never replaced by another.
						</p>
						{shown && <pre className="dialog-command" aria-label="Command that writes text">{shown.command}</pre>}
						{shown?.caveat && <p className="field-hint">{shown.caveat}</p>}
						<details>
							<summary className="field-hint">The instructions it is given</summary>
							<pre className="commit-output">{`${GENERATE_INSTRUCTIONS.commit.join("\n")}\n\n${GENERATE_INSTRUCTIONS["pull-request"].join("\n")}`}</pre>
						</details>
					</div>
				);
			})()}
			{blocked !== null && <p className="dialog-note">{blocked}</p>}
			{repositoryDefaults && (
				<div className="field agent-defaults" role="group" aria-labelledby={`${idPrefix}-defaults`} aria-describedby={`${idPrefix}-defaults-hint`}>
					<p id={`${idPrefix}-defaults`} className="field-label">Default agent by repository</p>
					<span id={`${idPrefix}-defaults-hint`} className="field-hint">
						The agent that starts in a repository's worktrees when none was picked or named. Kept in the app's settings, never in the repository.
						A picked agent that is not found is never replaced by another.
					</span>
					{repositoryDefaults.rows.length === 0
						? <p className="dialog-note">No repositories are in the app yet.</p>
						: repositoryDefaults.rows.map(row => (
							<label key={row.path} className="field">
								<span className="field-label">{row.name}</span>
								<span className="field-hint">{row.path}</span>
								<select className="field-input" value={row.key} onChange={event => repositoryDefaults.onChange(row.path, event.target.value)}>
									<option value="">First agent found</option>
									{drafts.map((draft, index) => model.agents[index]!.name !== "" && <option key={draft.key} value={draft.key}>{model.agents[index]!.name}</option>)}
									{row.key === GONE_PICK && <option value={GONE_PICK}>{`${row.agent} (not saved)`}</option>}
								</select>
							</label>
						))}
				</div>
			)}
			<div className="agent-add">
				{presets.map(preset => (
					<button key={preset.name} type="button" className="button quiet" onClick={() => add(preset)}>Add {preset.name}</button>
				))}
				<button type="button" id={addAnotherId} className="button quiet" onClick={() => add()}>Add another agent</button>
			</div>
		</SettingsSection>
	);
}

/** Why the agents cannot be saved while the repositories' picks are unread. */
const PICKS_UNREAD = "The repositories' default agents were not read yet, so the agents cannot be saved. Refresh the repositories if this stays.";

/** The Agents section of Settings: the list of agents, edited row by row and saved with its own Save. */
export function AgentsSection() {
	const store = useStore();
	const { preferences: { agents: saved, generateWith }, agentLocations, statusHooks, repositories, repositoryAgents } = useAppState();
	// Looked for again whenever the section shows, as one may have been installed since. Nothing runs.
	// Each agent's status hook is read again too: a file may have changed since. Nothing is written.
	useEffect(() => {
		void store.locateAgents();
		void store.loadStatusHooks();
	}, [store]);
	const [shown, setShown] = useState<{ saved: readonly AgentSetting[]; drafts: AgentDraft[] }>(() => ({ saved, drafts: agentDraftsOf(saved) }));
	// Rows keep their keys while what is saved stays the same, so a field keeps its focus.
	const fromSaved = shown.saved === saved ? shown.drafts : agentDraftsOf(saved);
	if (shown.saved !== saved) setShown({ saved, drafts: fromSaved });
	// The rows only ever differ from what is saved by what the person did.
	const { draft: drafts, save, change, commit, reset } = useDraftSection(fromSaved);

	// The row picked to write text, by its key, so a rename keeps it and a removal clears it. Null while not changed.
	const [pickedKey, setPickedKey] = useState<string | null>(null);
	const savedKey = generateWith === "" ? "" : fromSaved.find(draft => draft.name === generateWith)?.key ?? "gone";
	const chosen = pickedKey ?? savedKey;
	const generateKey = chosen === "" || drafts.some(draft => draft.key === chosen) ? chosen : pickedKey === null && savedKey === "gone" ? "gone" : "";
	const { agents: draftAgents } = agentsDraftModel(drafts, saved);
	const generateName = generateKey === "" ? "" : generateKey === "gone" ? generateWith : draftAgents[drafts.findIndex(draft => draft.key === generateKey)]?.name ?? "";
	const generateChanged = generateName !== generateWith;

	// The rows picked as default agents, by repository, held by key for the same reason. Empty while none was changed.
	const [pickedDefaults, setPickedDefaults] = useState<Readonly<Record<string, string>>>({});
	const picks = repositoryAgents ?? {};
	// Only listed repositories, so one removed meanwhile is never written back.
	const defaultRows = repositoryDefaultRows(repositories, picks, fromSaved, drafts, draftAgents, pickedDefaults);
	const defaultsChange = repositoryDefaultChange(defaultRows, picks);
	const defaultsChanged = Object.keys(defaultsChange).length > 0;

	const onSave = async () => {
		// A rename saved without its picks would clear them.
		if (repositoryAgents === null) return;
		const { agents, canSave, rows, error } = agentsDraftModel(drafts, saved);
		if (!canSave && !((generateChanged || defaultsChanged) && error === null && rows.every(row => row.problem === null))) return;
		await commit({ agents, generateWith: generateName }, () => {
			setPickedKey(null);
			setPickedDefaults({});
		}, defaultsChanged ? defaultsChange : undefined);
	};

	return (
		<AgentsSectionView
			drafts={drafts}
			saved={saved}
			locations={agentLocations}
			save={save}
			onAdd={preset => change(addAgentDraft(drafts, preset))}
			onEdit={(key, edit) => change(editAgentDraft(drafts, key, edit))}
			onRemove={key => change(removeAgentDraft(drafts, key))}
			onSave={() => void onSave()}
			generateWith={{
				key: generateKey,
				changed: generateChanged,
				onChange: key => {
					setPickedKey(key);
					reset();
				},
			}}
			{...(repositoryAgents === null ? { blocked: PICKS_UNREAD } : {
				repositoryDefaults: {
					rows: defaultRows,
					changed: defaultsChanged,
					onChange: (path: string, key: string) => {
						setPickedDefaults({ ...pickedDefaults, [path]: key });
						reset();
					},
				},
			})}
			hooks={statusHooks}
			onHook={(action, request) => action === "install" ? store.installStatusHook(request) : store.removeStatusHook(request)}
			onCopy={text => void store.copyText(text)}
		/>
	);
}
