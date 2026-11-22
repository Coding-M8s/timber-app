import { useEffect, useId, useRef, useState } from "react";
import type { AgentSetting } from "../../../shared/agent";
import type { AgentLocation } from "../../../shared/agent-lookup";
import { SESSION_NAME_LIMIT } from "../../../shared/terminal";
import {
	type AgentDraft, addAgentDraft, agentDraftsOf, agentLookupLine, agentsDraftModel, editAgentDraft, presetsToAdd, removeAgentDraft,
} from "../../agent-format";
import { useAppState, useStore } from "../../store/react";
import { type SectionSave, SettingsSection, useDraftSection } from "./SettingsSection";

export interface AgentsSectionViewProps {
	drafts: readonly AgentDraft[];
	saved: readonly AgentSetting[];
	/** Whether each saved agent's executable was found (`AppState.agentLocations`). */
	locations: readonly AgentLocation[] | null;
	save: SectionSave;
	onAdd: (preset?: AgentSetting) => void;
	onEdit: (key: string, change: { name?: string; command?: string }) => void;
	onRemove: (key: string) => void;
	onSave: () => void;
}

const blank = (draft: AgentDraft) => draft.name.trim() === "" && draft.command.trim() === "";

/** The Agents section as drawn from its data, so it can be tested without a window. */
export function AgentsSectionView({ drafts, saved, locations, save, onAdd, onEdit, onRemove, onSave }: AgentsSectionViewProps) {
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
			</p>
			{drafts.length === 0 && <p className="dialog-note">No agents. The + menu offers only Terminal.</p>}
			<ul className="agent-rows" aria-label="Agents">
				{drafts.map((draft, index) => {
					const row = model.rows[index]!;
					const nameId = `${idPrefix}-name-${draft.key}`;
					const commandId = `${idPrefix}-command-${draft.key}`;
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
							{/* A row just added is not wrong yet: it says what it needs without an alert. */}
							{row.problem !== null && blank(draft) && <p className="field-hint">Type a name and a command, or remove this row.</p>}
							{row.problem !== null && !blank(draft) && (
								<p className="field-error" role="alert">{row.problem}</p>
							)}
							{row.problem === null && row.example !== null && (
								<pre className="dialog-command" aria-label={`Command of ${label}`}>{row.example}</pre>
							)}
							{row.problem === null && (() => {
								const line = agentLookupLine(model.agents[index]!, saved, locations);
								return line && <p className={line.missing ? "field-error" : "field-hint"}>{line.text}</p>;
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
	const { preferences: { agents: saved }, agentLocations } = useAppState();
	// Looked for again whenever the section shows, as one may have been installed since. Nothing runs.
	useEffect(() => {
		void store.locateAgents();
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
		/>
	);
}
