import { isFields } from "./timber-ls";

/**
 * Reading a repository's named workflows from `timber __app-config read
 * --scope repository`, version 1 of Timber's settings record
 * (docs/ide-contract.md in the Timber repository). Pure: the main process
 * runs Timber and hands the output here (see src/bun/workflows.ts).
 *
 * Only `effective.workflows` is kept. Everything else in the record,
 * including whether credentials are saved, is dropped here and never logged.
 */
export const APP_CONFIG_READ_ARGUMENTS = ["__app-config", "read", "--scope", "repository"] as const;
export const APP_CONFIG_READ_COMMAND = `timber ${APP_CONFIG_READ_ARGUMENTS.join(" ")}`;
export const SUPPORTED_APP_CONFIG_SCHEMA_VERSION = 1;

/** How much of Timber's diagnostic is passed on. */
const DIAGNOSTIC_LIMIT = 300;

/** Timber's rule for workflow names. A name becomes `--workflow <name>`, so nothing else may pass. */
const WORKFLOW_NAME = /^[a-z][a-z0-9_-]*$/;

/** Whether a value is text in the form of a workflow name, so it can follow `--workflow` and never read as an option. */
export function isWorkflowName(value: unknown): value is string {
	return typeof value === "string" && WORKFLOW_NAME.test(value);
}

/**
 * The agent a workflow starts. `command` is the executable and its
 * arguments exactly as Timber reports them; the arguments can hold tokens,
 * so they are never logged. `none` is a workflow that turns the agent off
 * (`agent = false`). `not-set` leaves the choice to the ordinary settings.
 */
export type WorkflowAgent =
	| { kind: "command"; command: string; args: string[] }
	| { kind: "none" }
	| { kind: "not-set" };

/** One named workflow, as it applies to the repository after Timber merged the machine defaults in. */
export interface Workflow {
	name: string;
	/** Made safe to show, or null when it has none. */
	description: string | null;
	agent: WorkflowAgent;
}

/** Every workflow in Timber's order, or the reason there is no list. Never part of a list. */
export type WorkflowList =
	| { ok: true; workflows: Workflow[] }
	| { ok: false; message: string };

/** Text from Timber, made safe to show: control characters become a replacement mark, and it is cut short. */
export function displayText(value: string, limit = 200): string {
	const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "\uFFFD");
	const characters = Array.from(clean);
	return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : clean;
}

const failed = (message: string): WorkflowList => ({ ok: false, message });
const unreadable = (detail: string) => failed(`${APP_CONFIG_READ_COMMAND} did not answer with a record this app can read: ${detail}.`);

/**
 * The last line Timber wrote to standard error, which is its diagnostic, made
 * safe to show. An older Timber may print a hint before it. Null when it
 * wrote nothing. The text is never parsed for meaning.
 */
export function readDiagnostic(stderr: string): string | null {
	const line = stderr.split(/\r?\n/).map(part => part.trim()).filter(part => part !== "").at(-1);
	if (line === undefined) return null;
	const text = line.replace(/^error:\s*/i, "");
	return text === "" ? null : displayText(text, DIAGNOSTIC_LIMIT);
}

function readAgent(value: unknown): WorkflowAgent | null {
	if (value === undefined) return { kind: "not-set" };
	if (value === false) return { kind: "none" };
	if (!isFields(value)) return null;
	const { command, args } = value;
	if (typeof command !== "string" || command.trim() === "") return null;
	if (!Array.isArray(args) || !args.every(argument => typeof argument === "string")) return null;
	return { kind: "command", command, args: [...args] };
}

/** Null when the value is not one workflow table. Fields this app does not use are ignored. */
function readWorkflow(name: string, value: unknown): Workflow | null {
	if (!WORKFLOW_NAME.test(name) || !isFields(value)) return null;
	const { description } = value;
	if (description !== undefined && typeof description !== "string") return null;
	const agent = readAgent(value.agent);
	if (!agent) return null;
	const shown = description === undefined || description.trim() === "" ? null : displayText(description.trim());
	return { name, description: shown, agent };
}

/**
 * Read what one run of `timber __app-config read --scope repository` printed.
 * `exitCode` is the exit code of that process, or null when it did not exit
 * by itself.
 *
 * A list is accepted only as a whole: Timber must have exited with 0 and
 * printed one version 1 record for the repository scope, and every workflow
 * in it must be readable. Anything else is a failure with a message for the
 * person, never a shorter or empty list. A repository with no workflows is an
 * empty list.
 */
export function readWorkflowList(stdout: string, stderr: string, exitCode: number | null): WorkflowList {
	if (exitCode !== 0) {
		const ending = exitCode === null ? "did not exit by itself" : `exited with code ${exitCode}`;
		const diagnostic = readDiagnostic(stderr);
		return failed(diagnostic === null ? `${APP_CONFIG_READ_COMMAND} ${ending} without saying why.` : `${APP_CONFIG_READ_COMMAND} ${ending}: ${diagnostic}`);
	}

	let record: unknown;
	try {
		record = JSON.parse(stdout);
	} catch {
		return unreadable(stdout.trim() === "" ? "it printed nothing" : "the output is not valid JSON");
	}
	if (!isFields(record)) return unreadable("the output is not a JSON object");

	if (record.schemaVersion !== SUPPORTED_APP_CONFIG_SCHEMA_VERSION) {
		const found = typeof record.schemaVersion === "number" || typeof record.schemaVersion === "string" ? String(record.schemaVersion) : "none";
		return failed(`${APP_CONFIG_READ_COMMAND} answered with schema version ${found}, and this app reads version ${SUPPORTED_APP_CONFIG_SCHEMA_VERSION} only. Update Timber app, or install a Timber that matches it.`);
	}
	if (record.scope !== "repository") return unreadable("it is not a record for the repository scope");
	const { effective } = record;
	if (!isFields(effective)) return unreadable("it has no effective settings");

	const { workflows } = effective;
	if (workflows === undefined) return { ok: true, workflows: [] };
	if (!isFields(workflows)) return unreadable("its workflows are not a table");

	const entries = Object.entries(workflows);
	const listed: Workflow[] = [];
	for (const [index, [name, value]] of entries.entries()) {
		const workflow = readWorkflow(name, value);
		if (!workflow) return unreadable(`workflow ${index + 1} of ${entries.length} is not a workflow this app can read`);
		listed.push(workflow);
	}
	return { ok: true, workflows: listed };
}
