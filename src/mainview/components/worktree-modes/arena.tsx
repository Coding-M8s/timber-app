import { type TagChoice, TagField } from "../TagField";
import { useEffect, useState, useSyncExternalStore } from "react";
import { type ArenaCreation, MAX_ARENA_RUNS, newArenaProblem } from "../../../shared/arenas";
import type { Repository } from "../../../shared/model";
import {
	AGENTS_FOLLOW_UP, ARENA_BETA_NOTE, ARENA_MODE_LABEL, type ArenaGroupDraft, LAUNCH_COMMAND, NEW_ARENA_NOTE, arenasUnavailable, firstGroupDraft, fitGroups, groupAgent,
	groupChoices, newArenaCommandFor, takesEffort, takesModel, toolsUnreadNote,
} from "../../arena-format";
import { AgentIcon } from "../AgentIcon";
import { useAppState, useStore } from "../../store/react";
import type { Submission } from "../../store/submission";
import { type ArenaForm, type ArenaFormState, arenaRequest, createArenaForm } from "./arena-form";
import type { WorktreeDialogMode } from "./mode";

/** What a create that stopped left, for the person to see. Each attempt with how far it got, as Timber said. */
function Reserved({ arena }: { arena: ArenaCreation }) {
	return (
		<div className="arena-reserved" role="note">
			<p className="dialog-note">{`Timber kept arena ${arena.name}${arena.failure ? `; it stopped at ${arena.failure.stage}${arena.failure.attempt ? ` of ${arena.failure.attempt}` : ""}` : ""}. No agent was started. Its name stays taken: compare it from the sidebar, or choose another name.`}</p>
			<ul className="arena-reserved-list">
				{arena.attempts.map(attempt => (
					<li key={attempt.label}>{`${attempt.label}: ${attempt.created ? "created" : "not created"}, ${attempt.failedStage ? `${attempt.failedStage} failed` : attempt.stage}`}</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The "Arena (Beta)" mode as the dialog shows it, for one state of its form:
 * the same fields and command as the New arena dialog had. `unavailable` says
 * why the Timber found cannot make arenas, or is null when it can.
 */
export function arenaMode(form: Pick<ArenaForm, "setName" | "setTask" | "setGroups" | "setBase" | "run">, state: ArenaFormState, repository: string, unavailable: string | null = null, tag: TagChoice | null = null): WorktreeDialogMode {
	const { name, task, groups, base, tools, toolsProblem, presets, presetsProblem, reserved } = state;
	const request = arenaRequest(repository, state);
	const problem = newArenaProblem(request);
	const taken = reserved !== null && reserved.name === name.trim().toLowerCase();
	// A tool or preset that takes no model or effort drops what was typed in them.
	const change = (index: number, edit: Partial<ArenaGroupDraft>) => form.setGroups(groups.map((group, at) => at === index ? fitGroups([{ ...group, ...edit }], tools)[0]! : group));
	const choices = groupChoices(tools, presets);

	const fields = (
		<>
			<p className="dialog-note">{ARENA_BETA_NOTE}</p>
			{unavailable !== null && <p className="field-hint error">{unavailable}</p>}
			<label className="field">
				<span className="field-label">Name or ticket</span>
				<input className="field-input" name="name" value={name} autoComplete="off" spellCheck={false} autoFocus onChange={event => form.setName(event.target.value)} />
				<span className="field-hint">Lowercase letters, digits, - and _, or a ticket key such as ENG-12. Timber decides the arena's name from it.</span>
			</label>
			{/* Every attempt takes it. */}
			{tag && <TagField tags={tag.tags} chosen={tag.chosen} disabled={false} onPick={tag.onPick} />}
			<label className="field">
				<span className="field-label">Task</span>
				<textarea className="field-input arena-task" name="task" rows={5} value={task} onChange={event => form.setTask(event.target.value)} />
				<span className="field-hint">{NEW_ARENA_NOTE}</span>
			</label>
			<fieldset className="arena-groups">
				<legend className="field-label">Attempts</legend>
				{groups.map((group, index) => {
					const native = takesModel(group.choice);
					const effort = takesEffort(group.choice, tools);
					const agent = groupAgent(group.choice, tools, presets);
					const label = `Group ${index + 1}`;
					return (
						<div key={index} className="arena-group" role="group" aria-label={label}>
							<label className="field">
								<span className="field-label">Tool or preset</span>
								<span className="arena-tool-choice">
									{agent !== null && <AgentIcon brand={agent} />}
									<select className="field-input" value={group.choice} onChange={event => change(index, { choice: event.target.value })}>
										{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
									</select>
								</span>
							</label>
							<label className="field">
								<span className="field-label">Model</span>
								<input className="field-input" value={group.model} disabled={!native} placeholder={native ? "Tool default" : "None"} spellCheck={false} onChange={event => change(index, { model: event.target.value })} />
							</label>
							<label className="field">
								<span className="field-label">Effort</span>
								<input className="field-input" value={group.effort} disabled={!effort} placeholder={effort ? "Tool default" : native ? "Not for this tool" : "None"} spellCheck={false} onChange={event => change(index, { effort: event.target.value })} />
							</label>
							<label className="field arena-runs">
								<span className="field-label">Runs</span>
								<input className="field-input" type="number" min={1} max={MAX_ARENA_RUNS} value={group.runs} onChange={event => change(index, { runs: event.target.value })} />
							</label>
							{groups.length > 1 && (
								<button type="button" className="text-button" aria-label={`Remove ${label}`} onClick={() => form.setGroups(groups.filter((_, at) => at !== index))}>Remove</button>
							)}
						</div>
					);
				})}
				<button type="button" className="text-button" onClick={() => form.setGroups([...groups, { ...firstGroupDraft(tools), runs: "1" }])}>Add a group</button>
				{toolsProblem && <p className="field-hint error">{toolsUnreadNote(toolsProblem)}</p>}
				{presetsProblem && <p className="field-hint error">{`The saved presets could not be read: ${presetsProblem}`}</p>}
			</fieldset>
			<label className="field">
				<span className="field-label">Start from</span>
				<input className="field-input" name="base" value={base} autoComplete="off" spellCheck={false} onChange={event => form.setBase(event.target.value)} />
				<span className="field-hint">Optional. A branch or ref every attempt starts from. Left empty, Timber chooses as for a new worktree.</span>
			</label>
			{problem !== null && <p className="field-hint">{problem}</p>}
			{taken && <p className="field-hint error">{`Timber already kept an arena called ${reserved?.name}. Choose another name.`}</p>}
		</>
	);

	return {
		label: ARENA_MODE_LABEL,
		fields,
		command: newArenaCommandFor(name, groups, base),
		canSubmit: unavailable === null && problem === null && !taken,
		submitLabel: "Create arena",
		submitLabels: ["Create arena"],
		runningLabel: "Creating every attempt's worktree",
		failureTitle: "Could not create the arena",
		// The store starts each attempt's agent as Timber says, never the dialog's pick, and Timber runs setup itself.
		agentStart: "never",
		setupStart: "never",
		worktree: null,
		workflow: null,
		run: () => form.run(tag?.chosen),
		ownFollowUps: [{ note: AGENTS_FOLLOW_UP, command: LAUNCH_COMMAND }],
		failureNote: reserved ? <Reserved arena={reserved} /> : undefined,
		unavailable,
	};
}

/**
 * "Arena (Beta)": `timber arena new`. Two or more agents get the same task
 * from the same commit, each in its own worktree. `active` is true while the
 * mode is on screen: the tools and presets are read only then, since each read runs
 * Timber and most dialogs never show this mode.
 */
export function useArenaMode(repository: Repository, submission: Submission, active: boolean, tag: TagChoice | null = null): WorktreeDialogMode {
	const store = useStore();
	const unavailable = arenasUnavailable(useAppState().arenas[repository.path]);
	const [form] = useState(() => createArenaForm(store, repository.path, submission));
	const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
	useEffect(() => {
		if (active && unavailable === null) void form.readChoices();
	}, [form, active, unavailable]);
	return arenaMode(form, state, repository.path, unavailable, tag);
}
