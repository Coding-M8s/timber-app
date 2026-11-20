import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	type ArenaGroupDraft, describeAttemptSession, describeAttemptTool, describeComparison, describePickOutcome, firstGroupDraft, groupArenaRows, groupChoices, groupOf,
	newArenaCommandFor, newMenuChoice, newMenuItems, pickCommandFor,
} from "../src/mainview/arena-format";
import { ArenaCompareView, type ArenaCompareViewProps, type CompareRow } from "../src/mainview/components/ArenaCompareDialog";
import { NewArenaView, type NewArenaViewProps } from "../src/mainview/components/NewArenaDialog";
import { createMockEngine, sampleRepositories, sampleStatesRepository } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import type { ArenaList, InspectedAttempt } from "../src/shared/arenas";
import type { Worktree } from "../src/shared/model";
import type { TerminalSession } from "../src/shared/terminal";
import { manualClock } from "./support/clock";

const settle = async () => {
	for (let round = 0; round < 12; round++) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const BILLING = "/work/billing";
const TASK = "PRIVATE_TASK_SENTINEL: make login faster";

async function startedStore(engine = createMockEngine([...sampleRepositories, sampleStatesRepository])) {
	const clock = manualClock();
	const store = createAppStore(engine, clock.schedule);
	store.start();
	await settle();
	return { store, engine, clock };
}
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

const worktree = (path: string, fields: Partial<Worktree> = {}): Worktree => ({
	id: `id:${path}`, path, canonicalPath: path, branch: path.split("/").at(-1)!, head: null, primary: false, detached: false, locked: false, prunable: false, pathExists: true,
	changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, ...fields,
});
const listOf = (attempts: { label: string; path: string; git?: "ok" | "stale" | "missing" }[]): ArenaList => ({
	state: "listed",
	arenas: [{
		name: "demo", outcome: "read", base: { ref: "refs/heads/main", commit: "abcdef0123456789abcdef0123456789abcdef01" }, createdAt: null, ticket: null, active: false, winner: null,
		attempts: attempts.map(attempt => ({
			label: attempt.label, tool: "codex", preset: "codex", model: null, effort: null, branch: `arena/demo/${attempt.label}`, path: attempt.path,
			state: "prepared", stage: "ready", git: attempt.git ?? "ok", archive: null,
		})),
	}],
});

describe("arena words and rules", () => {
	test("attempts are grouped by their path only, while Git has them as Timber made them", () => {
		const worktrees = [worktree("/w/app", { primary: true }), worktree("/w/app-worktrees/feat"), worktree("/w/app-worktrees/arena-demo-codex-1"), worktree("/w/app-worktrees/arena-demo-codex-2"), worktree("/w/app-worktrees/arena-demo-codex-3")];
		const list = listOf([
			{ label: "codex-1", path: "/w/app-worktrees/arena-demo-codex-1" },
			{ label: "codex-2", path: "/w/app-worktrees/arena-demo-codex-2", git: "stale" },
			{ label: "codex-3", path: "/w/elsewhere" },
		]);
		const grouped = groupArenaRows(worktrees, list);
		expect(grouped.arenas.map(arena => [arena.name, arena.rows.map(row => row.attempt.label)])).toEqual([["demo", ["codex-1"]]]);
		// A branch or folder named like an attempt stays a plain worktree.
		expect(grouped.plain.map(entry => entry.path)).toEqual(["/w/app", "/w/app-worktrees/feat", "/w/app-worktrees/arena-demo-codex-2", "/w/app-worktrees/arena-demo-codex-3"]);
		expect(groupArenaRows(worktrees, { state: "unsupported" }).plain).toHaveLength(5);
	});

	test("the command New arena shows names the task file, never the task", () => {
		const groups: ArenaGroupDraft[] = [{ choice: "tool:claude", model: "opus", effort: "high", runs: "2" }, { choice: "tool:manual", model: "ignored", effort: "", runs: "1" }];
		expect(newArenaCommandFor(" demo ", groups, " main ")).toBe(
			"timber arena new --tool=claude --model=opus --effort=high --runs=2 --tool=manual --runs=1 --base=main --prompt-file <task file> --no-editor --no-agent --result-file <temporary file> -- demo",
		);
		expect(groupOf({ ...firstGroupDraft(), runs: "x" }).runs).toBeNaN();
		expect(groupOf({ choice: "preset:fast", model: "m", effort: "e", runs: "3" })).toEqual({ kind: "preset", preset: "fast", runs: 3 });
		expect(groupChoices([{ name: "fast", tool: "codex" }]).at(-1)).toEqual({ value: "preset:fast", label: "Preset: fast (codex)" });
		expect(pickCommandFor("demo", "codex-1")).toBe("timber arena pick demo --winner codex-1 --result-file <temporary file>");
	});

	test("comparisons, tools, sessions, and pick outcomes in words", () => {
		expect(describeComparison({ commits: 1, committed: { files: 2, insertions: 10, deletions: 3 }, uncommitted: { files: 0, insertions: 0, deletions: 0 }, untracked: 1, ignored: 0 }))
			.toEqual({ commits: "1 commit", committed: "2 files, +10 -3", uncommitted: "none", untracked: "1 file" });
		expect(describeAttemptTool({ tool: "codex", preset: "codex", model: "gpt-5", effort: "high" })).toBe("codex, gpt-5, high effort");
		expect(describeAttemptTool({ tool: "wrapper", preset: "stub", model: null, effort: null })).toBe("stub preset (wrapper)");
		expect(describePickOutcome({ label: "a", outcome: "archived", archiveRef: "refs/timber/arena/demo/a", reason: null })).toBe("Removed, its work saved under refs/timber/arena/demo/a");
		expect(describePickOutcome({ label: "a", outcome: "kept", archiveRef: null, reason: "It runs." })).toBe("Kept by Timber: It runs.");
		const session = (state: TerminalSession["state"]): TerminalSession => ({ id: "1", kind: "agent", name: "codex-1", repository: "/r", worktree: "w", path: "/p", shell: "codex", command: "codex", state, status: null });
		expect(describeAttemptSession([session({ kind: "running" })])).toEqual({ text: "Agent running", running: true });
		expect(describeAttemptSession([session({ kind: "exited", exitCode: 0, signal: null })])).toEqual({ text: "Agent exited with 0", running: false });
		expect(describeAttemptSession([])).toEqual({ text: "No agent", running: false });
	});

	test("the + menu offers New arena, disabled with the reason when the Timber found has no arenas", () => {
		expect(newMenuItems({ state: "listed", arenas: [] }).map(item => [item.id, item.disabled])).toEqual([["new-worktree", false], ["new-arena", false]]);
		const unsupported = newMenuItems({ state: "unsupported" })[1]!;
		expect(unsupported).toMatchObject({ disabled: true, note: expect.stringContaining("no arenas for apps") });
		expect(newMenuChoice("/r", "new-arena", { state: "listed", arenas: [] })).toEqual({ kind: "new-arena", repository: "/r" });
		expect(newMenuChoice("/r", "new-arena", { state: "unsupported" })).toBeNull();
		expect(newMenuChoice("/r", "new-worktree", undefined)).toEqual({ kind: "new-worktree", repository: "/r" });
	});
});

describe("the New arena dialog", () => {
	const props = (change: Partial<NewArenaViewProps> = {}): NewArenaViewProps => ({
		repositoryName: "timber", name: "demo", task: TASK, groups: [firstGroupDraft()], base: "", presets: [{ name: "stub", tool: "wrapper" }], presetsProblem: null, reserved: null,
		submission: { running: false, failure: null }, onName() {}, onTask() {}, onGroups() {}, onBase() {}, onSubmit() {}, onClose() {}, ...change,
	});

	test("shows the exact command and the launch Timber is asked for, says Beta, and never shows the task in a command", () => {
		const markup = renderToStaticMarkup(<NewArenaView {...props()} />);
		expect(markup).toContain("New arena (Beta) in timber");
		expect(markup).toContain("Arenas are beta in Timber");
		expect(markup).toContain('aria-label="Command that will run">timber arena new --tool=codex --runs=2 --prompt-file &lt;task file&gt; --no-editor --no-agent --result-file &lt;temporary file&gt; -- demo</pre>');
		expect(markup).toContain('aria-label="Command that will start next">timber __app-arena launch &lt;arena&gt; --attempt &lt;label&gt;</pre>');
		expect(markup).toContain("Preset: stub (wrapper)");
		// The task is in its own field only.
		expect(markup.split(TASK)).toHaveLength(2);
		expect(markup).toMatch(/<textarea[^>]*name="task"[^>]*>PRIVATE_TASK_SENTINEL/);
	});

	test("cannot be submitted without a task, or with fewer than two attempts, and says why", () => {
		const noTask = renderToStaticMarkup(<NewArenaView {...props({ task: "" })} />);
		expect(noTask).toContain("Write the task the attempts work on.");
		expect(noTask).toMatch(/<button type="submit" class="button primary" disabled="">Create arena<\/button>/);
		const one = renderToStaticMarkup(<NewArenaView {...props({ groups: [{ ...firstGroupDraft(), runs: "1" }] })} />);
		expect(one).toContain("An arena has at least 2 attempts.");
	});

	test("after a create that stopped, says what Timber kept and does not offer the same name again", () => {
		const reserved = { name: "demo", base: { ref: "refs/heads/main", commit: "a".repeat(40) }, failure: { stage: "setup", attempt: "codex-1" }, attempts: [{ label: "codex-1", tool: "codex", preset: "codex", model: null, effort: null, branch: "arena/demo/codex-1", path: "/w/a", created: true, stage: "failed", failedStage: "setup" }] };
		const markup = renderToStaticMarkup(<NewArenaView {...props({ reserved, submission: { running: false, failure: { command: "timber arena new", diagnostic: "Setup failed.", output: null } } })} />);
		expect(markup).toContain("Timber kept arena demo; it stopped at setup of codex-1. No agent was started.");
		expect(markup).toContain("codex-1: created, setup failed");
		expect(markup).toContain("Timber already kept an arena called demo. Choose another name.");
		expect(markup).toMatch(/<button type="submit" class="button primary" disabled="">Create arena<\/button>/);
	});
});

describe("creating an arena from the app", () => {
	test("creates through Timber, groups the attempts in the sidebar, and starts each agent in its own session with Timber's command", async () => {
		const { store, engine } = await startedStore();
		const result = await store.newArena({
			repository: TIMBER, name: "demo", task: TASK, base: null,
			groups: [{ kind: "tool", tool: "codex", model: "gpt-5", effort: null, runs: 2 }, { kind: "tool", tool: "manual", model: null, effort: null, runs: 1 }],
		});
		await settle();
		expect(result.outcome).toBe("created");
		// The task reached Timber's file only.
		expect(engine.lastArenaTask()).toEqual({ task: TASK, command: expect.stringContaining("--prompt-file <task file>") });
		expect(engine.lastArenaTask()!.command).not.toContain("PRIVATE_TASK_SENTINEL");

		const sessions = store.getState().terminals.filter(session => session.repository === TIMBER && session.path.includes("arena-demo"));
		expect(sessions.map(session => [session.name, session.kind, session.path])).toEqual([
			["codex-1", "agent", "/work/timber-worktrees/arena-demo-codex-1"],
			["codex-2", "agent", "/work/timber-worktrees/arena-demo-codex-2"],
		]);
		expect(sessions[0]!.command).toBe("/usr/local/bin/codex --model gpt-5 /work/timber/.git/timber/arenas/demo/task.txt");

		const markup = render(store);
		expect(markup).toMatch(/<section class="arena-rows" aria-label="Arena demo">/);
		expect(markup).toContain('<span class="arena-beta">Beta</span>');
		expect(markup).toContain('<span class="row-name">codex-1</span>');
		expect(markup).toContain('<span class="row-name">manual-1</span>');
		// The first attempt is selected.
		expect(markup).toMatch(/class="workspace-title" title="arena\/demo\/codex-1"/);
	});

	test("a create that stopped starts no agent", async () => {
		const { store, engine } = await startedStore();
		engine.endArenaCommands("setup-fails");
		const result = await store.newArena({ repository: TIMBER, name: "broken", task: TASK, base: null, groups: [{ kind: "tool", tool: "codex", model: null, effort: null, runs: 2 }] });
		await settle();
		expect(result).toMatchObject({ outcome: "failed", arena: { name: "broken", failure: { stage: "setup" } } });
		expect(store.getState().terminals.filter(session => session.path.includes("arena-broken"))).toEqual([]);
	});

	test("a repository whose Timber has no arenas offers none", async () => {
		const { store } = await startedStore();
		expect(store.getState().arenas[BILLING]).toEqual({ state: "unsupported" });
		expect(newMenuItems(store.getState().arenas[BILLING])[1]!.disabled).toBe(true);
	});
});

describe("comparing and keeping an attempt", () => {
	const attempt = (label: string, fields: Partial<InspectedAttempt> = {}): InspectedAttempt => ({
		label, tool: "codex", preset: "codex", model: null, effort: null, branch: `arena/demo/${label}`, path: `/w/${label}`, state: "prepared", stage: "ready", removed: false, archiveRef: null,
		comparison: { commits: 2, committed: { files: 3, insertions: 40, deletions: 5 }, uncommitted: { files: 1, insertions: 4, deletions: 0 }, untracked: 2, ignored: 0 }, reason: null, ...fields,
	});
	const row = (label: string, fields: Partial<CompareRow> = {}): CompareRow => ({ attempt: attempt(label), worktree: worktree(`/w/${label}`), sessions: [], outcome: null, ...fields });
	const props = (change: Partial<ArenaCompareViewProps> = {}): ArenaCompareViewProps => ({
		arena: "demo",
		inspection: { state: "inspected", arena: "demo", base: { ref: "refs/heads/main", commit: "abcdef0123456789" }, winner: null, attempts: [attempt("codex-1"), attempt("claude-1")] },
		rows: [row("codex-1"), row("claude-1")], choosing: null, ending: [], keeping: [], submission: { running: false, failure: null },
		onChoose() {}, onCompare() {}, onPick() {}, onOpenChanges() {}, onStartAgent() {}, onClose() {}, ...change,
	});

	test("shows the read-only comparison command and one row per attempt, untracked files apart", () => {
		const markup = renderToStaticMarkup(<ArenaCompareView {...props()} />);
		expect(markup).toContain("Compare attempts of arena demo (Beta)");
		expect(markup).toContain('aria-label="Command that will run">timber arena pick demo --inspect --json</pre>');
		expect(markup).toContain("Counted against the arena&#x27;s base, refs/heads/main @ abcdef0.");
		expect(markup).toContain("<td>2 commits</td><td>3 files, +40 -5</td><td>1 file, +4 -0</td><td>2 files</td>");
		expect(markup.match(/>Keep this one</g)).toHaveLength(2);
		expect(markup.match(/>Open in Changes</g)).toHaveLength(2);
		expect(markup.match(/>Start agent</g)).toHaveLength(2);
	});

	test("Keep this one shows the exact pick command and the sessions it ends and keeps before it runs, and running agents never block it", () => {
		const confirming = renderToStaticMarkup(<ArenaCompareView {...props({ choosing: "codex-1" })} />);
		expect(confirming).toContain('aria-label="Command that will run">timber arena pick demo --winner codex-1 --result-file &lt;temporary file&gt;</pre>');
		expect(confirming).toContain("Removed: claude-1.");
		expect(confirming).toMatch(/<button type="button" class="button danger">Keep codex-1<\/button>/);
		expect(confirming).toContain("No session of the app is open in the other attempts.");
		const busy = renderToStaticMarkup(<ArenaCompareView {...props({ choosing: "codex-1", ending: ["claude-1", "Terminal 2"], keeping: ["codex-1"] })} />);
		expect(busy).toContain("Ends these sessions first: claude-1, Terminal 2.");
		expect(busy).toContain("Keeps open: codex-1.");
		expect(busy).toMatch(/<button type="button" class="button danger">Keep codex-1<\/button>/);
	});

	test("reports what pick did on each row, Timber's reason for a kept one included", () => {
		const markup = renderToStaticMarkup(<ArenaCompareView {...props({
			inspection: { state: "inspected", arena: "demo", base: null, winner: "codex-1", attempts: [attempt("codex-1"), attempt("claude-1")] },
			rows: [row("codex-1", { outcome: { label: "codex-1", outcome: "winner", archiveRef: null, reason: null } }), row("claude-1", { outcome: { label: "claude-1", outcome: "kept", archiveRef: null, reason: "It is still running." } })],
		})} />);
		expect(markup).toContain('<span class="arena-outcome">Kept as the winner</span>');
		expect(markup).toContain('<span class="arena-outcome failing">Kept by Timber: It is still running.</span>');
		expect(markup).not.toContain(">Keep this one<");
	});

	test("keeping one ends the other attempts' sessions first and keeps the chosen one's running, then removes the others", async () => {
		const { store } = await startedStore();
		await store.newArena({ repository: TIMBER, name: "demo", task: TASK, base: null, groups: [{ kind: "tool", tool: "codex", model: null, effort: null, runs: 2 }] });
		await settle();
		const sessions = () => store.getState().terminals.filter(session => session.path.includes("arena-demo"));
		expect(sessions().map(session => [session.name, session.state.kind])).toEqual([["codex-1", "running"], ["codex-2", "running"]]);
		// A shell in the other attempt ends too, since its folder goes.
		await store.openTerminal({ repository: TIMBER, worktree: "/work/timber-worktrees/arena-demo-codex-2", cols: 80, rows: 24 });
		await settle();

		const picked = await store.pickArena({ repository: TIMBER, arena: "demo", winner: "codex-1" });
		await settle();
		expect(picked).toMatchObject({ outcome: "picked", pick: { winner: "codex-1" } });
		expect(sessions().map(session => [session.name, session.state.kind])).toEqual([["codex-1", "running"]]);
		const paths = store.getState().repositories.find(repository => repository.path === TIMBER)!.worktrees.map(entry => entry.path);
		expect(paths).toContain("/work/timber-worktrees/arena-demo-codex-1");
		expect(paths).not.toContain("/work/timber-worktrees/arena-demo-codex-2");
		// The list was read again: the winner is recorded, and only it is grouped under the arena.
		const list = store.getState().arenas[TIMBER];
		expect(list?.state === "listed" && list.arenas[0]!.outcome === "read" && list.arenas[0]!.winner).toBe("codex-1");
		expect(render(store)).toContain("1 attempt, codex-1 kept");
	});
});
