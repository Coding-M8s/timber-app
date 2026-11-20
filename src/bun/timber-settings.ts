import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createOutputCapture } from "../shared/captured-output";
import type { CapturedOutput, TimberFailure, TimberStatus } from "../shared/model";
import {
	type TimberConnectionCheckRequest, type TimberConnectionCheckResult, type TimberSettingsReadResult,
	type TimberSettingsRequest, type TimberSettingsSaveRequest, type TimberSettingsSaveResult, SETTINGS_INPUT_LIMIT,
	checkConnectionRequest, checkReadRequest, checkSaveRequest, connectionCheckArguments, readConfigRecord, readConnectionCheck,
	readSettingsOutput, settingsApplyArguments, settingsInput, settingsReadArguments, shownCheckArguments,
} from "../shared/timber-config";
import { SETTINGS_DRAFT_PLACEHOLDER, describeTimberCommand, failureOf } from "../shared/timber-result";
import { describeTimberStatus } from "./timber";
import { runTimberWithResultFile } from "./timber-run";
import { messageOf } from "../shared/error-message";

/** Reading settings is offline, so anything this slow is stuck. */
const READ_TIMEOUT_MS = 30_000;
/** Timber gives a login check ten seconds. The app allows for starting Timber too. */
const CHECK_TIMEOUT_MS = 30_000;

/** The most of Timber's answer kept. Settings are a few kilobytes. */
const ANSWER_LIMIT_BYTES = 4 * 1024 * 1024;

type Environment = Record<string, string | undefined>;

export interface TimberSettingsDependencies {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (path: string) => Promise<boolean>;
	environment?: Environment;
	/** Where the private folder for the input and result files is made. The system's temporary folder by default. */
	temporaryRoot?: string;
	/** Where Timber runs for the machine scope, which needs no repository. The home folder by default. */
	machineFolder?: string;
}

/** Timber's settings: the main process side of the Timber sections of Settings. */
export interface TimberSettingsService {
	/** Run `timber __app-config read` for one scope. Read-only. */
	read(request: TimberSettingsRequest): Promise<TimberSettingsReadResult>;
	/** Run `timber __app-config apply` with the draft in a private input file. */
	save(request: TimberSettingsSaveRequest): Promise<TimberSettingsSaveResult>;
	/** Run `timber __app-config check` with the draft in a private input file. Saves nothing. */
	check(request: TimberConnectionCheckRequest): Promise<TimberConnectionCheckResult>;
}

interface Captured {
	stdout: string;
	stderr: CapturedOutput;
	exitCode: number | null;
	stopped: boolean;
}

/** Run Timber as an executable plus arguments, never through a shell, with standard input closed. */
async function runCaptured(argv: string[], cwd: string, environment: Environment, timeout: number): Promise<Captured> {
	const errors = createOutputCapture();
	const output = createOutputCapture(ANSWER_LIMIT_BYTES);
	const child = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: environment, timeout });
	const collect = async (stream: ReadableStream<Uint8Array>, into: typeof errors) => {
		for await (const chunk of stream) into.add(chunk);
	};
	await Promise.all([collect(child.stdout, output), collect(child.stderr, errors), child.exited]);
	const printed = output.finish();
	// Timber's answer is one short JSON line. One cut short by the limit is not used.
	return { stdout: printed.truncated ? "" : printed.text, stderr: errors.finish(), exitCode: child.exitCode, stopped: child.signalCode !== null };
}

/** Timber says why it refused on one line of standard error. That line is shown as it is, not interpreted. */
function refusal(command: string, run: Captured, what: string): TimberFailure {
	const said = run.stderr.text.trim();
	if (said !== "" && !said.includes("\n") && !run.stderr.truncated) return { command, diagnostic: said.replace(/^error: /, ""), output: null };
	return { command, diagnostic: `${what} exited with code ${run.exitCode} and gave no answer. The details below show what it printed.`, output: run.stderr };
}

/**
 * Timber's settings through `timber __app-config`.
 *
 * - The repository scope runs only for a repository in the app's list, in its
 *   primary checkout. The machine scope runs in the home folder.
 * - Timber does all validation and writing. Nothing here reads or writes
 *   Timber's files or its credential stores.
 * - A draft goes to Timber in a new private file that only this user can
 *   read, outside every repository, removed once Timber has ended. Logins
 *   are only ever in that file, never in arguments, and never logged.
 * - Nothing is retried, and nothing a command printed is logged.
 */
export function createTimberSettings(dependencies: TimberSettingsDependencies): TimberSettingsService {
	const { timber, isListed, environment = process.env, temporaryRoot, machineFolder = safeHome() } = dependencies;

	/** The Timber to run and where, or why nothing may run. */
	async function locate(request: TimberSettingsRequest): Promise<{ executable: string; folder: string } | { refused: string }> {
		const status = await timber();
		if (status.state !== "ready") return { refused: `${describeTimberStatus(status)}. Nothing was run.` };
		if (request.scope === "machine") return { executable: status.path, folder: machineFolder };
		const path = request.repository!;
		let listed: boolean;
		try {
			listed = await isListed(path);
		} catch {
			listed = false;
		}
		if (!listed) return { refused: `${path} is not a repository in this app's list. Nothing was run.` };
		return { executable: status.path, folder: path };
	}

	const notRun = (diagnostic: string): TimberFailure => ({ command: null, diagnostic, output: null });

	async function read(request: TimberSettingsRequest): Promise<TimberSettingsReadResult> {
		const problem = checkReadRequest(request);
		if (problem !== null) return { outcome: "failed", failure: notRun(`The request to read Timber's settings cannot be used. ${problem} Nothing was run.`) };
		const located = await locate(request);
		if ("refused" in located) return { outcome: "failed", failure: notRun(located.refused) };
		const args = settingsReadArguments(request.scope);
		const command = describeTimberCommand(args);
		let run: Captured;
		try {
			run = await runCaptured([located.executable, ...args], located.folder, environment, READ_TIMEOUT_MS);
		} catch (error) {
			return { outcome: "failed", failure: { command, diagnostic: `Could not run Timber in ${located.folder}: ${messageOf(error)}`, output: null } };
		}
		if (run.stopped) return { outcome: "failed", failure: { command, diagnostic: `Reading was stopped before it finished. The app waits ${READ_TIMEOUT_MS / 1000} seconds for it.`, output: run.stderr } };
		if (run.exitCode !== 0) return { outcome: "failed", failure: refusal(command, run, "Reading") };
		const reading = readSettingsOutput(run.stdout, request.scope);
		if (!reading.ok) return { outcome: "failed", failure: { command, diagnostic: reading.message, output: null } };
		return { outcome: "read", command, settings: reading.value };
	}

	async function save(request: TimberSettingsSaveRequest): Promise<TimberSettingsSaveResult> {
		const problem = checkSaveRequest(request);
		if (problem !== null) return { outcome: "failed", failure: notRun(`The request to save Timber's settings cannot be used. ${problem} Nothing was saved.`) };
		const bytes = new TextEncoder().encode(settingsInput(request.revision, request.values, request.credentials));
		if (bytes.length > SETTINGS_INPUT_LIMIT) return { outcome: "failed", failure: notRun(`These settings are larger than ${SETTINGS_INPUT_LIMIT / 1024} KiB. Nothing was saved.`) };
		const located = await locate(request);
		if ("refused" in located) return { outcome: "failed", failure: notRun(located.refused.replace("Nothing was run.", "Nothing was saved.")) };

		const run = await runTimberWithResultFile({
			executable: located.executable,
			command: "config",
			arguments: (resultFile, inputFile) => settingsApplyArguments(request.scope, request.editTracked, inputFile, resultFile),
			input: { bytes, shownAs: SETTINGS_DRAFT_PLACEHOLDER },
			folder: located.folder,
			environment,
			...(temporaryRoot === undefined ? {} : { temporaryRoot }),
		});
		const { result } = run;
		const failure = failureOf(run);
		const config = result.record === null ? null : readConfigRecord(result.record.fields.config, request.scope);
		if (result.record !== null && config === null) {
			return { outcome: "failed", failure: { command: run.command, diagnostic: "Timber's result does not say what came of the save in a form this app can read, so what it did is unknown. Read the settings again.", output: run.output } };
		}
		if (config === null || failure === null) {
			if (result.outcome === "succeeded" && config?.result === "saved") return { outcome: "saved", command: run.command, revision: config.revision, credentials: config.credentials };
			return { outcome: "failed", failure: failure ?? { command: run.command, diagnostic: "Timber's result does not go with its outcome, so what it did is unknown. Read the settings again.", output: run.output } };
		}
		switch (config.result) {
			case "invalid":
				return { outcome: "invalid", invalidFields: config.invalidFields, failure };
			case "conflict":
				return { outcome: "conflict", failure };
			case "refused":
				return { outcome: "refused", failure };
			default:
				return { outcome: "failed", failure };
		}
	}

	async function check(request: TimberConnectionCheckRequest): Promise<TimberConnectionCheckResult> {
		const problem = checkConnectionRequest(request);
		if (problem !== null) return { outcome: "failed", failure: notRun(`The request to check a login cannot be used. ${problem} Nothing was run.`) };
		const command = describeTimberCommand(shownCheckArguments(request.integration, request.scope));
		const bytes = new TextEncoder().encode(settingsInput(undefined, request.values, request.credentials));
		if (bytes.length > SETTINGS_INPUT_LIMIT) return { outcome: "failed", failure: notRun(`These settings are larger than ${SETTINGS_INPUT_LIMIT / 1024} KiB. Nothing was run.`) };
		const located = await locate(request);
		if ("refused" in located) return { outcome: "failed", failure: notRun(located.refused) };

		let privateFolder: string;
		try {
			// mkdtemp makes the folder with access for this user only (mode 0700).
			privateFolder = await mkdtemp(join(temporaryRoot ?? tmpdir(), "timber-app-check-"));
		} catch (error) {
			return { outcome: "failed", failure: notRun(`Could not make a temporary folder for the check: ${messageOf(error)}. Nothing was run.`) };
		}
		try {
			const inputFile = join(privateFolder, "input.json");
			try {
				// A new file that only this user can read. What it holds is never logged.
				await writeFile(inputFile, bytes, { flag: "wx", mode: 0o600 });
			} catch (error) {
				return { outcome: "failed", failure: notRun(`Could not save the settings draft for the check: ${messageOf(error)}. Nothing was run.`) };
			}
			let run: Captured;
			try {
				run = await runCaptured([located.executable, ...connectionCheckArguments(request.integration, request.scope, inputFile)], located.folder, environment, CHECK_TIMEOUT_MS);
			} catch (error) {
				return { outcome: "failed", failure: { command, diagnostic: `Could not run Timber in ${located.folder}: ${messageOf(error)}`, output: null } };
			}
			if (run.stopped) return { outcome: "failed", failure: { command, diagnostic: `The check was stopped before it finished. The app waits ${CHECK_TIMEOUT_MS / 1000} seconds for it. Nothing was saved.`, output: run.stderr } };
			// A check that ran prints its answer whether the login works (exit 0) or not (exit 1).
			if (run.exitCode === 0 || run.exitCode === 1) {
				const reading = readConnectionCheck(run.stdout, request.integration);
				if (reading.ok && reading.value.ok === (run.exitCode === 0)) return { outcome: "checked", command, check: reading.value };
				if (run.exitCode === 0 || run.stdout.trim() !== "") return { outcome: "failed", failure: { command, diagnostic: reading.ok ? "Timber's answer does not go with how it exited." : reading.message, output: run.stderr } };
			}
			return { outcome: "failed", failure: refusal(command, run, "The check") };
		} finally {
			// Only the path is logged, never what the file held.
			await rm(privateFolder, { recursive: true, force: true }).catch(error => console.warn(`Could not remove the temporary folder ${privateFolder}: ${messageOf(error)}`));
		}
	}

	return { read, save, check };
}

function safeHome(): string {
	try {
		return homedir() || "/";
	} catch {
		return "/";
	}
}
