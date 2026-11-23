import { useContext, useEffect, useId, useRef, useState } from "react";
import { type AgentSetting, configFolderProblem } from "../../../shared/agent";
import type { AgentLocation } from "../../../shared/agent-lookup";
import { SESSION_NAME_LIMIT } from "../../../shared/terminal";
import {
	AGENT_CHOICES, type AgentDraft, type AgentDraftChange, addAgentDraft, agentDraftsOf, agentLookupLine, agentsDraftModel, editAgentDraft, presetsToAdd, removeAgentDraft,
} from "../../agent-format";
import type { AgentId } from "../../../shared/agent-registry";
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
export function AgentsSectionView({ drafts, saved, locations, save, onAdd, onEdit, onRemove, onSave, hooks, onHook, onCopy }: AgentsSectionViewProps) {
	const { reportSaving } = useContext(SettingsSavingContext);
	// The hook dialog shows the hook of an agent as last read, so it follows every answer.
	const [dialog, setDialog] = useState<{ name: string; action: HookAction; opener: { button: string; line: string }; problem: string | null; running: boolean } | null>(null);
	const dialogView = dialog === null ? null : hooks?.find(view => view.name === dialog.name) ?? null;
	const hintId = useId();
	const idPrefix = useId();
	const model = agentsDraftModel(drafts, saved);
	const presets = presetsToAdd(drafts);
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
			canSave={model.canSave}
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
			<div className="agent-add">
				{presets.map(preset => (
					<button key={preset.name} type="button" className="button quiet" onClick={() => add(preset)}>Add {preset.name}</button>
				))}
				<button type="button" id={addAnotherId} className="button quiet" onClick={() => add()}>Add another agent</button>
			</div>
		</SettingsSection>
	);
}

/** The Agents section of Settings: the list of agents, edited row by row and saved with its own Save. */
export function AgentsSection() {
	const store = useStore();
	const { preferences: { agents: saved }, agentLocations, statusHooks } = useAppState();
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
	const { draft: drafts, save, change, commit } = useDraftSection(fromSaved);

	const onSave = async () => {
		const { agents, canSave } = agentsDraftModel(drafts, saved);
		if (!canSave) return;
		await commit({ agents });
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
			hooks={statusHooks}
			onHook={(action, request) => action === "install" ? store.installStatusHook(request) : store.removeStatusHook(request)}
			onCopy={text => void store.copyText(text)}
		/>
	);
}
