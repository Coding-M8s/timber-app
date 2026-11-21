import { describe, expect, test } from "bun:test";
import {
	PROBE_ANSWER, STATUS_LIMITS, type StatusEvent, createStatusRecords, createStatusScanner, parseStatusReport,
} from "../src/shared/program-status";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const report = (pairs: string, end = "\x1b\\") => `\x1b]7501;${pairs}${end}`;

function scanAll(...chunks: string[]): StatusEvent[] {
	const scanner = createStatusScanner();
	return chunks.flatMap(chunk => scanner.scan(chunk));
}

describe("the probe answer", () => {
	test("names the states and kinds the app handles, and ends with ST", () => {
		expect(PROBE_ANSWER).toBe("\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\");
	});
});

describe("scanning output", () => {
	test("reads a probe, ended by ST or BEL", () => {
		expect(scanAll("\x1b]7501;?\x1b\\")).toEqual([{ type: "probe" }]);
		expect(scanAll("\x1b]7501;?\x07")).toEqual([{ type: "probe" }]);
	});

	test("reads a report ended by ST and one ended by BEL", () => {
		const events = scanAll(`text ${report("state=working")} more ${report("state=done", "\x07")}`);
		expect(events.map(event => event.type === "report" && event.report?.state)).toEqual(["working", "done"]);
	});

	test("reads a report split across chunks at every point", () => {
		const whole = `before${report(`state=blocked:kind=permission:msg=${b64("approve Write: src/a.ts")}`)}after`;
		for (let at = 0; at <= whole.length; at += 1) {
			const events = scanAll(whole.slice(0, at), whole.slice(at));
			expect(events).toEqual([{ type: "report", report: { id: null, state: "blocked", kind: "permission", progress: null, app: null, title: null, message: "approve Write: src/a.ts" } }]);
		}
	});

	test("reads the 8-bit forms of OSC and ST, each two bytes in UTF-8", () => {
		expect(scanAll("\x9d7501;state=idle\x9c")).toHaveLength(1);
		const fill = (length: number) => `\x9d7501;state=idle:x=${"a".repeat(length)}\x9c`;
		const base = Buffer.byteLength(fill(0));
		expect(scanAll(fill(STATUS_LIMITS.sequence - base))[0]).not.toEqual({ type: "report", report: null });
		expect(scanAll(fill(STATUS_LIMITS.sequence - base + 1))).toEqual([{ type: "report", report: null }]);
	});

	test("reads a new prompt from OSC 133 A, and a full reset", () => {
		expect(scanAll("\x1b]133;A\x07$ ", "\x1b]133;A;cl=m\x1b\\", "\x1bc")).toEqual([{ type: "prompt" }, { type: "prompt" }, { type: "reset" }]);
		expect(scanAll("\x1b]133;B\x07\x1b]133;D;0\x07")).toEqual([]);
	});

	test("an escape with an intermediate before c is not a full reset", () => {
		expect(scanAll("\x1b(c\x1b#c\x1b c")).toEqual([]);
	});

	test("OSC 133 with another letter, or A followed by more letters, is not a new prompt", () => {
		expect(scanAll("\x1b]133;AB\x07\x1b]133;C\x07")).toEqual([]);
	});

	test("an ESC at the end of a chunk waits for the next one", () => {
		expect(scanAll("\x1b]7501;state=done\x1b", "\\")).toHaveLength(1);
		expect(scanAll("text\x1b", "c")).toEqual([{ type: "reset" }]);
	});

	test("ignores other OSCs, CSIs, and plain text", () => {
		expect(scanAll("\x1b]0;title\x07\x1b[31mred\x1b[0m\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\")).toEqual([]);
	});

	test("an escape other than ST inside an OSC ends it unread, and starts its own sequence", () => {
		expect(scanAll(`\x1b]7501;state=working\x1b${report("state=done")}`).map(event => event.type === "report" && event.report?.state)).toEqual(["done"]);
		expect(scanAll("\x1b]7501;state=working\x1bc")).toEqual([{ type: "reset" }]);
	});

	test("CAN and SUB cancel a sequence", () => {
		expect(scanAll("\x1b]7501;state=working\x18\x07", "\x1b]7501;state=done\x1a\x1b\\")).toEqual([]);
	});

	test("a report over 4096 bytes is dropped whole, and the next one is read", () => {
		const long = report(`state=working:app=${"a".repeat(STATUS_LIMITS.sequence)}`);
		const events = scanAll(long.slice(0, 3000), long.slice(3000), report("state=done"));
		expect(events).toEqual([{ type: "report", report: null }, { type: "report", report: { id: null, state: "done", kind: null, progress: null, app: null, title: null, message: null } }]);
	});

	test("a report of exactly 4096 bytes with its ESC ] and ST is read", () => {
		const fill = (length: number) => report(`state=idle:x=${"a".repeat(length)}`);
		const base = fill(0).length;
		expect(scanAll(fill(STATUS_LIMITS.sequence - base))).toHaveLength(1);
		expect(scanAll(fill(STATUS_LIMITS.sequence - base))[0]).not.toEqual({ type: "report", report: null });
		expect(scanAll(fill(STATUS_LIMITS.sequence - base + 1))).toEqual([{ type: "report", report: null }]);
	});

	test("a long OSC of another kind is not kept", () => {
		expect(scanAll(`\x1b]52;c;${"A".repeat(100_000)}\x07`)).toEqual([]);
	});
});

describe("reading a report", () => {
	test("reads every key", () => {
		expect(parseStatusReport(`state=working:progress=40:app=claude:title=${b64("Fix tests")}:msg=${b64("running bun test")}`)).toEqual({
			id: null, state: "working", kind: null, progress: 40, app: "claude", title: "Fix tests", message: "running bun test",
		});
	});

	test("skips malformed pairs and unknown keys, and a repeated key takes its last value", () => {
		expect(parseStatusReport("junk:=x:STATE=done:state=idle:colour=red:state=done")?.state).toBe("done");
		expect(parseStatusReport("state=done:app=a b")?.state).toBe("done");
	});

	test("reads base64 with or without its padding", () => {
		expect(parseStatusReport("state=blocked:msg=YXBwcm92ZQ")).toMatchObject({ message: "approve" });
		expect(parseStatusReport("state=blocked:msg=YXBwcm92ZQ==")).toMatchObject({ message: "approve" });
	});

	test("app and record paths hold only letters, digits, and _ . + -", () => {
		expect(parseStatusReport("state=done:app=claude-code")).toMatchObject({ app: "claude-code" });
		expect(parseStatusReport("state=done:app=a,b")).toBeNull();
		expect(parseStatusReport("state=done:app=a/b")).toBeNull();
		expect(parseStatusReport("state=done:id=a=b")).toBeNull();
		expect(parseStatusReport("state=done:id=sub.1/task_2")).toMatchObject({ id: "sub.1/task_2" });
	});

	test("removes white space around keys and values", () => {
		expect(parseStatusReport(" state = blocked : kind = auth ")).toMatchObject({ state: "blocked", kind: "auth" });
	});

	test("needs a state it knows", () => {
		expect(parseStatusReport("kind=permission")).toBeNull();
		expect(parseStatusReport("state=sleeping")).toBeNull();
		expect(parseStatusReport("state=clear")).toEqual({ id: null, state: "clear" });
	});

	test("keeps kind only with blocked, and progress only with working or blocked", () => {
		expect(parseStatusReport("state=blocked:kind=question:progress=10")).toMatchObject({ kind: "question", progress: 10 });
		expect(parseStatusReport("state=done:kind=question:progress=10")).toMatchObject({ kind: null, progress: null });
		expect(parseStatusReport("state=blocked:kind=coffee")).toMatchObject({ kind: null });
		expect(parseStatusReport("state=working:progress=101")).toMatchObject({ progress: null });
		expect(parseStatusReport("state=working:progress=-1")).toMatchObject({ progress: null });
	});

	test("drops a report whose label holds control characters, cannot be decoded, or is too long", () => {
		expect(parseStatusReport(`state=done:msg=${b64("line\nbreak")}`)).toBeNull();
		expect(parseStatusReport(`state=done:msg=${b64("bell\x07")}`)).toBeNull();
		expect(parseStatusReport(`state=done:title=${b64("\x1b[31m")}`)).toBeNull();
		// A value with characters outside the allowed set is a malformed pair, which is skipped.
		expect(parseStatusReport("state=done:msg=not*base64")).toMatchObject({ state: "done", message: null });
		// One base64 character too many, past a whole group, cannot be decoded.
		expect(parseStatusReport("state=done:msg=YXBwcm92ZQa")).toBeNull();
		expect(parseStatusReport(`state=done:msg=${Buffer.from([0xff, 0xfe]).toString("base64")}`)).toBeNull();
		expect(parseStatusReport(`state=done:msg=${b64("a".repeat(2049))}`)).toBeNull();
		expect(parseStatusReport(`state=done:msg=${b64("a".repeat(2048))}`)?.state).toBe("done");
		expect(parseStatusReport(`state=done:title=${b64("a".repeat(193))}`)).toBeNull();
		expect(parseStatusReport(`state=done:app=${"a".repeat(33)}`)).toBeNull();
	});

	test("removes bidirectional overrides and invisible formatting characters from labels", () => {
		expect(parseStatusReport(`state=done:msg=${b64("ok\u202Etxt.exe\u200B\u2066")}`)).toMatchObject({ message: "oktxt.exe" });
		expect(parseStatusReport(`state=done:msg=${b64("\u200B")}`)).toMatchObject({ message: null });
	});

	test("checks the record path", () => {
		expect(parseStatusReport("state=working:id=agent/sub-1")).toMatchObject({ id: "agent/sub-1" });
		expect(parseStatusReport("state=working:id=a//b")).toBeNull();
		expect(parseStatusReport(`state=working:id=${"a".repeat(33)}`)).toBeNull();
		expect(parseStatusReport(`state=working:id=${Array(9).fill("a").join("/")}`)).toBeNull();
	});
});

describe("records", () => {
	const event = (pairs: string): StatusEvent => ({ type: "report", report: parseStatusReport(pairs) });

	test("each report replaces the record, and says whether any record changed", () => {
		const records = createStatusRecords();
		expect(records.apply(event("state=working:progress=10"))).toBe(true);
		expect(records.apply(event("state=working:progress=10"))).toBe(false);
		expect(records.apply(event("state=blocked:kind=permission"))).toBe(true);
		expect(records.root()).toMatchObject({ state: "blocked", kind: "permission", progress: null });
		expect(records.apply(event("state=working:id=sub"))).toBe(true);
		// A child repeating itself changes nothing, so a stream of the same report sends nothing to the window.
		expect(records.apply(event("state=working:id=sub"))).toBe(false);
		expect(records.apply(event("state=working:id=sub:progress=20"))).toBe(true);
		expect(records.size()).toBe(2);
	});

	test("children come ordered by path, a record right before its descendants, and the root apart", () => {
		const records = createStatusRecords();
		records.apply(event("state=working"));
		records.apply(event("state=working:id=b"));
		records.apply(event("state=done:id=a-c"));
		records.apply(event(`state=blocked:kind=question:id=a/b:title=${Buffer.from("Tests").toString("base64")}`));
		records.apply(event("state=working:id=a"));
		expect(records.children().map(child => child.id)).toEqual(["a", "a/b", "a-c", "b"]);
		expect(records.children()[1]).toEqual({ id: "a/b", state: "blocked", kind: "question", progress: null, app: null, title: "Tests", message: null });
		expect(records.root()?.state).toBe("working");
	});

	test("clearing, a prompt, and a reset say whether anything went", () => {
		const records = createStatusRecords();
		expect(records.apply(event("state=clear:id=none"))).toBe(false);
		records.apply(event("state=done:id=a"));
		expect(records.apply({ type: "prompt" })).toBe(false);
		expect(records.exited()).toBe(false);
		records.apply(event("state=working:id=a/b"));
		expect(records.apply({ type: "prompt" })).toBe(true);
		expect(records.children().map(child => child.id)).toEqual(["a"]);
		expect(records.apply(event("state=clear:id=a"))).toBe(true);
		expect(records.apply({ type: "reset" })).toBe(false);
		records.apply(event("state=idle:id=x"));
		expect(records.apply({ type: "reset" })).toBe(true);
	});

	test("a dropped report changes nothing", () => {
		const records = createStatusRecords();
		records.apply(event("state=done"));
		expect(records.apply({ type: "report", report: null })).toBe(false);
		expect(records.root()?.state).toBe("done");
	});

	test("a new prompt or an exit ends working and blocked, and keeps done and error", () => {
		for (const end of ["prompt", "exit"] as const) {
			const records = createStatusRecords();
			const finish = () => end === "prompt" ? records.apply({ type: "prompt" }) : records.exited();
			records.apply(event("state=working"));
			expect(finish()).toBe(true);
			expect(records.root()).toBeNull();
			records.apply(event("state=done"));
			expect(finish()).toBe(false);
			expect(records.root()?.state).toBe("done");
			records.apply(event("state=error"));
			finish();
			expect(records.root()?.state).toBe("error");
		}
	});

	test("clear removes a record and its children, or every record without an id", () => {
		const records = createStatusRecords();
		records.apply(event("state=working"));
		records.apply(event("state=working:id=a"));
		records.apply(event("state=working:id=a/b"));
		records.apply(event("state=working:id=ab"));
		records.apply(event("state=clear:id=a"));
		expect(records.size()).toBe(2);
		records.apply(event("state=clear"));
		expect(records.size()).toBe(0);
	});

	test("a new prompt also ends idle", () => {
		const records = createStatusRecords();
		records.apply(event("state=idle"));
		expect(records.apply({ type: "prompt" })).toBe(true);
		expect(records.root()).toBeNull();
	});

	test("a root record pushed out by 256 newer ones is gone, and that is a change", () => {
		const records = createStatusRecords();
		records.apply(event("state=working"));
		let changed = false;
		for (let index = 0; index < 256; index += 1) changed = records.apply(event(`state=idle:id=r${index}`)) || changed;
		expect(changed).toBe(true);
		expect(records.root()).toBeNull();
	});

	test("a full reset clears every record", () => {
		const records = createStatusRecords();
		records.apply(event("state=done"));
		expect(records.apply({ type: "reset" })).toBe(true);
		expect(records.root()).toBeNull();
	});

	test("keeps 256 records, and drops the one updated longest ago", () => {
		const records = createStatusRecords();
		records.apply(event("state=working"));
		for (let index = 0; index < 255; index += 1) records.apply(event(`state=idle:id=r${index}`));
		records.apply(event("state=working:progress=5"));
		records.apply(event("state=idle:id=extra"));
		expect(records.size()).toBe(256);
		expect(records.root()?.progress).toBe(5);
	});
});
