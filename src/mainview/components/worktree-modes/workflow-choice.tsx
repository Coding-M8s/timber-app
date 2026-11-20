import type { WorkflowList } from "../../../shared/workflows";

/**
 * The Workflow field of the worktree dialog's modes, and what a pick there
 * means. Pure, so all of it is tested without a window.
 *
 * The list comes from `listWorkflows` and is a help, never a gate: while it
 * is read, or when it has no workflows, there is no field; when it cannot be
 * read, a short note says so, and creating without a workflow still works.
 * Whether a workflow by the picked name still exists is Timber's to say when
 * the command runs, and its diagnostic is shown as it is.
 */

/** The list of workflows to pick from: undefined while it is read. */
export type WorkflowOptions = WorkflowList | undefined;

/**
 * The workflow a command passes, or null for none. A pick the list does not
 * have, or any pick while the list is not there, is none, so the footer never
 * shows a workflow the field does not.
 */
export function chosenWorkflow(options: WorkflowOptions, pick: string | null): string | null {
	if (pick === null || !options?.ok) return null;
	return options.workflows.some(workflow => workflow.name === pick) ? pick : null;
}

/** The part of a request that names a workflow: left out for none. */
export function workflowPart(workflow: string | null): { workflow?: string } {
	return workflow === null ? {} : { workflow };
}

/** The value of the field's option as a pick: the empty value is None. */
export function workflowOfOption(value: string): string | null {
	return value === "" ? null : value;
}

interface WorkflowFieldProps {
	options: WorkflowOptions;
	/** The workflow the command passes, or null for none (see `chosenWorkflow`). */
	chosen: string | null;
	disabled: boolean;
	onPick: (pick: string | null) => void;
}

/** None first and by default, then each workflow in Timber's order, with its description. */
export function WorkflowField({ options, chosen, disabled, onPick }: WorkflowFieldProps) {
	if (options === undefined) return null;
	if (!options.ok) {
		if (chosen !== null) {
			return (
				<p className="field-hint" role="status">
					Workflows could not be read. Setup runs again with the {chosen} workflow, as the failed run had. {options.message}
				</p>
			);
		}
		return (
			<p className="field-hint" role="status">
				Workflows could not be read, so none can be picked. The worktree is made without one. {options.message}
			</p>
		);
	}
	// A workflow kept from a failed run may have left the list since, and is still shown as it runs.
	const unlisted = chosen !== null && !options.workflows.some(workflow => workflow.name === chosen);
	if (options.workflows.length === 0 && !unlisted) return null;
	return (
		<label className="field">
			<span className="field-label">Workflow</span>
			<select className="field-input" name="workflow" value={chosen ?? ""} disabled={disabled} onChange={event => onPick(workflowOfOption(event.target.value))}>
				<option value="">None</option>
				{unlisted && <option value={chosen}>{chosen}: no longer listed</option>}
				{options.workflows.map(workflow => (
					<option key={workflow.name} value={workflow.name}>
						{workflow.description === null ? workflow.name : `${workflow.name}: ${workflow.description}`}
					</option>
				))}
			</select>
			<span className="field-hint">
				{chosen === null
					? "Optional. Only the ordinary setup scripts run."
					: `Runs the setup scripts of ${chosen} after the ordinary ones.`}
			</span>
		</label>
	);
}
