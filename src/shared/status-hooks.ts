/**
 * Status hooks, for agents that do not report their status through OSC 7501
 * (see docs/decision-agent-status-hooks.md). Everything here is pure.
 *
 * - The person turns a hook on in Settings, Agents. The app then adds entries
 *   to the agent's own settings file, each running the app's `status-hook`
 *   script with the agent's id and an event.
 * - The script appends `agent=<id>:event=<event>` to the file named in
 *   `TIMBER_APP_STATUS`, which only the app's sessions have, so it does
 *   nothing in any other terminal.
 * - The main process reads those lines and turns each into a report of the
 *   session's root record, with the state the registry gives the event.
 *
 * The app keeps no record of what it installed: its entries are known by the
 * script they run.
 */
import { AGENTS, type AgentDefinition, type AgentHook, type AgentId, type ReportedState } from "./agent-registry";
import type { ProgramStatus } from "./program-status";

/** The variable that names a session's status file. */
export const STATUS_VARIABLE = "TIMBER_APP_STATUS";
/** The name of the script the entries run, in the app's settings folder. */
export const STATUS_HOOK_NAME = "status-hook";
/** How much of a status file is read. A turn writes a few dozen bytes. */
export const STATUS_FILE_LIMIT = 64 * 1024;
/** The longest line read, in bytes. A longer one is dropped whole. */
export const STATUS_LINE_LIMIT = 128;

/** What `agent` and `event` may hold, as OSC 7501's `app`. */
const NAME = /^[A-Za-z0-9_.+-]{1,32}$/;

/**
 * The script, as written and as shown before it is. It reads nothing, prints
 * nothing, and always exits 0, so an agent that reads a hook's output or exit
 * code as a decision never gets one.
 */
export const STATUS_HOOK_SCRIPT = `#!/bin/sh
# Timber app status hook, turned on in Settings, Agents.
# Appends this agent's event to the file its session names, and does
# nothing outside the app's sessions.
[ -n "$TIMBER_APP_STATUS" ] || exit 0
printf 'agent=%s:event=%s\\n' "$1" "$2" >>"$TIMBER_APP_STATUS" 2>/dev/null
exit 0
`;

/** One line a hook appended, read. */
export interface StatusLine {
	agent: string;
	event: string;
}

/**
 * Read one line, without its line break: `agent=<id>:event=<event>`, as an
 * OSC 7501 report's pairs are read. Malformed pairs are skipped, and a
 * repeated key takes its last value. Null without both, or over the limit.
 */
export function parseStatusLine(line: string): StatusLine | null {
	if (new TextEncoder().encode(line).length > STATUS_LINE_LIMIT) return null;
	const pairs = new Map<string, string>();
	for (const pair of line.split(":")) {
		const equals = pair.indexOf("=");
		if (equals === -1) continue;
		pairs.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
	}
	const agent = pairs.get("agent");
	const event = pairs.get("event");
	if (agent === undefined || event === undefined || !NAME.test(agent) || !NAME.test(event)) return null;
	return { agent, event };
}

/** The agent of the registry with a hook, by id, or null. */
export function hookedAgent(id: string): (AgentDefinition & { id: AgentId; status: { source: "hook"; app: string; hook: AgentHook } }) | null {
	const agent = AGENTS.find(candidate => candidate.id === id);
	if (agent === undefined || agent.status.source !== "hook") return null;
	return agent as AgentDefinition & { id: AgentId; status: { source: "hook"; app: string; hook: AgentHook } };
}

/**
 * The report a line makes: the state the registry gives its agent's event,
 * as the session's root record, with the agent's `app`. Null for an agent
 * with no hook or an event it does not map. Nothing else of the line is kept.
 */
export function statusFromLine(line: StatusLine): ProgramStatus | null {
	const agent = hookedAgent(line.agent);
	const mapped = agent?.status.hook.events.find(entry => entry.event === line.event);
	if (!agent || !mapped) return null;
	return { state: mapped.state, kind: null, progress: null, app: agent.status.app, title: null, message: null };
}

/** The states an agent can report, in the order Settings names them: from its hook's events, or as the registry says. */
export function reportedStates(agent: AgentDefinition): ReportedState[] {
	const states: readonly ReportedState[] = agent.status.source === "hook" ? agent.status.hook.events.map(entry => entry.state)
		: agent.status.source === "osc-7501" ? agent.status.reports
		: [];
	return (["working", "blocked", "done"] as const).filter(state => states.includes(state));
}

const STATE_WORDS: Record<ReportedState, string> = { idle: "idle", working: "working", blocked: "needs you", done: "done" };

/** "working, needs you, and done", "working and done", or "working". */
export function describeStates(states: readonly ReportedState[]): string {
	const words = states.map(state => STATE_WORDS[state]);
	if (words.length <= 1) return words[0] ?? "";
	if (words.length === 2) return `${words[0]} and ${words[1]}`;
	return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

/**
 * The command an entry runs: the script's full path in single quotes, then
 * the agent's id and the event. Null for a path a single quote would break.
 */
export function hookCommand(scriptPath: string, agent: string, event: string): string | null {
	if (scriptPath.includes("'")) return null;
	return `'${scriptPath}' ${agent} ${event}`;
}

/** Whether an entry's command is one of the app's: it starts with the script's quoted path and a space. */
export function isOwnCommand(command: unknown, scriptPath: string): boolean {
	return typeof command === "string" && command.startsWith(`'${scriptPath}' `);
}

/** A hook as found in the agent's file. */
export type HookState =
	/** None of the app's entries are there. */
	| { kind: "off" }
	/** Every entry is there, exactly as the app writes it. */
	| { kind: "on" }
	/**
	 * An entry of the app's is there, but not as the app writes it, or some
	 * are missing; with `script`, the entries are as written but the script
	 * they run is not.
	 */
	| { kind: "changed"; reason: string; script?: true }
	/** The file cannot be read as the agent reads it. */
	| { kind: "broken"; reason: string };

/** What the app found in the agent's file, and what turning the hook on or off would write. */
export interface HookPlan {
	state: HookState;
	/** The file holds comments, which a rewrite would drop: it is never written, and the entries are pasted by hand. */
	comments: boolean;
	/**
	 * The file holds a value that would not be written back as it is: a
	 * number past what JavaScript holds exactly, or a `__proto__` key. Never
	 * written either.
	 */
	unsafe: boolean;
	/** The file as it would be with the hook on, or null when it cannot be written (`state` not off, or comments). */
	installed: string | null;
	/** The file as it would be with the hook off: null when nothing would be left in it, so it goes; undefined when it cannot be written. */
	removed: string | null | undefined;
	/** The entries the app adds, as JSON, as the person would paste them: for a file not there yet, the whole file. */
	entries: string;
	/** The app's entries as they are now in the file, one per line, for Remove to show. */
	present: string[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** The text without `//` and `/* *\/` comments outside strings, or the same text when it has none. */
export function stripJsonComments(text: string): string {
	let out = "";
	let inString = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index]!;
		if (inString) {
			out += character;
			if (character === "\\") {
				out += text[index + 1] ?? "";
				index += 1;
			} else if (character === "\"") inString = false;
			continue;
		}
		if (character === "\"") {
			inString = true;
			out += character;
		} else if (character === "/" && text[index + 1] === "/") {
			while (index < text.length && text[index] !== "\n") index += 1;
			out += "\n";
		} else if (character === "/" && text[index + 1] === "*") {
			const end = text.indexOf("*/", index + 2);
			index = end === -1 ? text.length : end + 1;
			out += " ";
		} else out += character;
	}
	return out;
}

/** Whether a parsed value holds a number or a key that a rewrite would change. */
function hasUnsafe(value: Json): boolean {
	if (typeof value === "number") return !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value));
	if (Array.isArray(value)) return value.some(hasUnsafe);
	if (isObject(value)) return Object.keys(value).some(key => key === "__proto__") || Object.values(value).some(hasUnsafe);
	return false;
}

/**
 * Read an agent's JSON file as an object: whether it held comments, which a
 * rewrite would drop, and whether it holds a value a rewrite would change.
 */
function readJsonObject(text: string): { parsed: JsonObject; comments: boolean; unsafe: boolean } | { broken: string } {
	let parsed: unknown;
	let comments = false;
	try {
		parsed = JSON.parse(text);
	} catch {
		try {
			parsed = JSON.parse(stripJsonComments(text));
			comments = true;
		} catch {
			return { broken: "It is not valid JSON." };
		}
	}
	if (!isObject(parsed)) return { broken: "It does not hold a JSON object." };
	try {
		return { parsed, comments, unsafe: hasUnsafe(parsed) };
	} catch {
		// Nested deeper than can be walked: the app does not read it further.
		return { broken: "It is nested too deeply to read." };
	}
}

/** The entry the app writes for one event. */
function ownEntry(hook: AgentHook, scriptPath: string, agent: string, event: string): JsonObject {
	return { command: hookCommand(scriptPath, agent, event) ?? "", timeout: hook.timeout };
}

function sameJson(one: Json, other: Json): boolean {
	return JSON.stringify(one) === JSON.stringify(other);
}

function serialize(value: JsonObject): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Read a Cursor `hooks.json` (null when there is none) for the app's hook of
 * `agent`, and plan what turning it on or off writes. Only the app's entries
 * are added or taken out: every other key and value parses the same after.
 * Spacing and key order may change, as Cursor reads JSON.
 */
export function planCursorHooks(text: string | null, hook: AgentHook, scriptPath: string, agent: string): HookPlan {
	const wanted: JsonObject = {};
	for (const { event } of hook.events) wanted[event] = [ownEntry(hook, scriptPath, agent, event)];
	const entries = serialize({ hooks: wanted });
	const broken = (reason: string): HookPlan => ({ state: { kind: "broken", reason }, comments: false, unsafe: false, installed: null, removed: undefined, entries, present: [] });

	if (text === null) {
		// A new file is all the app's: the text shown is the whole file.
		const whole = serialize({ version: 1, hooks: wanted });
		return { state: { kind: "off" }, comments: false, unsafe: false, installed: whole, removed: undefined, entries: whole, present: [] };
	}
	const read = readJsonObject(text);
	if ("broken" in read) return broken(read.broken);
	const { parsed, comments, unsafe } = read;
	if ("version" in parsed && parsed.version !== 1) return broken("Its version is not 1, the one the app knows.");
	if ("hooks" in parsed && !isObject(parsed.hooks)) return broken("Its \"hooks\" is not an object.");
	const hooks: JsonObject = isObject(parsed.hooks) ? parsed.hooks : {};
	for (const [event, list] of Object.entries(hooks)) {
		if (!Array.isArray(list)) return broken(`Its "${event}" is not a list.`);
	}

	// The app's entries, wherever they are, and whether they are exactly what it writes.
	const present: string[] = [];
	let exact = true;
	for (const [event, list] of Object.entries(hooks)) {
		const own = (list as Json[]).filter(entry => isObject(entry) && isOwnCommand(entry.command, scriptPath));
		for (const entry of own) present.push(`"${event}": ${JSON.stringify(entry)}`);
		const expected = wanted[event] as Json[] | undefined;
		if (own.length === 0) continue;
		if (expected === undefined || own.length !== 1 || !sameJson(own[0]!, expected[0]!)) exact = false;
	}
	const missing = hook.events.filter(({ event }) => !(hooks[event] as Json[] | undefined)?.some(entry => isObject(entry) && isOwnCommand(entry.command, scriptPath)));
	let state: HookState;
	if (present.length === 0) state = { kind: "off" };
	else if (exact && missing.length === 0) state = { kind: "on" };
	else if (missing.length > 0 && exact) state = { kind: "changed", reason: `The entries for ${missing.map(({ event }) => event).join(", ")} are missing.` };
	else state = { kind: "changed", reason: "An entry of the app's is not as the app writes it." };

	let installed: string | null = null;
	const writable = !comments && !unsafe;
	if (writable && state.kind === "off") {
		const next: JsonObject = { ...parsed, hooks: { ...hooks } };
		const nextHooks = next.hooks as JsonObject;
		for (const { event } of hook.events) nextHooks[event] = [...((hooks[event] as Json[] | undefined) ?? []), ...(wanted[event] as Json[])];
		installed = serialize(next);
	}

	let removed: string | null | undefined;
	if (writable && present.length > 0) {
		const nextHooks: JsonObject = {};
		for (const [event, list] of Object.entries(hooks)) {
			const kept = (list as Json[]).filter(entry => !(isObject(entry) && isOwnCommand(entry.command, scriptPath)));
			// A list that held only the app's entries goes with them.
			if (kept.length > 0 || (list as Json[]).length === 0) nextHooks[event] = kept;
		}
		const next: JsonObject = { ...parsed, hooks: nextHooks };
		const others = Object.keys(next).filter(key => key !== "version" && key !== "hooks");
		removed = others.length === 0 && Object.keys(nextHooks).length === 0 ? null : serialize(next);
	}
	return { state, comments, unsafe, installed, removed, entries, present };
}

/** The keys of Gemini CLI's `hooks` that hold its settings, not an event's entries (`HOOKS_CONFIG_FIELDS` in 0.70.0). */
const GEMINI_HOOK_SETTINGS = new Set(["enabled", "disabled", "notifications"]);
/** The name Gemini CLI shows for the app's entries, as in its `/hooks` list. */
export const GEMINI_HOOK_NAME = "timber-app-status";

/**
 * The command of the app's entry for Gemini CLI. Gemini CLI takes text a
 * failed hook printed as its answer: a missing script, which `bash` reports
 * with exit 127, would deny every prompt. So whatever the script does, the
 * entry prints nothing and exits 0. Null as `hookCommand` is.
 */
export function geminiCommand(scriptPath: string, agent: string, event: string): string | null {
	const command = hookCommand(scriptPath, agent, event);
	return command === null ? null : `${command} 2>/dev/null || true`;
}

/** Whether a Gemini CLI hook entry (an item of a definition's `hooks`) is one of the app's. */
const isOwnGeminiHook = (entry: Json, scriptPath: string) => isObject(entry) && isOwnCommand(entry.command, scriptPath);

/** The definition the app writes for one event: a matcher when the registry gives one, and one command, its timeout in milliseconds. */
function ownGeminiDefinition(hook: AgentHook, scriptPath: string, agent: string, event: { event: string; matcher?: string }): JsonObject {
	const command: JsonObject = { type: "command", name: GEMINI_HOOK_NAME, command: geminiCommand(scriptPath, agent, event.event) ?? "", timeout: hook.timeout * 1000 };
	return event.matcher === undefined ? { hooks: [command] } : { matcher: event.matcher, hooks: [command] };
}

/**
 * Read Gemini CLI's `settings.json` (null when there is none) for the app's
 * hook of `agent`, and plan what turning it on or off writes. Its `hooks`
 * maps an event to a list of definitions, each with an optional `matcher`
 * and a `hooks` list of commands. The app's definitions are those holding a
 * command of the app's. Only those are added or taken out: every other key
 * and value parses the same after, as for Cursor.
 */
export function planGeminiSettings(text: string | null, hook: AgentHook, scriptPath: string, agent: string): HookPlan {
	const wanted: JsonObject = {};
	for (const event of hook.events) wanted[event.event] = [ownGeminiDefinition(hook, scriptPath, agent, event)];
	const entries = serialize({ hooks: wanted });
	const broken = (reason: string): HookPlan => ({ state: { kind: "broken", reason }, comments: false, unsafe: false, installed: null, removed: undefined, entries, present: [] });

	// A new file is all the app's: the text shown is the whole file.
	if (text === null) return { state: { kind: "off" }, comments: false, unsafe: false, installed: entries, removed: undefined, entries, present: [] };
	const read = readJsonObject(text);
	if ("broken" in read) return broken(read.broken);
	const { parsed, comments, unsafe } = read;
	if ("hooks" in parsed && !isObject(parsed.hooks)) return broken("Its \"hooks\" is not an object.");
	const hooks: JsonObject = isObject(parsed.hooks) ? parsed.hooks : {};
	const events = Object.entries(hooks).filter(([event]) => !GEMINI_HOOK_SETTINGS.has(event));
	for (const [event, list] of events) {
		if (!Array.isArray(list)) return broken(`Its "${event}" is not a list.`);
		if (!list.every(definition => isObject(definition) && Array.isArray(definition.hooks))) return broken(`Its "${event}" holds an entry without a "hooks" list.`);
	}
	const definitions = (list: Json) => list as JsonObject[];
	const holdsOwn = (definition: JsonObject) => (definition.hooks as Json[]).some(entry => isOwnGeminiHook(entry, scriptPath));

	// The app's definitions, wherever they are, and whether they are exactly what it writes.
	const present: string[] = [];
	let exact = true;
	for (const [event, list] of events) {
		const own = definitions(list).filter(holdsOwn);
		for (const definition of own) present.push(`"${event}": ${JSON.stringify(definition)}`);
		const expected = wanted[event] as Json[] | undefined;
		if (own.length === 0) continue;
		if (expected === undefined || own.length !== 1 || !sameJson(own[0]!, expected[0]!)) exact = false;
	}
	const missing = hook.events.filter(({ event }) => {
		const list = hooks[event];
		return !Array.isArray(list) || !definitions(list).some(holdsOwn);
	});
	let state: HookState;
	if (present.length === 0) state = { kind: "off" };
	else if (exact && missing.length === 0) state = { kind: "on" };
	else if (missing.length > 0 && exact) state = { kind: "changed", reason: `The entries for ${missing.map(({ event }) => event).join(", ")} are missing.` };
	else state = { kind: "changed", reason: "An entry of the app's is not as the app writes it." };

	let installed: string | null = null;
	const writable = !comments && !unsafe;
	if (writable && state.kind === "off") {
		const nextHooks: JsonObject = { ...hooks };
		for (const { event } of hook.events) {
			const list = hooks[event];
			nextHooks[event] = [...(Array.isArray(list) ? list : []), ...(wanted[event] as Json[])];
		}
		installed = serialize({ ...parsed, hooks: nextHooks });
	}

	let removed: string | null | undefined;
	if (writable && present.length > 0) {
		const nextHooks: JsonObject = {};
		for (const [event, list] of Object.entries(hooks)) {
			if (GEMINI_HOOK_SETTINGS.has(event) || !Array.isArray(list)) {
				nextHooks[event] = list;
				continue;
			}
			const kept: Json[] = [];
			for (const definition of definitions(list)) {
				if (!holdsOwn(definition)) {
					kept.push(definition);
					continue;
				}
				// Only the app's commands go: a definition that holds another command keeps it, and one left with none goes.
				const others = (definition.hooks as Json[]).filter(entry => !isOwnGeminiHook(entry, scriptPath));
				if (others.length > 0) kept.push({ ...definition, hooks: others });
			}
			// A list that held only the app's definitions goes with them.
			if (kept.length > 0 || list.length === 0) nextHooks[event] = kept;
		}
		// A `hooks` left empty goes too, as most settings files have none until Turn on adds it.
		const { hooks: _hooks, ...rest } = parsed;
		const next: JsonObject = Object.keys(nextHooks).length === 0 ? rest : { ...rest, hooks: nextHooks };
		removed = Object.keys(next).length === 0 ? null : serialize(next);
	}
	return { state, comments, unsafe, installed, removed, entries, present };
}

/** Plan an agent's hook from its file, by the format the registry names. */
export function planHook(text: string | null, hook: AgentHook, scriptPath: string, agent: string): HookPlan {
	switch (hook.format) {
		case "cursor-hooks":
			return planCursorHooks(text, hook, scriptPath, agent);
		case "gemini-settings":
			return planGeminiSettings(text, hook, scriptPath, agent);
	}
}

/** A saved agent's row in Settings, Agents, as its status line shows it. */
export interface StatusHookView {
	/** The row's name in Settings, Agents. */
	name: string;
	/** The agent of the registry the row runs, picked or detected, or null when not known. */
	agent: AgentId | null;
	/** How that agent reports its status: itself, through a hook, or neither, or not known. */
	source: "osc-7501" | "hook" | "none";
	/** The states it can report, for the line to name (`reportedStates`). */
	reports: ReportedState[];
	/** The hook as found, for an agent with one. */
	hook: HookDetails | null;
}

/** An agent's hook as the main process found it. Never the rest of the agent's file, which can hold secrets. */
export interface HookDetails {
	agent: AgentId;
	/** The agent's name, as the registry gives it. */
	agentName: string;
	/** The file, with `~` for the home folder. */
	file: string;
	exists: boolean;
	state: HookState;
	/** Why the app does not write the file, so the entries are added or taken out by hand, or null. */
	byHand: string | null;
	/** What the file held when this was read, for Turn on and Remove to check it did not change since it was shown. */
	token: string;
	/** The app's entries, as JSON, as they are added. */
	entries: string;
	/** The app's entries as they are in the file now, one per line. */
	present: string[];
	/** The script the entries run, and where it is, with `~` for the home folder. */
	script: string;
	scriptPath: string;
	/** The version of the agent the format was checked against. */
	checked: string;
}

/** Turn on, or take out, the hook of an agent a saved row runs, as last shown. */
export interface StatusHookRequest {
	agent: AgentId;
	/** `HookDetails.token` as shown. */
	token: string;
}

export interface StatusHookResult {
	/** `changed-since`: the file changed after it was shown, so nothing was written. `refused`: nothing to do, or not allowed. */
	outcome: "done" | "changed-since" | "refused" | "failed";
	message: string;
	/** Every saved row again, as found after. */
	hooks: StatusHookView[];
}
