import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorktreeRow } from "../src/mainview/components/WorktreeRow";
import { ROW_AGENT_MARKS, describeRowSessions } from "../src/mainview/terminal-format";
import type { Worktree } from "../src/shared/model";
import type { TerminalSession } from "../src/shared/terminal";

/** A row with many agents shows a few of them and a count of the rest (issue 240). */

const worktree: Worktree = {
	id: "/work/app/.git\0verified\0/work/app-worktrees/feat-x",
	path: "/work/app-worktrees/feat-x",
	canonicalPath: "/work/app-worktrees/feat-x",
	branch: "feat/x",
	head: "1234567890abcdef1234567890abcdef12345678",
	primary: false,
	detached: false,
	locked: false,
	prunable: false,
	pathExists: true,
	changes: { kind: "known", modified: [], untracked: [] },
	base: null,
	issue: null,
	sync: { kind: "tracking", upstream: "origin/feat/x", ahead: 0, behind: 0 },
};

type Reported = "idle" | "working" | "done" | "blocked" | "error";
const agent = (id: string, state: Reported | null, name = `Agent ${id}`): TerminalSession => ({
	id, kind: "agent", name, repository: "/work/app", worktree: worktree.id, path: worktree.path, shell: "/usr/bin/agent", command: "agent",
	state: { kind: "running" },
	status: state === null ? null : { state, kind: state === "blocked" ? "permission" : null, progress: null, app: null, title: null, message: null },
	children: [],
});

describe("which agents a row shows", () => {
	test("up to the limit, every agent shows and nothing is counted", () => {
		const sessions = Array.from({ length: ROW_AGENT_MARKS }, (_, index) => agent(String(index), "working"));
		const rows = describeRowSessions(sessions);
		expect(rows.shown.map(mark => mark.id)).toEqual(sessions.map(session => session.id));
		expect(rows.hidden).toEqual({ count: 0, words: "" });
	});

	test("past it, the most urgent show in the order they started, and the rest are a count with their words", () => {
		const sessions = [
			agent("a", "working"), agent("b", "done"), agent("c", "blocked"),
			agent("d", "idle"), agent("e", "error"), agent("f", "working"),
		];
		const rows = describeRowSessions(sessions);
		// The count takes the last place, so one fewer agent shows: here Needs you and the error, as they started.
		expect(rows.shown.map(mark => mark.id)).toEqual(["c", "e"]);
		expect(rows.hidden.count).toBe(4);
		expect(rows.hidden.words).toBe("4 more: Agent a: Working. Agent b: Done. Agent d: Idle. Agent f: Working.");
		// Everything else, such as the command palette, still gets every mark.
		expect(rows.marks.map(mark => mark.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
	});

	test("a working agent with a child that needs the person is as urgent as Needs you", () => {
		const blockedChild = { id: "t1", state: "blocked" as const, kind: "permission" as const, progress: null, app: null, title: null, message: null };
		const sessions = [
			agent("a", "error"), agent("b", "working"), agent("c", "error"),
			{ ...agent("d", "working"), children: [blockedChild] }, agent("e", "working"),
		];
		expect(describeRowSessions(sessions).shown.map(mark => mark.id)).toEqual(["a", "d"]);
	});

	test("the row's description still names every agent, shown or counted", () => {
		const sessions = Array.from({ length: 6 }, (_, index) => agent(String(index), "working", `Agent ${index + 1}`));
		const markup = renderToStaticMarkup(<WorktreeRow worktree={worktree} selected={false} onSelect={() => {}} sessions={sessions} />);
		const description = /<span id="[^"]*" class="row-description" hidden="">(.*?)<\/span>/.exec(markup)?.[1] ?? "";
		for (let index = 1; index <= 6; index += 1) expect(description).toContain(`Agent ${index}: Working`);
		// The count says how many more, and its tooltip names them.
		expect(markup).toContain(`<span class="row-agents-more" title="4 more: Agent 3: Working. Agent 4: Working. Agent 5: Working. Agent 6: Working.">+4</span>`);
		expect(markup.match(/class="row-agent /g)).toHaveLength(ROW_AGENT_MARKS - 1);
	});
});
