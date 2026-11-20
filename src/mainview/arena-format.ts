import {
	ARENA_GROUP_TOOLS, type Arena, type ArenaAttempt, type ArenaGroup, type ArenaGroupTool, type ArenaList, type ArenaPreset, type AttemptComparison, type AttemptState,
	type PickedAttempt, TASK_FILE_PLACEHOLDER, arenaNewArguments, arenaPickArguments,
} from "../shared/arenas";
import type { Worktree } from "../shared/model";
import type { DialogRequest } from "./store/state";
import type { WorktreeMenuItem, WorktreeMenuItemId } from "./worktree-menu-format";
import type { TerminalSession } from "../shared/terminal";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../shared/timber-result";

/**
 * Words and rules for arenas in the interface. Pure, so they can be tested
 * without a window. Timber calls its arena commands beta, and so does every
 * place the app offers them.
 */
export const BETA = "Beta";
export const NEW_ARENA_LABEL = "New arena (Beta)";
export const ARENA_BETA_NOTE = "Arenas are beta in Timber: the commands and what they report may still change.";
export const NEW_ARENA_NOTE = "Timber makes one worktree per attempt, all from the same commit. The task goes to Timber in a private file, never on the command line.";
export const AGENTS_FOLLOW_UP = "Then, for each attempt, the app asks Timber what its agent runs, as below, and starts that in the attempt's own session. A manual attempt gets none.";
export const LAUNCH_COMMAND = "timber __app-arena launch <arena> --attempt <label>";
export const PICK_NOTE = "Pick keeps this attempt and removes the others. The app first ends its sessions in the others, and keeps this one's open. Timber saves the work of any attempt it removes under a refs/timber/arena ref first.";

/** Why New arena cannot be offered for a repository, or null when it can: only a Timber with no arenas for apps rules it out. */
export function arenasUnavailable(list: ArenaList | undefined): string | null {
	return list?.state === "unsupported" ? "The Timber found has no arenas for apps. Install a newer Timber." : null;
}

/** The entries of a repository's "+" menu. New arena says why when the Timber found has no arenas for apps. */
export function newMenuItems(list: ArenaList | undefined): WorktreeMenuItem[] {
	const reason = arenasUnavailable(list);
	return [
		{ id: "new-worktree", label: "New worktree\u2026", disabled: false, note: null, title: "Create a worktree with timber new" },
		{ id: "new-arena", label: `${NEW_ARENA_LABEL}\u2026`, disabled: reason !== null, note: reason, title: reason ?? "Give two or more agents the same task from the same commit, then keep the best" },
	];
}

/** The dialog an entry of a repository's "+" menu opens, or null for a disabled one or an entry that is not its own. */
export function newMenuChoice(repository: string, id: WorktreeMenuItemId, list: ArenaList | undefined): DialogRequest | null {
	const item = newMenuItems(list).find(candidate => candidate.id === id);
	if (!item || item.disabled) return null;
	return id === "new-arena" ? { kind: "new-arena", repository } : { kind: "new-worktree", repository };
}

/** One group of attempts as the dialog holds it, as typed. */
export interface ArenaGroupDraft {
	/** `tool:codex` for a tool, or `preset:<name>` for a saved preset. */
	choice: string;
	model: string;
	effort: string;
	runs: string;
}

export const toolChoice = (tool: ArenaGroupTool) => `tool:${tool}`;
export const presetChoice = (preset: string) => `preset:${preset}`;

/** A fresh group: Codex, run twice, so a new arena has the two attempts it needs. */
export const firstGroupDraft = (): ArenaGroupDraft => ({ choice: toolChoice("codex"), model: "", effort: "", runs: "2" });

/** The choices a group offers: the tools, then the repository's saved presets. */
export function groupChoices(presets: readonly ArenaPreset[]): { value: string; label: string }[] {
	return [
		...ARENA_GROUP_TOOLS.map(tool => ({ value: toolChoice(tool), label: tool === "manual" ? "Manual (no agent)" : tool })),
		...presets.map(preset => ({ value: presetChoice(preset.name), label: `Preset: ${preset.name} (${preset.tool})` })),
	];
}

/** Whether a group's choice takes a model and effort: a coding tool does, a preset and a manual attempt do not. */
export function takesModel(choice: string): boolean {
	return choice.startsWith("tool:") && choice !== toolChoice("manual");
}

/** The group a draft stands for. A count that is not a whole number stays one, so Timber's rules say what is wrong. */
export function groupOf(draft: ArenaGroupDraft): ArenaGroup {
	const runs = /^\d+$/.test(draft.runs.trim()) ? Number(draft.runs.trim()) : Number.NaN;
	if (draft.choice.startsWith("preset:")) return { kind: "preset", preset: draft.choice.slice("preset:".length), runs };
	const tool = draft.choice.slice("tool:".length) as ArenaGroupTool;
	const typed = (text: string) => takesModel(draft.choice) && text.trim() !== "" ? text.trim() : null;
	return { kind: "tool", tool, model: typed(draft.model), effort: typed(draft.effort), runs };
}

/** The base as typed: null when left empty, for Timber's default. */
export const baseOf = (text: string): string | null => text.trim() === "" ? null : text.trim();

/** The exact command New arena runs, as the dialog shows it. The task never appears in it. */
export function newArenaCommandFor(name: string, groups: readonly ArenaGroupDraft[], base: string): string {
	return describeTimberCommand(arenaNewArguments({ name: name.trim(), groups: groups.map(groupOf), base: baseOf(base) }, TASK_FILE_PLACEHOLDER, RESULT_FILE_PLACEHOLDER));
}

/** The exact command Keep runs, as the Compare dialog shows it before it runs. */
export function pickCommandFor(arena: string, winner: string): string {
	return describeTimberCommand(arenaPickArguments({ arena, winner }, RESULT_FILE_PLACEHOLDER));
}

/** What an attempt runs, in a few words: "codex, gpt-5, high effort", "stub preset (wrapper)", or "manual". */
export function describeAttemptTool(attempt: Pick<ArenaAttempt, "tool" | "preset" | "model" | "effort">): string {
	const tool = attempt.preset !== attempt.tool && attempt.preset !== "manual" ? `${attempt.preset} preset (${attempt.tool})` : attempt.tool;
	return [tool, attempt.model, attempt.effort === null ? null : `${attempt.effort} effort`].filter(Boolean).join(", ");
}

const STATE_WORDS: Record<AttemptState, string> = {
	"incomplete": "Not finished",
	"prepared": "Ready",
	"setup-failed": "Setup failed",
	"launched": "Started by Timber",
	"picked": "Kept",
	"archived": "Archived",
};

/** Where an attempt stands, as Timber recorded it, in words. */
export function describeAttemptState(state: AttemptState): string {
	return STATE_WORDS[state];
}

/** Where an attempt's agent stands in this app: its newest agent session, running or ended, or none. */
export function describeAttemptSession(sessions: readonly TerminalSession[]): { text: string; running: boolean } {
	const agents = sessions.filter(session => session.kind === "agent");
	const newest = agents.at(-1);
	const running = sessions.some(session => session.state.kind === "running");
	if (!newest) return { text: running ? "A terminal runs" : "No agent", running };
	if (newest.state.kind === "running") return { text: "Agent running", running: true };
	const { exitCode, signal } = newest.state;
	return { text: exitCode === null ? `Agent stopped by ${signal ?? "a signal"}` : `Agent exited with ${exitCode}`, running };
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Committed or uncommitted changes, as "3 files, +40 -5", or "none". */
export function describeChangeCount(count: { files: number; insertions: number; deletions: number }): string {
	return count.files === 0 ? "none" : `${plural(count.files, "file")}, +${count.insertions} -${count.deletions}`;
}

/** How an attempt differs from the arena's base, as the Compare dialog's cells say it. */
export function describeComparison(comparison: AttemptComparison): { commits: string; committed: string; uncommitted: string; untracked: string } {
	return {
		commits: plural(comparison.commits, "commit"),
		committed: describeChangeCount(comparison.committed),
		uncommitted: describeChangeCount(comparison.uncommitted),
		untracked: comparison.untracked === 0 ? "none" : plural(comparison.untracked, "file"),
	};
}

/** What pick did to one attempt, in words, with Timber's reason where it gave one. */
export function describePickOutcome(attempt: PickedAttempt): string {
	switch (attempt.outcome) {
		case "winner":
			return "Kept as the winner";
		case "removed":
			return "Removed: it held no work of its own";
		case "archived":
			return `Removed, its work saved under ${attempt.archiveRef ?? "an archive ref"}`;
		case "already-removed":
			return attempt.archiveRef ? `Already removed, its work saved under ${attempt.archiveRef}` : "Already removed";
		case "kept":
			return `Kept by Timber: ${attempt.reason ?? "it did not say why."}`;
		case "partly-removed":
			return `Partly removed: ${attempt.reason ?? "it did not say why."}`;
	}
}

/** The toast after a pick that worked. */
export const describePicked = (winner: string) => `Kept ${winner}; the other attempts were removed`;

/** The toast after a create that worked. */
export const describeCreated = (name: string, count: number) => `Arena ${name} created with ${plural(count, "attempt")}`;

/** One arena under a repository in the sidebar: its attempts that Git still has, each with its listed worktree. */
export interface ArenaRows {
	name: string;
	arena: Extract<Arena, { outcome: "read" }>;
	rows: { worktree: Worktree; attempt: ArenaAttempt }[];
}

/**
 * Split a repository's worktrees into the plain ones and the arenas they
 * belong to, in Timber's order of each. A worktree is an attempt only by
 * its path, and only while Timber says Git still has it as it was created:
 * never by its branch or folder name. An arena with no such worktree left,
 * as after a pick, keeps its row only for its winner.
 */
export function groupArenaRows(worktrees: readonly Worktree[], list: ArenaList | undefined): { plain: Worktree[]; arenas: ArenaRows[] } {
	if (list?.state !== "listed") return { plain: [...worktrees], arenas: [] };
	const taken = new Set<string>();
	const arenas: ArenaRows[] = [];
	for (const arena of list.arenas) {
		if (arena.outcome !== "read") continue;
		const rows = arena.attempts.flatMap(attempt => {
			if (attempt.git !== "ok") return [];
			const worktree = worktrees.find(candidate => candidate.path === attempt.path && !candidate.primary);
			if (!worktree || taken.has(worktree.path)) return [];
			taken.add(worktree.path);
			return [{ worktree, attempt }];
		});
		if (rows.length > 0) arenas.push({ name: arena.name, arena, rows });
	}
	return { plain: worktrees.filter(worktree => !taken.has(worktree.path)), arenas };
}

/** The sidebar's words for an arena's header. */
export function describeArenaHeader(arena: ArenaRows): { title: string; detail: string } {
	const { winner, base } = arena.arena;
	const attempts = plural(arena.rows.length, "attempt");
	return {
		title: `Arena ${arena.name}`,
		detail: winner ? `${attempts}, ${winner} kept` : `${attempts} from ${base.ref.replace(/^refs\/heads\//, "")} @ ${base.commit.slice(0, 7)}`,
	};
}
