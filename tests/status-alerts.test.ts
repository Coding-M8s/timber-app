import { describe, expect, test } from "bun:test";
import { type AlertAction, type AlertSettings, createAlertRunner, createStatusAlerts, onScreen } from "../src/shared/status-notices";
import type { TerminalSession } from "../src/shared/terminal";

const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const away = { visible: true, focused: true, selected: { repository: TIMBER, worktree: TIMBER } };
const here = { visible: true, focused: true, selected: { repository: TIMBER, worktree: FEATURE } };
const all: AlertSettings = { notify: true, notifyStates: ["needs-you", "done", "error", "crashed"], soundStates: [] };

const session = (change: Partial<TerminalSession> = {}): TerminalSession => ({
	id: "s", kind: "agent", name: "Codex", repository: TIMBER, worktree: "w", path: FEATURE, shell: "/usr/local/bin/codex", command: "codex",
	state: { kind: "running" }, status: null, children: [], ...change,
});
const status = (state: "idle" | "working" | "done" | "blocked" | "error", more: Partial<NonNullable<TerminalSession["status"]>> = {}) =>
	({ state, kind: null, progress: null, app: null, title: null, message: null, ...more });
const change = (more: Partial<TerminalSession> = {}, id = "s") => ({ id, session: { ...session(more), id } });
const working = change({ status: status("working") });
const done = change({ status: status("done") });
const show = (title: string, body: string, sound = false, id = "s"): AlertAction => ({ kind: "show", notice: { session: id, title, body }, sound });
const withdraw = (id = "s"): AlertAction => ({ kind: "withdraw", session: id });

describe("which statuses are told about", () => {
	test("Needs you, Done, Error, and crashed, in a worktree not on screen, built from what the session says", () => {
		const alerts = createStatusAlerts(1000);
		expect(alerts.changed(change(), away, all, 0)).toEqual([]);
		expect(alerts.changed(working, away, all, 0)).toEqual([]);
		expect(alerts.changed(change({ status: status("blocked", { kind: "permission", message: "approve Write: src/a.ts" }) }), away, all, 0))
			.toEqual([show("Codex needs you", "In feat-github-issue-lookup: approve Write: src/a.ts")]);
		// A new status replaces the notification on screen, so nothing is withdrawn first.
		expect(alerts.changed(done, away, all, 2000)).toEqual([show("Codex is done", "In feat-github-issue-lookup: Done")]);
		expect(alerts.changed(change({ status: status("error") }), away, all, 4000)).toEqual([show("Codex reported an error", "In feat-github-issue-lookup: Error")]);
		expect(alerts.changed(change({ state: { kind: "exited", exitCode: 1, signal: null } }), away, all, 6000))
			.toEqual([show("Codex crashed", "In feat-github-issue-lookup: Crashed, exit 1")]);
	});

	test("none for the worktree on screen in a focused window, but one when the window is hidden or not focused", () => {
		expect(onScreen(session(), here)).toBe(true);
		expect(onScreen(session(), { ...here, focused: false })).toBe(false);
		expect(onScreen(session(), { ...here, visible: false })).toBe(false);
		expect(onScreen(session(), { ...here, selected: { repository: "/other", worktree: FEATURE } })).toBe(false);
		const alerts = createStatusAlerts(0);
		alerts.changed(working, here, all, 0);
		expect(alerts.changed(done, here, all, 0)).toEqual([]);
		alerts.changed(working, here, all, 0);
		expect(alerts.changed(done, { ...here, focused: false }, all, 0)).toHaveLength(1);
	});

	test("none when turned off, none for the same state again, none for a stopped agent, and none for a plain shell", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(working, away, all, 0);
		expect(alerts.changed(done, away, { ...all, notify: false }, 0)).toEqual([]);
		expect(alerts.changed(done, away, all, 0)).toEqual([]);
		expect(alerts.changed(change({ state: { kind: "exited", exitCode: 0, signal: null } }), away, all, 0)).toEqual([]);
		const shells = createStatusAlerts(0);
		shells.changed(change({ kind: "terminal" }), away, all, 0);
		expect(shells.changed(change({ kind: "terminal", state: { kind: "exited", exitCode: 1, signal: null } }), away, all, 0)).toEqual([]);
	});

	test("only the statuses chosen in Settings notify", () => {
		const alerts = createStatusAlerts(0);
		const some: AlertSettings = { ...all, notifyStates: ["needs-you"] };
		alerts.changed(working, away, some, 0);
		expect(alerts.changed(done, away, some, 0)).toEqual([]);
		expect(alerts.changed(change({ status: status("blocked") }), away, some, 0)).toEqual([show("Codex needs you", "In feat-github-issue-lookup: Needs you")]);
	});
});

describe("one notification per session, withdrawn once it no longer holds", () => {
	test("withdrawn when the status moves on to one that is not told about", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(working, away, all, 0);
		alerts.changed(done, away, all, 0);
		expect(alerts.changed(working, away, all, 1)).toEqual([withdraw()]);
		expect(alerts.changed(change({ status: status("idle") }), away, all, 2)).toEqual([]);
	});

	test("withdrawn when its session closes, and when its worktree comes on screen", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(working, away, all, 0);
		alerts.changed(done, away, all, 0);
		expect(alerts.changed({ id: "s", session: null }, away, all, 1)).toEqual([withdraw()]);
		alerts.changed(working, away, all, 2);
		alerts.changed(done, away, all, 3);
		expect(alerts.review(away, all, 4)).toEqual([]);
		expect(alerts.review(here, all, 5)).toEqual([withdraw()]);
		expect(alerts.review(here, all, 6)).toEqual([]);
	});

	test("withdrawn when Settings stop notifying for its status, and every one on clear", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(working, away, all, 0);
		alerts.changed(done, away, all, 0);
		alerts.changed(change({ status: status("working") }, "t"), away, all, 0);
		alerts.changed(change({ status: status("blocked") }, "t"), away, all, 0);
		expect(alerts.review(away, { ...all, notifyStates: ["needs-you"] }, 1)).toEqual([withdraw()]);
		expect(alerts.clear()).toEqual([withdraw("t")]);
	});
});

describe("the rate limit holds an alert back instead of dropping it", () => {
	test("each session and status at most once an interval; Needs you right after Done is still told", () => {
		const alerts = createStatusAlerts(10_000);
		alerts.changed(working, away, all, 0);
		expect(alerts.changed(done, away, all, 0)).toHaveLength(1);
		alerts.changed(working, away, all, 1000);
		expect(alerts.changed(done, away, all, 2000)).toEqual([]);
		expect(alerts.nextDue()).toBe(10_000);
		expect(alerts.changed(change({ status: status("blocked") }), away, all, 3000)).toHaveLength(1);
		// Done no longer holds, so nothing waits.
		expect(alerts.nextDue()).toBeNull();
		const other = createStatusAlerts(10_000);
		other.changed(change({ status: status("working") }, "t"), away, all, 0);
		expect(other.changed(change({ status: status("done") }, "t"), away, all, 0)).toHaveLength(1);
	});

	test("one held back goes out when its interval ends, with what the session says then", () => {
		const alerts = createStatusAlerts(10_000);
		alerts.changed(working, away, all, 0);
		alerts.changed(done, away, all, 0);
		alerts.changed(working, away, all, 1000);
		alerts.changed(change({ status: status("done", { message: "first" }) }), away, all, 2000);
		alerts.changed(change({ status: status("done", { message: "later" }) }), away, all, 3000);
		expect(alerts.review(away, all, 9999)).toEqual([]);
		expect(alerts.review(away, all, 10_000)).toEqual([show("Codex is done", "In feat-github-issue-lookup: later")]);
		expect(alerts.nextDue()).toBeNull();
	});

	test("one held back is dropped when its status moved on, its worktree came on screen, or Settings turned it off", () => {
		const hold = () => {
			const alerts = createStatusAlerts(10_000);
			alerts.changed(working, away, all, 0);
			alerts.changed(done, away, all, 0);
			alerts.changed(working, away, all, 1000);
			alerts.changed(done, away, all, 2000);
			return alerts;
		};
		const moved = hold();
		moved.changed(working, away, all, 3000);
		expect(moved.review(away, all, 10_000)).toEqual([]);
		const seen = hold();
		seen.review(here, all, 3000);
		expect(seen.review(away, all, 10_000)).toEqual([]);
		const off = hold();
		expect(off.review(away, { ...all, notifyStates: [] }, 10_000)).toEqual([]);
		expect(off.nextDue()).toBeNull();
	});
});

describe("sounds follow the same rules", () => {
	const soundy: AlertSettings = { ...all, soundStates: ["needs-you", "done"] };
	const quiet: AlertSettings = { notify: false, notifyStates: [], soundStates: ["done"] };

	test("with the notification of a chosen status, or alone when only the sound is chosen", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(working, away, soundy, 0);
		expect(alerts.changed(done, away, soundy, 0)).toEqual([show("Codex is done", "In feat-github-issue-lookup: Done", true)]);
		expect(alerts.changed(change({ status: status("error") }), away, soundy, 1)).toEqual([show("Codex reported an error", "In feat-github-issue-lookup: Error")]);
		const alone = createStatusAlerts(0);
		alone.changed(working, away, quiet, 0);
		expect(alone.changed(done, away, quiet, 0)).toEqual([{ kind: "sound", session: "s" }]);
		expect(alone.changed(change({ status: status("blocked") }), away, quiet, 0)).toEqual([]);
	});

	test("never for the worktree on screen, and held back with the rate limit", () => {
		const alerts = createStatusAlerts(10_000);
		alerts.changed(working, here, quiet, 0);
		expect(alerts.changed(done, here, quiet, 0)).toEqual([]);
		alerts.changed(working, away, quiet, 0);
		expect(alerts.changed(done, away, quiet, 0)).toEqual([{ kind: "sound", session: "s" }]);
		alerts.changed(working, away, quiet, 1000);
		expect(alerts.changed(done, away, quiet, 2000)).toEqual([]);
		expect(alerts.review(away, quiet, 10_000)).toEqual([{ kind: "sound", session: "s" }]);
	});
});

describe("the runner", () => {
	test("lets a held-back alert out on its timer, and withdraws everything on stop", () => {
		let clock = 0;
		const timers: { run: () => void; at: number }[] = [];
		const acted: AlertAction[] = [];
		const runner = createAlertRunner({
			attention: () => away,
			settings: () => all,
			act: action => acted.push(action),
			now: () => clock,
			interval: 10_000,
			setTimer: (run, delay) => {
				const timer = { run, at: clock + delay };
				timers.push(timer);
				return timer;
			},
			clearTimer: timer => void timers.splice(timers.indexOf(timer as typeof timers[number]), 1),
		});
		runner.changed(working);
		runner.changed(done);
		clock = 1000;
		runner.changed(working);
		clock = 2000;
		runner.changed(done);
		expect(acted).toEqual([show("Codex is done", "In feat-github-issue-lookup: Done"), withdraw()]);
		expect(timers.map(timer => timer.at)).toEqual([10_000]);
		clock = 10_000;
		timers.shift()!.run();
		expect(acted.at(-1)).toEqual(show("Codex is done", "In feat-github-issue-lookup: Done"));
		expect(timers).toEqual([]);
		runner.stop();
		expect(acted.at(-1)).toEqual(withdraw());
		runner.changed(working);
		runner.changed(done);
		expect(acted).toHaveLength(4);
	});
});

describe("a session's tasks", () => {
	const child = (id: string, state: "idle" | "working" | "done" | "blocked" | "error", more: Partial<NonNullable<TerminalSession["status"]>> = {}) => ({ id, ...status(state, more) });
	const withChildren = (...children: ReturnType<typeof child>[]) => change({ status: status("working"), children });

	test("a task moving to Needs you or Error notifies, named in the title, and one moving to Done does not", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(withChildren(child("a", "working")), away, all, 0);
		expect(alerts.changed(withChildren(child("a", "done")), away, all, 0)).toEqual([]);
		expect(alerts.changed(withChildren(child("a", "done"), child("b", "blocked", { kind: "permission", title: "Run the tests", message: "approve Bash: bun test" })), away, all, 0))
			.toEqual([show("Codex: task Run the tests needs you", "In feat-github-issue-lookup: approve Bash: bun test")]);
		// The task no longer needs you: its notification goes.
		expect(alerts.changed(withChildren(child("a", "done"), child("b", "working")), away, all, 0)).toEqual([withdraw()]);
		expect(alerts.changed(withChildren(child("c", "error")), away, all, 0)).toEqual([show("Codex: task c reported an error", "In feat-github-issue-lookup: Error")]);
		// Cleared, it goes too.
		expect(alerts.changed(withChildren(), away, all, 0)).toEqual([withdraw()]);
	});

	test("the session needing you itself comes first, and a second task needing you is not told again", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(change({ status: status("blocked") }), away, all, 0);
		expect(alerts.changed(change({ status: status("blocked"), children: [child("a", "blocked")] }), away, all, 0)).toEqual([]);
		const tasks = createStatusAlerts(0);
		tasks.changed(withChildren(), away, all, 0);
		expect(tasks.changed(withChildren(child("b", "blocked")), away, all, 0)).toHaveLength(1);
		expect(tasks.changed(withChildren(child("b", "blocked"), child("c", "blocked")), away, all, 0)).toEqual([]);
	});

	test("follows the rate limit and the on-screen rule, and an exited session's tasks are not told", () => {
		const alerts = createStatusAlerts(10_000);
		alerts.changed(withChildren(), away, all, 0);
		expect(alerts.changed(withChildren(child("a", "blocked")), away, all, 0)).toHaveLength(1);
		alerts.changed(withChildren(), away, all, 1000);
		// Inside the interval for Needs you, the next one waits, and goes out when it ends if it still holds.
		expect(alerts.changed(withChildren(child("b", "blocked")), away, all, 2000)).toEqual([]);
		expect(alerts.nextDue()).toBe(10_000);
		expect(alerts.review(away, all, 10_000)).toEqual([show("Codex: task b needs you", "In feat-github-issue-lookup: Needs you")]);
		const shown = createStatusAlerts(0);
		shown.changed(withChildren(), here, all, 0);
		expect(shown.changed(withChildren(child("a", "blocked")), here, all, 0)).toEqual([]);
		const ended = createStatusAlerts(0);
		ended.changed(withChildren(), away, all, 0);
		expect(ended.changed(change({ status: status("done"), state: { kind: "exited", exitCode: 0, signal: null }, children: [child("a", "error")] }), away, all, 0)).toEqual([]);
	});
});

describe("a session's tasks, told once", () => {
	const child = (id: string, state: "idle" | "working" | "done" | "blocked" | "error") => ({ id, ...status(state) });
	const at = (root: "working" | "blocked" | "done", ...children: ReturnType<typeof child>[]) => change({ status: status(root), children });

	test("a second task needing you is not told, even when its path sorts first", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(at("working"), away, all, 0);
		expect(alerts.changed(at("working", child("b", "blocked")), away, all, 0)).toEqual([show("Codex: task b needs you", "In feat-github-issue-lookup: Needs you")]);
		expect(alerts.changed(at("working", child("a", "blocked"), child("b", "blocked")), away, all, 0)).toEqual([]);
	});

	test("a task left in Error, or still waiting, is not told again when the root moves away and back", () => {
		const alerts = createStatusAlerts(0);
		alerts.changed(at("working"), away, all, 0);
		expect(alerts.changed(at("working", child("e", "error")), away, all, 0)).toHaveLength(1);
		expect(alerts.changed(at("blocked", child("e", "error")), away, all, 0)).toEqual([show("Codex needs you", "In feat-github-issue-lookup: Needs you")]);
		expect(alerts.changed(at("working", child("e", "error")), away, all, 0)).toEqual([withdraw()]);
		// Once it left Error, it is told again when it comes back.
		alerts.changed(at("working", child("e", "working")), away, all, 0);
		expect(alerts.changed(at("working", child("e", "error")), away, all, 0)).toHaveLength(1);
		const waiting = createStatusAlerts(0);
		waiting.changed(at("working"), away, all, 0);
		waiting.changed(at("working", child("b", "blocked")), away, all, 0);
		waiting.changed(at("blocked", child("b", "blocked")), away, all, 0);
		expect(waiting.changed(at("working", child("b", "blocked")), away, all, 0)).toEqual([withdraw()]);
	});
});
