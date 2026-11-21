import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { CHILD_ROWS_SHOWN, ChildTaskList, rowsToShow } from "../src/mainview/components/ChildTasks";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { sessionsOf, waitingSessions } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { describeRowSessions, describeSessionChip, describeTerminalState } from "../src/mainview/terminal-format";
import { isWaiting } from "../src/mainview/waiting";
import { type ChildStatus, createStatusRecords, parseStatusReport } from "../src/shared/program-status";
import {
	alertStatus, childBadge, childRows, describeChild, describeNotableChildren, describeSessionStatus, hasStatusMark, recordsForWindow, runningChildren, stillWorking,
} from "../src/shared/session-status";
import type { TerminalSession } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const primaryId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === TIMBER)!.id;
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

const status = (state: "idle" | "working" | "done" | "blocked" | "error", more: Partial<NonNullable<TerminalSession["status"]>> = {}) =>
	({ state, kind: null, progress: null, app: null, title: null, message: null, ...more });
const child = (id: string, state: "idle" | "working" | "done" | "blocked" | "error", more: Partial<NonNullable<TerminalSession["status"]>> = {}): ChildStatus => ({ id, ...status(state, more) });
const session = (change: Partial<TerminalSession> = {}): TerminalSession => ({
	id: "s", kind: "agent", name: "Claude Code", repository: TIMBER, worktree: featureId, path: FEATURE, shell: "/usr/local/bin/claude", command: "claude",
	state: { kind: "running" }, status: status("working"), children: [], ...change,
});
const exited = { kind: "exited" as const, exitCode: 0, signal: null };

describe("a session's tasks in words", () => {
	test("only Working and Needs you count as running, and an exited session has none", () => {
		const children = [child("a", "working"), child("b", "blocked", { kind: "permission" }), child("c", "done"), child("d", "idle"), child("e", "error")];
		expect(runningChildren(session({ children })).map(task => task.id)).toEqual(["a", "b"]);
		expect(runningChildren(session({ children, state: exited }))).toEqual([]);
		// The count and the words also take in a task that reported an error.
		expect(describeNotableChildren(session({ children }))).toBe("3 tasks: 1 needs you, 1 error, 1 working");
		expect(describeNotableChildren(session({ children: [child("a", "working")] }))).toBe("1 task: 1 working");
		expect(describeNotableChildren(session({ children: [child("c", "done")] }))).toBe("");
	});

	test("the badge counts the running tasks and takes the most urgent one's status", () => {
		expect(childBadge(session({ children: [child("a", "working", { progress: 10 }), child("b", "blocked", { kind: "question" })] })))
			.toEqual({ count: 2, status: { kind: "needs-you", reason: "question" } });
		expect(childBadge(session({ children: [child("a", "working", { progress: 10 })] }))).toEqual({ count: 1, status: { kind: "working", progress: 10 } });
		expect(childBadge(session({ children: [child("a", "done")] }))).toBeNull();
		expect(childBadge(session({ children: [child("a", "working"), child("e", "error")] }))).toEqual({ count: 2, status: { kind: "error" } });
		expect(childBadge(session({ children: [child("a", "working")], state: exited }))).toBeNull();
	});

	test("Done or Idle while tasks still run is said, without a count in the live words", () => {
		const done = session({ status: status("done"), children: [child("a", "working"), child("b", "working")] });
		expect(stillWorking(done)).toBe(true);
		expect(stillWorking(session({ status: status("idle"), children: [child("a", "blocked")] }))).toBe(true);
		expect(stillWorking(session({ status: status("working"), children: [child("a", "working")] }))).toBe(false);
		expect(stillWorking(session({ status: status("done"), children: [child("a", "done")] }))).toBe(false);
		expect(describeTerminalState(done)).toBe("Done, tasks still running");
		expect(describeSessionStatus(done)).toBe("Claude Code: Done, tasks still running. 2 tasks: 2 working");
		expect(describeSessionChip(done, false)).toBe("Agent, claude. Done, tasks still running. 2 tasks: 2 working");
		expect(describeRowSessions([done]).sentence).toBe("Claude Code: Done, tasks still running. 2 tasks: 2 working.");
	});

	test("a shell whose program reports only tasks still gets a mark while they run", () => {
		const shell = session({ kind: "terminal", status: null, children: [child("a", "working")] });
		expect(hasStatusMark(shell)).toBe(true);
		expect(hasStatusMark({ ...shell, children: [child("a", "done")] })).toBe(false);
		expect(describeRowSessions([shell]).marks[0]!.badge).toEqual({ count: 1, status: { kind: "working", progress: null } });
	});

	test("a task that needs you counts as the session needing you, but tasks never make it Working", () => {
		const blocked = child("b", "blocked", { kind: "permission" });
		expect(alertStatus(session({ children: [child("a", "working"), blocked] }))).toEqual({ status: { kind: "needs-you", reason: "permission" }, child: blocked });
		expect(alertStatus(session({ status: status("blocked"), children: [blocked] })).child).toBeNull();
		expect(alertStatus(session({ status: status("done"), children: [blocked] })).child).toBe(blocked);
		expect(alertStatus(session({ status: status("done"), children: [child("e", "error")] }))).toEqual({ status: { kind: "done" }, child: null });
		expect(alertStatus(session({ status: status("idle"), children: [child("e", "error")] })).status).toEqual({ kind: "error" });
		expect(alertStatus(session({ status: status("done"), children: [child("a", "working")] })).status).toEqual({ kind: "done" });
		expect(alertStatus(session({ state: exited, children: [blocked] }))).toEqual({ status: { kind: "stopped" }, child: null });
		expect(isWaiting(session({ children: [blocked] }))).toBe(true);
	});

	test("each task in words, by its title or its path", () => {
		expect(describeChild(child("review/tests", "blocked", { kind: "permission", title: "Run the tests", message: "approve Bash: bun test" })))
			.toBe("Run the tests: Needs you: approval. approve Bash: bun test");
		expect(describeChild(child("lint", "working", { progress: 40 }))).toBe("lint: Working, 40%");
	});

	test("the tree sits each task under the nearest record above it, and shows a whole path when there is none", () => {
		const rows = childRows([child("a", "working"), child("a/b", "working"), child("a/b/c", "done"), child("x/y", "working"), child("x/y/z", "working", { title: "Zed" })]);
		expect(rows.map(row => [row.child.id, row.depth, row.label])).toEqual([
			["a", 0, "a"], ["a/b", 1, "b"], ["a/b/c", 2, "c"], ["x/y", 0, "x/y"], ["x/y/z", 1, "Zed"],
		]);
	});

	test("the window gets the tasks with each message cut to 200 characters, and the root's whole", () => {
		const records = createStatusRecords();
		const long = Buffer.from("y".repeat(400)).toString("base64");
		records.apply({ type: "report", report: parseStatusReport(`state=working:msg=${long}`) });
		records.apply({ type: "report", report: parseStatusReport(`state=working:id=a:msg=${long}`) });
		const sent = recordsForWindow(records);
		expect(sent.status!.message).toHaveLength(400);
		expect(sent.children[0]!.message).toBe(`${"y".repeat(197)}...`);
	});
});

describe("the list of tasks", () => {
	test("nested lists with each task's state, progress, title, and message as text", () => {
		const markup = renderToStaticMarkup(<ChildTaskList tasks={[
			child("review", "working", { progress: 40, title: "Review the diff" }),
			child("review/tests", "blocked", { kind: "permission", title: "<b>Run</b>", message: "approve Bash: bun test" }),
			child("docs", "done"),
		]} />);
		expect(markup).toContain('<span class="child-task-name" title="review">Review the diff</span><span class="child-task-state">Working, 40%</span>');
		// A title is text, never markup.
		expect(markup).toContain('title="review/tests">&lt;b&gt;Run&lt;/b&gt;</span><span class="child-task-state">Needs you: approval</span></span><span class="child-task-message">approve Bash: bun test</span>');
		expect(markup.match(/<ul class="child-task-list" role="list">/g)).toHaveLength(2);
		expect(markup).toContain('title="docs">docs</span><span class="child-task-state">Done</span>');
	});

	test("past the limit, the tasks that need you or reported an error stay listed, with the records they sit under", () => {
		const rows = childRows([
			...Array.from({ length: 6 }, (_, index) => child(`a${index}`, "working")),
			child("z", "working"), child("z/y", "blocked"), child("zz", "error"),
		]);
		expect(rowsToShow(rows, 5).map(row => row.child.id)).toEqual(["a0", "a1", "z", "z/y", "zz"]);
		expect(rowsToShow(rows.slice(0, 3), 5)).toHaveLength(3);
	});

	test("shows at most a set number, then how many more", () => {
		const many = Array.from({ length: CHILD_ROWS_SHOWN + 3 }, (_, index) => child(`t${String(index).padStart(3, "0")}`, "working"));
		const markup = renderToStaticMarkup(<ChildTaskList tasks={many} />);
		expect(markup.match(/class="child-task"/g)).toHaveLength(CHILD_ROWS_SHOWN);
		expect(markup).toContain("and 3 more");
	});
});

describe("tasks in the app", () => {
	/** A started store with Codex in the feature worktree that acted out its tasks, with the primary checkout selected unless `onScreen`. */
	async function withTasks(onScreen = true) {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.select(featureId);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, agent: "Codex" });
		await settle();
		const [agent] = sessionsOf(store.getState(), featureId);
		if (!onScreen) {
			store.select(primaryId);
			await settle();
		}
		store.writeTerminal(agent!.id, "subagents\r");
		await settle();
		const current = () => store.getState().terminals.find(entry => entry.id === agent!.id)!;
		return { engine, store, agent: agent!, current };
	}

	test("the mock acts out tasks with subagents, and clears them with subagents clear", async () => {
		const { store, agent, current } = await withTasks();
		expect(current().children.map(task => [task.id, task.state])).toEqual([["dev-server", "working"], ["docs", "done"], ["review", "working"], ["review/tests", "blocked"]]);
		store.writeTerminal(agent.id, "subagents clear\r");
		await settle();
		expect(current().children).toEqual([]);
		expect(current().status).toBeNull();
	});

	test("the row and the chip show a count beside the mark, and say it in words", async () => {
		const { store, agent } = await withTasks();
		store.showSession(agent.id);
		const markup = render(store);
		// Two on the page: the row's and the chip's, each with the diamond of the task that needs you.
		expect(markup.match(/<span class="child-badge status-needs-you" aria-hidden="true"><svg class="status-glyph status-needs-you"[^]*?<\/svg>3<\/span>/g)).toHaveLength(2);
		expect(markup).toContain("Codex: Working. Running 4 tasks. 3 tasks: 1 needs you, 2 working.");
		// The mock reports no app, so a Codex session keeps its own icon.
		expect(markup).toContain("agent-icon-codex");
		expect(markup).toContain('title="Agent, codex. Working. Running 4 tasks. 3 tasks: 1 needs you, 2 working. Double-click or F2 renames');
		expect(markup).toContain('aria-expanded="false" title="4 tasks of Codex, 1 needs you, 2 working. Show the list" aria-label="4 tasks of Codex, 1 needs you, 2 working">4 tasks</button>');
	});

	test("a task that needs you puts the session in the waiting list and the collapsed header", async () => {
		const { store, agent } = await withTasks(false);
		expect(waitingSessions(store.getState())).toEqual([agent.id]);
		store.toggleGroup(TIMBER);
		expect(render(store)).toContain('<span class="group-status status-needs-you" aria-hidden="true">1 needs you</span>');
	});

	test("a task that needs you notifies, named in the title", async () => {
		const { engine } = await withTasks(false);
		expect(engine.notices().map(notice => notice.title)).toContain("Codex: task Run the tests needs you");
	});
});
