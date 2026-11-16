import type { Engine } from "../../shared/engine";
import type { TimberStatus } from "../../shared/model";
import { REPOSITORY_CONFIG_FILE } from "../../shared/timber-config";
import { APP_CONFIG_READ_COMMAND, type Workflow, type WorkflowList } from "../../shared/workflows";

/** The part of the engine about named workflows. */
export type WorkflowCapabilities = Pick<Engine, "listWorkflows">;

export interface WorkflowControls {
	/**
	 * Decide what the workflows of one repository, named by its primary
	 * checkout, answer from now on: a list, a failure, or null for the sample.
	 */
	setWorkflows(repository: string, list: WorkflowList | null): void;
}

/** Sample workflows, one for each kind of agent: a command, none, and not set. */
export const sampleWorkflows: Workflow[] = [
	{ name: "review", description: "Check out a pull request to review", agent: { kind: "command", command: "claude", args: ["--permission-mode", "plan"] } },
	{ name: "triage", description: "Look at a bug report", agent: { kind: "none" } },
	{ name: "explore", description: null, agent: { kind: "not-set" } },
];

/** Sample answers by primary checkout. A listed repository not here has no workflows. */
export const sampleWorkflowLists: Readonly<Record<string, WorkflowList>> = {
	"/work/timber": { ok: true, workflows: sampleWorkflows },
	// As its sample `.timber.toml` is malformed (see ./mock-timber-config.ts).
	"/work/billing": { ok: false, message: `${APP_CONFIG_READ_COMMAND} exited with code 1: Invalid TOML in /work/billing/${REPOSITORY_CONFIG_FILE}` },
};

/**
 * Named workflows acted out from sample data, for the browser build and
 * tests. As the main process does, a repository must be in the list and
 * Timber must be ready, with the main process's words for when it is not.
 */
export function createMockWorkflows(isListed: (path: string) => boolean, timber: () => TimberStatus): WorkflowCapabilities & WorkflowControls {
	const chosen = new Map<string, WorkflowList>();
	return {
		async listWorkflows(repository) {
			if (!isListed(repository)) return { ok: false, message: `${repository} is not a repository in the app's list.` };
			const status = timber();
			if (status.state === "not-found") return { ok: false, message: "Timber was not found on PATH." };
			if (status.state === "too-old") return { ok: false, message: `Timber ${status.found} at ${status.path} is older than the required ${status.required}.` };
			return structuredClone(chosen.get(repository) ?? sampleWorkflowLists[repository] ?? { ok: true, workflows: [] });
		},
		setWorkflows(repository, list) {
			if (list === null) chosen.delete(repository);
			else chosen.set(repository, structuredClone(list));
		},
	};
}
