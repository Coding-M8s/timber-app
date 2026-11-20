/**
 * What every reader of a Timber record shares. Pure: the main process runs
 * Timber and the readers hand what it printed here.
 */

/** How much of Timber's diagnostic is passed on. */
const DIAGNOSTIC_LIMIT = 300;

export type Fields = Record<string, unknown>;

export function isFields(value: unknown): value is Fields {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** How a process ended, as a message says it: "exited with code 1". */
export function describeExit(exitCode: number | null): string {
	return exitCode === null ? "did not exit by itself" : `exited with code ${exitCode}`;
}

/** Text from Timber, made safe to show: control characters become a replacement mark, and it is cut short. */
export function displayText(value: string, limit = 200): string {
	const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "\uFFFD");
	const characters = Array.from(clean);
	return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : clean;
}

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

/** Why a command ended badly, in its own words when it said any: "timber ls exited with code 2: no repository". */
export function describeFailedRun(command: string, stderr: string, exitCode: number | null): string {
	const diagnostic = readDiagnostic(stderr);
	const ending = describeExit(exitCode);
	return diagnostic === null ? `${command} ${ending} without saying why.` : `${command} ${ending}: ${diagnostic}`;
}

/**
 * The outside of one record: valid JSON, an object, and the schema version
 * this app reads. `detail` finishes "did not answer with a record this app
 * can read: ...", and `message` is the whole message for a version this app
 * does not read.
 */
export type Envelope =
	| { ok: true; record: Fields }
	| { ok: false; problem: "not-json" | "not-object"; detail: string }
	| { ok: false; problem: "version"; message: string };

/**
 * Read the outside of the record `command` printed. `consequence` is added
 * after "reads version N only" when the version is not one this app reads,
 * such as ", so what it did is unknown".
 */
export function readEnvelope(text: string, command: string, version: number, consequence = ""): Envelope {
	let record: unknown;
	try {
		record = JSON.parse(text);
	} catch {
		return { ok: false, problem: "not-json", detail: text.trim() === "" ? "it printed nothing" : "the output is not valid JSON" };
	}
	if (!isFields(record)) return { ok: false, problem: "not-object", detail: "the output is not a JSON object" };
	if (record.schemaVersion !== version) {
		const found = typeof record.schemaVersion === "number" || typeof record.schemaVersion === "string" ? String(record.schemaVersion) : "none";
		return {
			ok: false,
			problem: "version",
			message: `${command} answered with schema version ${found}, and this app reads version ${version} only${consequence}. Update Timber app, or install a Timber that matches it.`,
		};
	}
	return { ok: true, record };
}
