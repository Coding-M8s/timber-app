import { describe, expect, test } from "bun:test";
import { agentById } from "../src/shared/agent-registry";
import { parseStatusReport } from "../src/shared/program-status";
import { type AlertAction, type AlertSettings, createAlertRunner } from "../src/shared/status-notices";
import { defaultStateSounds } from "../src/shared/sound-setting";
import type { TerminalSession } from "../src/shared/terminal";
import {
	STATUS_HOOK_SCRIPT, describeStates, hookCommand, GEMINI_HOOK_NAME, geminiCommand, hookedAgent, isOwnCommand, parseStatusLine, planCursorHooks, planGeminiSettings, reportedStates, statusFromLine, stripJsonComments,
} from "../src/shared/status-hooks";

const SCRIPT = "/home/you/.config/timber-app/status-hook";
const cursor = agentById("cursor");
if (cursor.status.source !== "hook" || cursor.status.hook.format !== "cursor-hooks") throw new Error("Cursor CLI has entries in the registry");
const HOOK = cursor.status.hook;
const gemini = agentById("gemini");
if (gemini.status.source !== "hook" || gemini.status.hook.format === "opencode-plugin") throw new Error("Gemini CLI has entries in the registry");
const GEMINI = gemini.status.hook;

/**
 * A shared hooks file shaped as another tool writes one: eight events, each
 * entry a command and a timeout, and `version` last. The commands are made
 * up.
 */
const SHARED = `${JSON.stringify({
	hooks: Object.fromEntries(["beforeSubmitPrompt", "stop", "preToolUse", "postToolUse", "postToolUseFailure", "beforeShellExecution", "beforeMCPExecution", "afterAgentResponse"]
		.map(event => [event, [{ command: `/bin/sh -c 'other-tool ${event}'`, timeout: 10 }]])),
	version: 1,
}, null, 2)}\n`;

const AWAY = { visible: true, focused: true, selected: { repository: "/work/timber", worktree: "/work/timber", id: "timber" }, session: null };
const ALL: AlertSettings = { notify: true, notifyStates: ["needs-you", "done", "error", "crashed"], sounds: defaultStateSounds() };
const SESSION: TerminalSession = {
	id: "s", kind: "agent", name: "Cursor CLI", repository: "/work/timber", worktree: "w", path: "/work/timber-worktrees/feat-login", shell: "/usr/local/bin/cursor-agent",
	command: "cursor-agent", state: { kind: "running" }, status: null, children: [], program: "cursor",
};

const own = (event: string) => ({ command: `'${SCRIPT}' cursor ${event}`, timeout: 5 });

/** The file without the app's entries, as parsed: what must be the same after any write. */
function withoutOwn(text: string): unknown {
	const parsed = JSON.parse(text) as { hooks?: Record<string, { command?: string }[]> };
	const hooks = Object.fromEntries(Object.entries(parsed.hooks ?? {})
		.map(([event, list]) => [event, list.filter(entry => !isOwnCommand(entry.command, SCRIPT))])
		.filter(([, list]) => (list as unknown[]).length > 0));
	return { ...parsed, hooks };
}

describe("a line a hook appended", () => {
	test("is read as its agent and event, as OSC 7501 pairs are", () => {
		expect(parseStatusLine("agent=cursor:event=stop")).toEqual({ agent: "cursor", event: "stop" });
		expect(parseStatusLine(" event = stop : agent = cursor : junk")).toEqual({ agent: "cursor", event: "stop" });
		expect(parseStatusLine("agent=cursor:event=stop:event=sessionStart")).toEqual({ agent: "cursor", event: "sessionStart" });
	});

	test("without both, with characters a name cannot hold, or too long, is nothing", () => {
		expect(parseStatusLine("agent=cursor")).toBeNull();
		expect(parseStatusLine("event=stop")).toBeNull();
		expect(parseStatusLine("agent=cur sor:event=stop")).toBeNull();
		expect(parseStatusLine("agent=cursor:event=$(rm)")).toBeNull();
		expect(parseStatusLine(`agent=cursor:event=${"x".repeat(33)}`)).toBeNull();
		expect(parseStatusLine(`agent=cursor:event=stop:pad=${"x".repeat(200)}`)).toBeNull();
	});

	test("becomes the state the registry gives the event, with the agent's app and nothing else", () => {
		expect(statusFromLine({ agent: "cursor", event: "sessionStart" })).toEqual({ state: "idle", kind: null, progress: null, app: "cursor", title: null, message: null });
		expect(statusFromLine({ agent: "cursor", event: "beforeSubmitPrompt" })?.state).toBe("working");
		expect(statusFromLine({ agent: "cursor", event: "stop" })?.state).toBe("done");
	});

	test("of an event the registry does not map, or an agent with no hook, is nothing", () => {
		expect(statusFromLine({ agent: "cursor", event: "preToolUse" })).toBeNull();
		// Cursor runs it for every shell command before it decides whether to ask, so it never means needs you (issue 352).
		expect(statusFromLine({ agent: "cursor", event: "beforeShellExecution" })).toBeNull();
		expect(statusFromLine({ agent: "claude", event: "stop" })).toBeNull();
		expect(statusFromLine({ agent: "someone", event: "stop" })).toBeNull();
		expect(hookedAgent("codex")).toBeNull();
		// GitHub Copilot CLI reports through OSC 7501 itself (issue 354), so it has no hook and no line of its name is read.
		expect(hookedAgent("copilot")).toBeNull();
		expect(statusFromLine({ agent: "copilot", event: "agentStop" })).toBeNull();
	});

	test("a hooked session raises the same alerts as one that reports through its stream", () => {
		const stream = (payload: string) => {
			const report = parseStatusReport(payload);
			if (report === null || report.state === "clear") throw new Error("a report");
			const { id: _id, ...status } = report;
			return status;
		};
		const run = (statuses: TerminalSession["status"][]) => {
			const acted: AlertAction[] = [];
			const runner = createAlertRunner({ attention: () => AWAY, settings: () => ALL, act: action => acted.push(action), now: () => 0, setTimer: () => null, clearTimer: () => {} });
			for (const status of statuses) runner.changed({ id: "s", session: { ...SESSION, status } });
			runner.stop();
			return acted;
		};
		const hooked = run(["sessionStart", "beforeSubmitPrompt", "stop"].map(event => statusFromLine({ agent: "cursor", event })));
		expect(hooked).toEqual(run([stream("state=idle:app=cursor"), stream("state=working:app=cursor"), stream("state=done:app=cursor")]));
		expect(hooked[0]).toMatchObject({ kind: "show", notice: { title: "Cursor CLI is done" } });
		// Esc or Ctrl+C runs `stop` twice (issue 352): one alert, as for a turn that finished.
		expect(run(["sessionStart", "beforeSubmitPrompt", "stop", "stop"].map(event => statusFromLine({ agent: "cursor", event })))).toEqual(hooked);
		// OpenCode's plugin reports needs you as well.
		const opencode = run(["busy", "permission.asked", "answered", "idle"].map(event => statusFromLine({ agent: "opencode", event })));
		expect(opencode).toEqual(run([stream("state=working:app=opencode"), stream("state=blocked:app=opencode"), stream("state=working:app=opencode"), stream("state=done:app=opencode")]));
		// The notices name the session, as for any agent.
		expect(opencode.filter(action => action.kind === "show").map(action => action.kind === "show" && action.notice.title)).toEqual([`${SESSION.name} needs you`, `${SESSION.name} is done`]);
	});

	test("Gemini CLI's events give idle, working, needs you, working again after an approved tool, and done, with the same alerts as from its stream", () => {
		const events = ["SessionStart", "BeforeAgent", "Notification", "AfterTool", "AfterAgent"];
		expect(events.map(event => statusFromLine({ agent: "gemini", event })?.state)).toEqual(["idle", "working", "blocked", "working", "done"]);
		expect(statusFromLine({ agent: "gemini", event: "BeforeTool" })).toBeNull();
		const run = (statuses: TerminalSession["status"][]) => {
			const acted: AlertAction[] = [];
			const runner = createAlertRunner({ attention: () => AWAY, settings: () => ALL, act: action => acted.push(action), now: () => 0, setTimer: () => null, clearTimer: () => {} });
			for (const status of statuses) runner.changed({ id: "s", session: { ...SESSION, name: "Gemini CLI", status } });
			runner.stop();
			return acted;
		};
		const hooked = run(events.map(event => statusFromLine({ agent: "gemini", event })));
		const streamed = run(["idle", "working", "blocked", "working", "done"].map(state => {
			const report = parseStatusReport(`state=${state}:app=gemini`);
			if (report === null || report.state === "clear") throw new Error("a report");
			const { id: _id, ...status } = report;
			return status;
		}));
		expect(hooked).toEqual(streamed);
		expect(hooked.filter(action => action.kind === "show").map(action => action.kind === "show" ? action.notice.title : "")).toEqual(["Gemini CLI needs you", "Gemini CLI is done"]);
	});

	test("GitHub Copilot CLI's own reports raise the same alerts as Claude Code's do, and a turn stopped with Ctrl+C none", () => {
		const run = (app: string, reports: string[]) => {
			const acted: AlertAction[] = [];
			const runner = createAlertRunner({ attention: () => AWAY, settings: () => ALL, act: action => acted.push(action), now: () => 0, setTimer: () => null, clearTimer: () => {} });
			for (const text of reports) {
				const report = parseStatusReport(`${text}:app=${app}`);
				if (report === null || report.state === "clear") throw new Error("a report");
				const { id: _id, ...status } = report;
				runner.changed({ id: "s", session: { ...SESSION, name: "The agent", program: "copilot", status } });
			}
			runner.stop();
			return acted;
		};
		const titles = (acted: AlertAction[]) => acted.filter(action => action.kind === "show").map(action => action.kind === "show" ? action.notice.title : "");
		// As 1.0.116 reported them: a shell command approved, then a question answered.
		const turn = ["state=idle", "state=working", "state=blocked:kind=permission", "state=working", "state=done"];
		const asked = ["state=working", "state=blocked:kind=question", "state=working", "state=done"];
		for (const reports of [turn, asked]) {
			expect(run("copilot", reports)).toEqual(run("claude-code", reports));
			expect(titles(run("copilot", reports))).toEqual(["The agent needs you", "The agent is done"]);
		}
		expect(titles(run("copilot", ["state=working", "state=idle"]))).toEqual([]);
		// Esc at an approval: the needs you it raised, and no done.
		expect(titles(run("copilot", ["state=working", "state=blocked:kind=permission", "state=working", "state=idle"]))).toEqual(["The agent needs you"]);
		// A request the model refused.
		expect(titles(run("copilot", ["state=working", "state=error"]))).toEqual(titles(run("claude-code", ["state=working", "state=error"])));
		expect(titles(run("copilot", ["state=working", "state=error"]))).toHaveLength(1);
	});
});

describe("the states an agent reports", () => {
	test("come from the hook's events, or from the registry for an agent that reports itself", () => {
		expect(reportedStates(cursor)).toEqual(["working", "done"]);
		expect(reportedStates(agentById("claude"))).toEqual(["working", "blocked", "done"]);
		expect(reportedStates(agentById("codex"))).toEqual(["working", "done"]);
		expect(reportedStates(agentById("copilot"))).toEqual(["working", "blocked", "done"]);
		expect(reportedStates(gemini)).toEqual(["working", "blocked", "done"]);
		expect(reportedStates(agentById("opencode"))).toEqual(["working", "blocked", "done"]);
	});

	test("are said in words", () => {
		expect(describeStates(["working", "blocked", "done"])).toBe("working, needs you, and done");
		expect(describeStates(["working", "done"])).toBe("working and done");
		expect(describeStates(["done"])).toBe("done");
		expect(describeStates([])).toBe("");
	});
});

describe("the script and its command", () => {
	test("the script does nothing outside the app's sessions, prints nothing, and exits 0", () => {
		expect(STATUS_HOOK_SCRIPT.startsWith("#!/bin/sh\n")).toBe(true);
		expect(STATUS_HOOK_SCRIPT).toContain('[ -n "$TIMBER_APP_STATUS" ] || exit 0');
		expect(STATUS_HOOK_SCRIPT.trimEnd().endsWith("exit 0")).toBe(true);
	});

	test("the command quotes the script's path, and a path with a quote gets none", () => {
		expect(hookCommand("/home/a b/status-hook", "cursor", "stop")).toBe("'/home/a b/status-hook' cursor stop");
		expect(hookCommand("/home/o'neil/status-hook", "cursor", "stop")).toBeNull();
	});

	test("an entry is the app's only when its command starts with the quoted path and a space", () => {
		expect(isOwnCommand(`'${SCRIPT}' cursor stop`, SCRIPT)).toBe(true);
		expect(isOwnCommand(`/bin/sh -c '${SCRIPT} cursor stop'`, SCRIPT)).toBe(false);
		expect(isOwnCommand(`'${SCRIPT}-other' cursor stop`, SCRIPT)).toBe(false);
		expect(isOwnCommand(undefined, SCRIPT)).toBe(false);
	});
});

describe("planning Cursor's hooks.json", () => {
	test("with no file: off, and turning on makes the whole file, shown as it is written", () => {
		const plan = planCursorHooks(null, HOOK, SCRIPT, "cursor");
		expect(plan.state).toEqual({ kind: "off" });
		expect(JSON.parse(plan.installed!)).toEqual({ version: 1, hooks: { sessionStart: [own("sessionStart")], beforeSubmitPrompt: [own("beforeSubmitPrompt")], stop: [own("stop")] } });
		expect(plan.entries).toBe(plan.installed!);
	});

	test("in a shared file: the app's entries go after the others, and everything else parses the same", () => {
		const plan = planCursorHooks(SHARED, HOOK, SCRIPT, "cursor");
		expect(plan.state).toEqual({ kind: "off" });
		const after = JSON.parse(plan.installed!) as { hooks: Record<string, unknown[]> };
		expect(withoutOwn(plan.installed!)).toEqual(JSON.parse(SHARED));
		expect(after.hooks.stop).toEqual([{ command: "/bin/sh -c 'other-tool stop'", timeout: 10 }, own("stop")]);
		expect(after.hooks.sessionStart).toEqual([own("sessionStart")]);
		// Only the app's entries are shown to add.
		expect(JSON.parse(plan.entries)).toEqual({ hooks: { sessionStart: [own("sessionStart")], beforeSubmitPrompt: [own("beforeSubmitPrompt")], stop: [own("stop")] } });
	});

	test("on once written; removing takes out only the app's entries and lists that held only them", () => {
		const installed = planCursorHooks(SHARED, HOOK, SCRIPT, "cursor").installed!;
		const plan = planCursorHooks(installed, HOOK, SCRIPT, "cursor");
		expect(plan.state).toEqual({ kind: "on" });
		expect(plan.installed).toBeNull();
		expect(plan.present).toHaveLength(3);
		expect(JSON.parse(plan.removed!)).toEqual(JSON.parse(SHARED));
	});

	test("removing from a file that held only the app's entries leaves nothing, so the file goes", () => {
		const installed = planCursorHooks(null, HOOK, SCRIPT, "cursor").installed!;
		expect(planCursorHooks(installed, HOOK, SCRIPT, "cursor").removed).toBeNull();
		const withOther = JSON.stringify({ ...JSON.parse(installed), other: true });
		expect(JSON.parse(planCursorHooks(withOther, HOOK, SCRIPT, "cursor").removed!)).toEqual({ version: 1, hooks: {}, other: true });
	});

	test("an empty list the person kept stays", () => {
		const text = JSON.stringify({ version: 1, hooks: { afterFileEdit: [] } });
		const installed = planCursorHooks(text, HOOK, SCRIPT, "cursor").installed!;
		expect(JSON.parse(planCursorHooks(installed, HOOK, SCRIPT, "cursor").removed!)).toEqual({ version: 1, hooks: { afterFileEdit: [] } });
	});

	test("changed when an entry is not as the app writes it, one is missing, or one is in another event", () => {
		const installed = JSON.parse(planCursorHooks(null, HOOK, SCRIPT, "cursor").installed!) as { hooks: Record<string, { command: string; timeout: number }[]> };
		const edited = structuredClone(installed);
		edited.hooks.stop![0]!.timeout = 30;
		expect(planCursorHooks(JSON.stringify(edited), HOOK, SCRIPT, "cursor").state).toEqual({ kind: "changed", reason: "An entry of the app's is not as the app writes it." });
		const missing = structuredClone(installed);
		delete missing.hooks.stop;
		expect(planCursorHooks(JSON.stringify(missing), HOOK, SCRIPT, "cursor").state).toEqual({ kind: "changed", reason: "The entries for stop are missing." });
		const moved = structuredClone(installed);
		moved.hooks.preToolUse = [own("preToolUse")];
		expect(planCursorHooks(JSON.stringify(moved), HOOK, SCRIPT, "cursor").state.kind).toBe("changed");
		const twice = structuredClone(installed);
		twice.hooks.stop!.push(own("stop"));
		expect(planCursorHooks(JSON.stringify(twice), HOOK, SCRIPT, "cursor").state.kind).toBe("changed");
		// Changed is never rewritten: there is nothing to turn on, only Remove.
		expect(planCursorHooks(JSON.stringify(edited), HOOK, SCRIPT, "cursor").installed).toBeNull();
		expect(planCursorHooks(JSON.stringify(edited), HOOK, SCRIPT, "cursor").removed).toBeNull();
	});

	test("a file with comments is read, but never written", () => {
		const text = `{\n  // mine\n  "version": 1, /* note */\n  "hooks": { "stop": [{ "command": "say \\"// not a comment\\"" }] }\n}\n`;
		const plan = planCursorHooks(text, HOOK, SCRIPT, "cursor");
		expect(plan.comments).toBe(true);
		expect(plan.state).toEqual({ kind: "off" });
		expect(plan.installed).toBeNull();
		expect(JSON.parse(stripJsonComments(text)).hooks.stop[0].command).toBe('say "// not a comment"');
	});

	test("a value a rewrite would change, a big number or a __proto__ key, is never written", () => {
		const big = planCursorHooks('{"version":1,"hooks":{},"id":12345678901234567890}', HOOK, SCRIPT, "cursor");
		expect(big).toMatchObject({ unsafe: true, installed: null });
		const installed = planCursorHooks(null, HOOK, SCRIPT, "cursor").installed!;
		const proto = `{"version":1,"hooks":${JSON.stringify(JSON.parse(installed).hooks).slice(0, -1)},"__proto__":[{"command":"mine"}]}}`;
		const plan = planCursorHooks(proto, HOOK, SCRIPT, "cursor");
		expect(plan).toMatchObject({ unsafe: true, removed: undefined });
		expect(plan.state).toEqual({ kind: "on" });
		expect(planCursorHooks('{"version":1,"hooks":{},"n":0.1,"m":-3}', HOOK, SCRIPT, "cursor").unsafe).toBe(false);
		const deep = `{"version":1,"hooks":{},"x":${"[".repeat(200_000)}${"]".repeat(200_000)}}`;
		let state: unknown;
		try {
			state = planCursorHooks(deep, HOOK, SCRIPT, "cursor").state;
		} catch (error) {
			state = { thrown: String(error) };
		}
		// JSON.parse may refuse it first; either way it is broken, never a throw.
		expect((state as { kind?: string }).kind).toBe("broken");
	});

	test("broken when it is not JSON, not an object, of another version, or not the shape Cursor reads", () => {
		const broken = (text: string) => planCursorHooks(text, HOOK, SCRIPT, "cursor").state;
		expect(broken("{ nope")).toEqual({ kind: "broken", reason: "It is not valid JSON." });
		expect(broken("[]")).toEqual({ kind: "broken", reason: "It does not hold a JSON object." });
		expect(broken('{"version":2}')).toEqual({ kind: "broken", reason: "Its version is not 1, the one the app knows." });
		expect(broken('{"hooks":[]}')).toEqual({ kind: "broken", reason: "Its \"hooks\" is not an object." });
		expect(broken('{"hooks":{"stop":{}}}')).toEqual({ kind: "broken", reason: "Its \"stop\" is not a list." });
		for (const text of ["{ nope", "[]", '{"version":2}']) {
			const plan = planCursorHooks(text, HOOK, SCRIPT, "cursor");
			expect(plan.installed).toBeNull();
			expect(plan.removed).toBeUndefined();
		}
	});
});

describe("planning Gemini CLI's settings.json", () => {
	const own = (event: string, matcher?: string) => ({
		...(matcher === undefined ? {} : { matcher }),
		hooks: [{ type: "command", name: GEMINI_HOOK_NAME, command: `'${SCRIPT}' gemini ${event} 2>/dev/null || true`, timeout: 5000 }],
	});
	const ALL_OWN = {
		SessionStart: [own("SessionStart")], BeforeAgent: [own("BeforeAgent")], Notification: [own("Notification", "ToolPermission")],
		AfterTool: [own("AfterTool")], AfterAgent: [own("AfterAgent")],
	};
	/** Settings as a person keeps them: other keys, another tool's hooks, and Gemini's own hook settings inside `hooks`. The commands are made up. */
	const SETTINGS = {
		security: { auth: { selectedType: "oauth-personal" } },
		hooksConfig: { enabled: true },
		hooks: {
			disabled: ["other-tool-log"],
			BeforeAgent: [{ hooks: [{ type: "command", name: "other-tool-log", command: "other-tool log", timeout: 2000 }] }],
			BeforeTool: [{ matcher: "run_shell_command", sequential: true, hooks: [{ type: "command", command: "other-tool check" }] }],
		},
		ui: { theme: "Default" },
	};

	test("the command ends so that it prints nothing and exits 0 whatever the script does, and starts as the app's commands do", () => {
		expect(geminiCommand(SCRIPT, "gemini", "AfterAgent")).toBe(`'${SCRIPT}' gemini AfterAgent 2>/dev/null || true`);
		expect(isOwnCommand(geminiCommand(SCRIPT, "gemini", "AfterAgent"), SCRIPT)).toBe(true);
		expect(geminiCommand("/home/it's/status-hook", "gemini", "AfterAgent")).toBeNull();
	});

	// The hook is not offered on Windows, which has no `sh`.
	test.skipIf(process.platform === "win32")("a missing script makes the command print nothing and exit 0 in sh and bash", () => {
		for (const shell of ["/bin/sh", "/bin/bash"]) {
			const ran = Bun.spawnSync([shell, "-c", geminiCommand("/nowhere/status-hook", "gemini", "BeforeAgent")!]);
			expect(ran.exitCode).toBe(0);
			expect(ran.stdout.length + ran.stderr.length).toBe(0);
		}
	});

	test("with no file: off, and turning on makes a file of only the app's entries, shown as it is written", () => {
		const plan = planGeminiSettings(null, GEMINI, SCRIPT, "gemini");
		expect(plan.state).toEqual({ kind: "off" });
		expect(JSON.parse(plan.installed!)).toEqual({ hooks: ALL_OWN });
		expect(plan.entries).toBe(plan.installed!);
		expect(planGeminiSettings(plan.installed, GEMINI, SCRIPT, "gemini").state).toEqual({ kind: "on" });
		expect(planGeminiSettings(plan.installed, GEMINI, SCRIPT, "gemini").removed).toBeNull();
	});

	test("in shared settings, turning on adds after what is there, and removing gives back what was there", () => {
		const text = JSON.stringify(SETTINGS, null, 2);
		const plan = planGeminiSettings(text, GEMINI, SCRIPT, "gemini");
		expect(plan.state).toEqual({ kind: "off" });
		expect(plan.present).toEqual([]);
		const installed = JSON.parse(plan.installed!);
		expect(installed).toEqual({ ...SETTINGS, hooks: { ...SETTINGS.hooks, ...ALL_OWN, BeforeAgent: [...SETTINGS.hooks.BeforeAgent, own("BeforeAgent")] } });
		const on = planGeminiSettings(plan.installed, GEMINI, SCRIPT, "gemini");
		expect(on.state).toEqual({ kind: "on" });
		// In the file's order: BeforeAgent was there first.
		expect(on.present.toSorted()).toEqual(Object.entries(ALL_OWN).map(([event, [definition]]) => `"${event}": ${JSON.stringify(definition)}`).toSorted());
		expect(JSON.parse(on.removed!)).toEqual(SETTINGS);
	});

	test("settings with no hooks get them back as they were: `hooks` goes when only the app's were in it", () => {
		const text = JSON.stringify({ ui: { theme: "Default" } });
		const installed = planGeminiSettings(text, GEMINI, SCRIPT, "gemini").installed!;
		expect(JSON.parse(planGeminiSettings(installed, GEMINI, SCRIPT, "gemini").removed!)).toEqual({ ui: { theme: "Default" } });
		// Gemini CLI's own hook settings keep `hooks`.
		const withSettings = planGeminiSettings(JSON.stringify({ hooks: { enabled: true } }), GEMINI, SCRIPT, "gemini").installed!;
		expect(JSON.parse(planGeminiSettings(withSettings, GEMINI, SCRIPT, "gemini").removed!)).toEqual({ hooks: { enabled: true } });
	});

	test("changed when an entry is edited, missing, in another event, twice, or shares a definition; neither on nor off is written then", () => {
		const with_ = (hooks: object) => planGeminiSettings(JSON.stringify({ hooks: { ...ALL_OWN, ...hooks } }), GEMINI, SCRIPT, "gemini");
		const longer = own("AfterAgent");
		longer.hooks[0]!.timeout = 60000;
		expect(with_({ AfterAgent: [longer] }).state).toEqual({ kind: "changed", reason: "An entry of the app's is not as the app writes it." });
		const { AfterTool: _gone, ...missing } = ALL_OWN;
		expect(planGeminiSettings(JSON.stringify({ hooks: missing }), GEMINI, SCRIPT, "gemini").state).toEqual({ kind: "changed", reason: "The entries for AfterTool are missing." });
		expect(with_({ BeforeTool: [own("AfterTool")] }).state.kind).toBe("changed");
		expect(with_({ AfterAgent: [own("AfterAgent"), own("AfterAgent")] }).state.kind).toBe("changed");
		const shared = { hooks: [...own("AfterAgent").hooks, { type: "command", command: "other-tool done" }] };
		const plan = with_({ AfterAgent: [shared] });
		expect(plan.state.kind).toBe("changed");
		expect(plan.installed).toBeNull();
		// Remove takes out only the app's command: the other tool's stays in its definition.
		expect(JSON.parse(plan.removed!)).toEqual({ hooks: { AfterAgent: [{ hooks: [{ type: "command", command: "other-tool done" }] }] } });
	});

	test("comments, or a value a rewrite would change, are read but never written", () => {
		const commented = `// mine\n${JSON.stringify(SETTINGS)}`;
		const plan = planGeminiSettings(commented, GEMINI, SCRIPT, "gemini");
		expect(plan).toMatchObject({ state: { kind: "off" }, comments: true, installed: null });
		const big = planGeminiSettings('{"n":12345678901234567890}', GEMINI, SCRIPT, "gemini");
		expect(big).toMatchObject({ unsafe: true, installed: null });
	});

	test("broken when it is not JSON, not an object, or not the shape Gemini CLI reads; its own hook settings are not events", () => {
		const broken = (text: string) => planGeminiSettings(text, GEMINI, SCRIPT, "gemini").state;
		expect(broken("{ nope")).toEqual({ kind: "broken", reason: "It is not valid JSON." });
		expect(broken("[]")).toEqual({ kind: "broken", reason: "It does not hold a JSON object." });
		expect(broken('{"hooks":[]}')).toEqual({ kind: "broken", reason: "Its \"hooks\" is not an object." });
		expect(broken('{"hooks":{"AfterAgent":{}}}')).toEqual({ kind: "broken", reason: "Its \"AfterAgent\" is not a list." });
		expect(broken('{"hooks":{"AfterAgent":[{"command":"x"}]}}')).toEqual({ kind: "broken", reason: "Its \"AfterAgent\" holds an entry without a \"hooks\" list." });
		expect(broken('{"hooks":{"enabled":true,"disabled":["a"],"notifications":false}}')).toEqual({ kind: "off" });
	});
});
