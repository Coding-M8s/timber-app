/**
 * The Program Status Protocol (OSC 7501): how a program in a terminal, such
 * as a coding agent, tells the terminal whether it is working, waiting for
 * the person, or done. The program writes a control sequence addressed to
 * the terminal, as it would a title or a bell, so reading it is not reading
 * what the program prints on screen. Everything here is pure.
 *
 * - Probe: the program writes `ESC ] 7501 ; ? ST`, and a terminal that
 *   supports the protocol answers with `PROBE_ANSWER`.
 * - Report: `ESC ] 7501 ; key=value:key=value ST`, where ST is `ESC \` or
 *   BEL. `state` is required; `kind`, `progress`, `app`, `id`, `title`, and
 *   `msg` are optional, and `title` and `msg` are base64 UTF-8.
 * - Each report replaces its record. `working`, `blocked`, and `idle` end
 *   when the process exits or a new shell prompt starts (OSC 133 `A`);
 *   `done` and `error` stay. A full reset (RIS, `ESC c`) clears every record.
 * - OpenCode 2 never reports `done`: a finished turn goes back to `idle`. So
 *   its root record's `idle` after `working` or `blocked` is read as `done`.
 *   Its root also sums up its sessions, which it mirrors as children and
 *   writes after the root: a root `working` means none of them still waits.
 *   As it quits it writes a root `clear`, so its `done` does not outlive it.
 *
 * Spec: https://www.superlogical.com/rex/docs/build/program-status
 */

/** The states a report can set, in the order the probe answer lists them. `clear` removes records instead. */
export const STATUS_STATES = ["idle", "working", "done", "blocked", "error"] as const;
export type StatusState = typeof STATUS_STATES[number];

/** What a `blocked` program waits for: an approval, an answer, or a sign-in. */
export const STATUS_KINDS = ["permission", "question", "auth"] as const;
export type StatusKind = typeof STATUS_KINDS[number];

/** What a program last reported about itself, as one record. */
export interface ProgramStatus {
	state: StatusState;
	/** Only with `blocked`. Null when not given. */
	kind: StatusKind | null;
	/** 0 to 100, only with `working` or `blocked`. Null when not given, which means it is not known. */
	progress: number | null;
	/** The program's own short name for itself, such as `claude`. */
	app: string | null;
	/** Decoded, one line, with invisible formatting characters removed. */
	title: string | null;
	/** Decoded, one line, with invisible formatting characters removed, such as "approve Write: src/a.ts". */
	message: string | null;
}

/** A child record, such as a subagent's or a background task's, with its path. */
export type ChildStatus = { id: string } & ProgramStatus;

/** One report, read. `id` is the record's path, such as `sub/1`, or null for the root record. */
export type StatusReport =
	| ({ id: string | null } & ProgramStatus)
	| { id: string | null; state: "clear" };

/**
 * The answer to the probe. It names exactly the states and kinds the app
 * handles. The spec lists the states other than `clear`, which every
 * terminal that answers accepts.
 */
export const PROBE_ANSWER = `\x1b]7501;?:states=${STATUS_STATES.join(",")}:kinds=${STATUS_KINDS.join(",")}\x1b\\`;

/** The spec's limits, in bytes. A report over any of them is dropped whole. */
export const STATUS_LIMITS = {
	sequence: 4096,
	key: 16,
	messageEncoded: 2732,
	message: 2048,
	titleEncoded: 256,
	title: 192,
	app: 32,
	id: 128,
	idSegment: 32,
	idDepth: 8,
	records: 256,
} as const;

/** What the scanner found in a session's output that the app acts on. */
export type StatusEvent =
	/** The program asked whether the terminal supports the protocol. */
	| { type: "probe" }
	/** A report, read, or a report that broke the rules and was dropped (`report` null). */
	| { type: "report"; report: StatusReport | null }
	/** A new shell prompt started (OSC 133 `A`). */
	| { type: "prompt" }
	/** A full reset (RIS). */
	| { type: "reset" };

const ESC = "\x1b";
const BEL = "\x07";
/** The 8-bit forms of OSC and ST, which xterm.js also reads. */
const C1_OSC = "\x9d";
const C1_ST = "\x9c";
/** CAN and SUB cancel a sequence. */
const CAN = "\x18";
const SUB = "\x1a";

/** Longer than any sequence the app reads, so a long OSC of another kind (OSC 52 can be megabytes) is never kept whole. */
const COLLECT_LIMIT = STATUS_LIMITS.sequence;

const utf8 = new TextEncoder();
const byteLength = (text: string) => utf8.encode(text).length;

/**
 * Reads OSC 7501, OSC 133 `A`, and RIS out of a session's output, chunk by
 * chunk, as it was printed. A sequence split across chunks is read once it
 * is whole. The output itself is not changed: it still goes to the window as
 * printed, and xterm.js ignores OSC 7501.
 */
export interface StatusScanner {
	scan(data: string): StatusEvent[];
}

export function createStatusScanner(): StatusScanner {
	type Mode = "ground" | "escape" | "osc" | "osc-escape";
	let mode: Mode = "ground";
	let body = "";
	/** The OSC grew past what is kept, so whatever it is, it is dropped. */
	let overflow = false;
	/** How many bytes began the OSC: two for `ESC ]`, and two for the 8-bit form, which is two bytes in UTF-8. */
	let opener = 2;

	function startOsc(length: number): void {
		mode = "osc";
		body = "";
		overflow = false;
		opener = length;
	}

	function finish(terminator: number, events: StatusEvent[]): void {
		mode = "ground";
		const text = body;
		body = "";
		if (text.startsWith("133;")) {
			if (!overflow && (text === "133;A" || text.startsWith("133;A;"))) events.push({ type: "prompt" });
			return;
		}
		// An OSC of another kind was never kept, so it starts with neither.
		if (!text.startsWith("7501;")) return;
		if (overflow || opener + byteLength(text) + terminator > STATUS_LIMITS.sequence) {
			events.push({ type: "report", report: null });
			return;
		}
		const payload = text.slice("7501;".length);
		if (payload === "?") events.push({ type: "probe" });
		else events.push({ type: "report", report: parseStatusReport(payload) });
	}

	return {
		scan(data) {
			const events: StatusEvent[] = [];
			// Most output has no sequence the app reads, so it is not walked through.
			if (mode === "ground" && !data.includes(ESC) && !data.includes(C1_OSC)) return events;
			for (const character of data) {
				switch (mode) {
					case "ground":
						if (character === ESC) mode = "escape";
						else if (character === C1_OSC) startOsc(2);
						break;
					case "escape":
						if (character === "]") startOsc(2);
						else if (character === "c") {
							mode = "ground";
							events.push({ type: "reset" });
						} else mode = character === ESC ? "escape" : "ground";
						break;
					case "osc":
						if (character === BEL) finish(1, events);
						else if (character === C1_ST) finish(2, events);
						else if (character === ESC) mode = "osc-escape";
						else if (character === CAN || character === SUB) {
							mode = "ground";
							body = "";
						} else if (overflow) {
							// Too long, or not a sequence the app reads: only its end is waited for.
						} else if (body.length >= COLLECT_LIMIT) overflow = true;
						else {
							body += character;
							if (body.length <= 5 && !"7501;".startsWith(body) && !"133;".startsWith(body.slice(0, 4))) overflow = true;
						}
						break;
					case "osc-escape":
						if (character === "\\") finish(2, events);
						else {
							// Any other escape ends the OSC unfinished, and starts a sequence of its own.
							body = "";
							mode = "escape";
							if (character === "]") startOsc(2);
							else if (character === "c") {
								mode = "ground";
								events.push({ type: "reset" });
							} else mode = character === ESC ? "escape" : "ground";
						}
						break;
				}
			}
			return events;
		},
	};
}

const KEY = /^[a-z]+$/;
const VALUE = /^[A-Za-z0-9_.,+/=-]*$/;
/** Base64, with or without its `=` padding. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/;
/** What `app` and each segment of `id` may hold: the value set without `,`, `=`, and `/`. */
const NAME = /^[A-Za-z0-9_.+-]+$/;
/** C0 and C1 controls, DEL, and the line and paragraph separators: a label is one line of plain text. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
/** Invisible formatting characters, which include the bidirectional overrides and isolates. */
const FORMAT = /\p{Cf}/gu;

/**
 * A base64 label decoded and made safe to show, `undefined` when it breaks a
 * rule (so the report is dropped), or null when it is empty after cleaning.
 */
function decodeLabel(encoded: string, encodedLimit: number, decodedLimit: number): string | null | undefined {
	if (encoded.length > encodedLimit || !BASE64.test(encoded)) return undefined;
	let bytes: Uint8Array;
	try {
		const padded = encoded.length % 4 === 0 ? encoded : encoded + "=".repeat(4 - encoded.length % 4);
		bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
	} catch {
		return undefined;
	}
	if (bytes.length > decodedLimit) return undefined;
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
	if (CONTROL.test(text)) return undefined;
	const clean = text.replace(FORMAT, "").trim();
	return clean === "" ? null : clean;
}

/** Whether a record path keeps to the limits: segments of 1 to 32 bytes, 8 deep, 128 in all. */
function validId(id: string): boolean {
	if (id === "" || id.length > STATUS_LIMITS.id) return false;
	const segments = id.split("/");
	return segments.length <= STATUS_LIMITS.idDepth && segments.every(segment => NAME.test(segment) && segment.length <= STATUS_LIMITS.idSegment);
}

/**
 * Read the pairs of one report, the part after `7501;`. Malformed pairs are
 * skipped, unknown keys are ignored, and a repeated key takes its last value.
 * Null when the report has no state the app knows, or breaks a limit, or a
 * label cannot be decoded or holds control characters: then nothing changes.
 */
export function parseStatusReport(payload: string): StatusReport | null {
	const pairs = new Map<string, string>();
	for (const pair of payload.split(":")) {
		const equals = pair.indexOf("=");
		if (equals === -1) continue;
		// White space around keys and values is removed, as the spec says.
		const key = pair.slice(0, equals).trim();
		const value = pair.slice(equals + 1).trim();
		if (key === "" || key.length > STATUS_LIMITS.key || !KEY.test(key) || !VALUE.test(value)) continue;
		pairs.set(key, value);
	}
	const state = pairs.get("state");
	const rawId = pairs.get("id");
	if (rawId !== undefined && !validId(rawId)) return null;
	const id = rawId ?? null;
	if (state === "clear") return { id, state };
	if (!STATUS_STATES.includes(state as StatusState)) return null;
	const known = state as StatusState;

	const app = pairs.get("app");
	if (app !== undefined && (!NAME.test(app) || app.length > STATUS_LIMITS.app)) return null;
	const rawTitle = pairs.get("title");
	const title = rawTitle === undefined ? null : decodeLabel(rawTitle, STATUS_LIMITS.titleEncoded, STATUS_LIMITS.title);
	if (title === undefined) return null;
	const rawMessage = pairs.get("msg");
	const message = rawMessage === undefined ? null : decodeLabel(rawMessage, STATUS_LIMITS.messageEncoded, STATUS_LIMITS.message);
	if (message === undefined) return null;

	const rawKind = pairs.get("kind");
	const kind = known === "blocked" && STATUS_KINDS.includes(rawKind as StatusKind) ? rawKind as StatusKind : null;
	const rawProgress = pairs.get("progress");
	const progress = (known === "working" || known === "blocked") && rawProgress !== undefined && /^\d{1,3}$/.test(rawProgress) && Number(rawProgress) <= 100
		? Number(rawProgress)
		: null;
	return { id, state: known, kind, progress, app: app ?? null, title, message };
}

/**
 * The records of one terminal, by path, the root as `""`. At most
 * `STATUS_LIMITS.records`; when full, the one updated longest ago goes.
 */
export interface StatusRecords {
	/** Apply what the scanner found. True when any record changed, the root or a child. */
	apply(event: StatusEvent): boolean;
	/** The process exited: `working`, `blocked`, and `idle` records end. True when any record changed. */
	exited(): boolean;
	/** The root record, or null when there is none. */
	root(): ProgramStatus | null;
	/** Every child record, ordered by path, so a record comes right before its descendants. */
	children(): ChildStatus[];
	/** How many records are kept, children included. */
	size(): number;
}

/**
 * The programs, by `app`, whose root record sums up their sessions: working or
 * blocked while any is, and `idle`, never `done`, once none is.
 */
const SUMS_ITS_SESSIONS: ReadonlySet<string> = new Set(["opencode"]);

/**
 * Whether a root report is the end of a turn: `idle` right after `working` or
 * `blocked`. OpenCode writes a record only when it changed, so no second
 * `idle` follows, and one after `done` is a new OpenCode's first.
 */
function endsTurn(before: ProgramStatus | null, report: ProgramStatus): boolean {
	return report.state === "idle" && report.app !== null && SUMS_ITS_SESSIONS.has(report.app)
		&& before !== null && before.app === report.app
		&& (before.state === "working" || before.state === "blocked");
}

export function sameProgramStatus(one: ProgramStatus | null, other: ProgramStatus | null): boolean {
	if (one === null || other === null) return one === other;
	return one.state === other.state && one.kind === other.kind && one.progress === other.progress
		&& one.app === other.app && one.title === other.title && one.message === other.message;
}

/** Order record paths so a parent comes right before its descendants: `a`, `a/b`, `a-c`, not `a`, `a-c`, `a/b`. */
function comparePaths(one: string, other: string): number {
	const left = one.split("/");
	const right = other.split("/");
	for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
		if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
	}
	return left.length - right.length;
}

export function createStatusRecords(): StatusRecords {
	// A Map keeps the order of insertion, so the first entry is the one updated longest ago.
	const records = new Map<string, ProgramStatus>();

	/**
	 * `working` and `blocked` end on an exit or a new prompt, and so does
	 * `idle`, which the spec lets a terminal drop: a program that idled and
	 * then quit leaves no mark on its shell. `done` and `error` stay. True
	 * when a record ended.
	 */
	function endTransient(): boolean {
		let ended = false;
		for (const [path, record] of records) {
			if (record.state === "working" || record.state === "blocked" || record.state === "idle") {
				records.delete(path);
				ended = true;
			}
		}
		return ended;
	}

	return {
		apply(event) {
			if (event.type === "reset") {
				const had = records.size > 0;
				records.clear();
				return had;
			}
			if (event.type === "prompt") return endTransient();
			if (event.type !== "report" || event.report === null) return false;
			const { id, ...rest } = event.report;
			const path = id ?? "";
			if (rest.state === "clear") {
				const before = records.size;
				if (path === "") records.clear();
				else for (const key of [...records.keys()]) if (key === path || key.startsWith(`${path}/`)) records.delete(key);
				return records.size !== before;
			}
			// The same report again changes nothing the window shows, though it counts as the newest update.
			const before = records.get(path) ?? null;
			records.delete(path);
			const reported = rest as ProgramStatus;
			const record: ProgramStatus = path === "" && endsTurn(before, reported) ? { ...reported, state: "done" } : reported;
			records.set(path, record);
			let changed = !sameProgramStatus(before, record);
			if (path === "" && record.state === "working" && record.app !== null && SUMS_ITS_SESSIONS.has(record.app)) {
				for (const [key, child] of records) {
					if (key === "" || child.state !== "blocked" || child.app !== record.app) continue;
					records.set(key, { ...child, state: "working", kind: null, message: null });
					changed = true;
				}
			}
			if (records.size > STATUS_LIMITS.records) {
				records.delete(records.keys().next().value!);
				changed = true;
			}
			return changed;
		},
		exited: endTransient,
		root: () => {
			const root = records.get("");
			return root ? { ...root } : null;
		},
		children: () => [...records]
			.filter(([path]) => path !== "")
			.sort(([one], [other]) => comparePaths(one, other))
			.map(([id, record]) => ({ id, ...record })),
		size: () => records.size,
	};
}
