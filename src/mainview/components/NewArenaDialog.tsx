import { useEffect, useState } from "react";
import { MAX_ARENA_RUNS, type ArenaCreation, type ArenaPreset, newArenaProblem } from "../../shared/arenas";
import type { Repository } from "../../shared/model";
import {
	AGENTS_FOLLOW_UP, ARENA_BETA_NOTE, type ArenaGroupDraft, LAUNCH_COMMAND, NEW_ARENA_LABEL, NEW_ARENA_NOTE, baseOf, describeCreated, firstGroupDraft, groupChoices, groupOf,
	newArenaCommandFor, takesModel,
} from "../arena-format";
import { useStore, useSubmission } from "../store/react";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import { OperationDialog } from "./OperationDialog";

export interface NewArenaViewProps {
	repositoryName: string;
	name: string;
	task: string;
	groups: readonly ArenaGroupDraft[];
	base: string;
	presets: readonly ArenaPreset[];
	/** Why the presets could not be read, or null. The tools are offered either way. */
	presetsProblem: string | null;
	/**
	 * What Timber reserved before a create stopped, or null. A reserved arena
	 * keeps its name, so the same name is not offered again.
	 */
	reserved: ArenaCreation | null;
	submission: SubmissionState;
	onName: (name: string) => void;
	onTask: (task: string) => void;
	onGroups: (groups: ArenaGroupDraft[]) => void;
	onBase: (base: string) => void;
	onSubmit: () => void;
	onClose: () => void;
}

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

/** What the New arena dialog shows for a given state. It holds no state of its own. */
export function NewArenaView(props: NewArenaViewProps) {
	const { repositoryName, name, task, groups, base, presets, presetsProblem, reserved, submission, onName, onTask, onGroups, onBase, onSubmit, onClose } = props;
	const choices = groupChoices(presets);
	const problem = newArenaProblem({ name, task, groups: groups.map(groupOf), base: baseOf(base) });
	const taken = reserved !== null && reserved.name === name.trim().toLowerCase();
	const change = (index: number, edit: Partial<ArenaGroupDraft>) => onGroups(groups.map((group, at) => at === index ? { ...group, ...edit } : group));
	return (
		<OperationDialog
			title={`${NEW_ARENA_LABEL} in ${repositoryName}`}
			command={newArenaCommandFor(name, groups, base)}
			submission={submission}
			submitLabel="Create arena"
			runningLabel="Creating every attempt's worktree"
			failureTitle="Could not create the arena"
			failureNote={reserved ? <Reserved arena={reserved} /> : undefined}
			canSubmit={problem === null && !taken}
			followUps={[{ note: AGENTS_FOLLOW_UP, command: LAUNCH_COMMAND }]}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			<p className="dialog-note">{ARENA_BETA_NOTE}</p>
			<label className="field">
				<span className="field-label">Name or ticket</span>
				<input className="field-input" name="name" value={name} autoComplete="off" spellCheck={false} autoFocus onChange={event => onName(event.target.value)} />
				<span className="field-hint">Lowercase letters, digits, - and _, or a ticket key such as ENG-12. Timber decides the arena's name from it.</span>
			</label>
			<label className="field">
				<span className="field-label">Task</span>
				<textarea className="field-input arena-task" name="task" rows={5} value={task} onChange={event => onTask(event.target.value)} />
				<span className="field-hint">{NEW_ARENA_NOTE}</span>
			</label>
			<fieldset className="arena-groups">
				<legend className="field-label">Attempts</legend>
				{groups.map((group, index) => {
					const native = takesModel(group.choice);
					const label = `Group ${index + 1}`;
					return (
						<div key={index} className="arena-group" role="group" aria-label={label}>
							<label className="field">
								<span className="field-label">Tool or preset</span>
								<select className="field-input" value={group.choice} onChange={event => change(index, { choice: event.target.value, ...(takesModel(event.target.value) ? {} : { model: "", effort: "" }) })}>
									{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
								</select>
							</label>
							<label className="field">
								<span className="field-label">Model</span>
								<input className="field-input" value={group.model} disabled={!native} placeholder={native ? "Tool default" : "None"} spellCheck={false} onChange={event => change(index, { model: event.target.value })} />
							</label>
							<label className="field">
								<span className="field-label">Effort</span>
								<input className="field-input" value={group.effort} disabled={!native} placeholder={native ? "Tool default" : "None"} spellCheck={false} onChange={event => change(index, { effort: event.target.value })} />
							</label>
							<label className="field arena-runs">
								<span className="field-label">Runs</span>
								<input className="field-input" type="number" min={1} max={MAX_ARENA_RUNS} value={group.runs} onChange={event => change(index, { runs: event.target.value })} />
							</label>
							{groups.length > 1 && (
								<button type="button" className="text-button" aria-label={`Remove ${label}`} onClick={() => onGroups(groups.filter((_, at) => at !== index))}>Remove</button>
							)}
						</div>
					);
				})}
				<button type="button" className="text-button" onClick={() => onGroups([...groups, { ...firstGroupDraft(), runs: "1" }])}>Add a group</button>
				{presetsProblem && <p className="field-hint error">{`The saved presets could not be read: ${presetsProblem}`}</p>}
			</fieldset>
			<label className="field">
				<span className="field-label">Start from</span>
				<input className="field-input" name="base" value={base} autoComplete="off" spellCheck={false} onChange={event => onBase(event.target.value)} />
				<span className="field-hint">Optional. A branch or ref every attempt starts from. Left empty, Timber chooses as for a new worktree.</span>
			</label>
			{problem !== null && <p className="field-hint">{problem}</p>}
			{taken && <p className="field-hint error">{`Timber already kept an arena called ${reserved!.name}. Choose another name.`}</p>}
		</OperationDialog>
	);
}

/** The New arena dialog of one repository, from its "+" menu or the palette. */
export function NewArenaDialog({ repository }: { repository: Repository }) {
	const store = useStore();
	const [name, setName] = useState("");
	const [task, setTask] = useState("");
	const [groups, setGroups] = useState<ArenaGroupDraft[]>(() => [firstGroupDraft()]);
	const [base, setBase] = useState("");
	const [presets, setPresets] = useState<{ list: ArenaPreset[]; problem: string | null }>({ list: [], problem: null });
	const [reserved, setReserved] = useState<ArenaCreation | null>(null);
	const { submission, state } = useSubmission(() => store.closeDialog());

	useEffect(() => {
		let current = true;
		void store.listArenaPresets(repository.path).then(answer => {
			if (current) setPresets(answer.ok ? { list: answer.presets, problem: null } : { list: [], problem: answer.message });
		});
		return () => {
			current = false;
		};
	}, [store, repository.path]);

	const edit = <Value,>(set: (value: Value) => void) => (value: Value) => {
		set(value);
		submission.clearFailure();
	};
	const run = () => {
		const request = { repository: repository.path, name: name.trim(), task, groups: groups.map(groupOf), base: baseOf(base) };
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const result = await store.newArena(request);
			if (result.outcome === "created") return { ok: true, toast: describeCreated(result.arena.name, result.arena.attempts.length) };
			if (result.arena) setReserved(result.arena);
			return { ok: false, failure: result.failure };
		});
	};
	return (
		<NewArenaView
			repositoryName={repository.name}
			name={name}
			task={task}
			groups={groups}
			base={base}
			presets={presets.list}
			presetsProblem={presets.problem}
			reserved={reserved}
			submission={state}
			onName={edit(setName)}
			onTask={edit(setTask)}
			onGroups={edit(setGroups)}
			onBase={edit(setBase)}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}
