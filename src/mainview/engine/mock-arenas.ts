import {
	type ArenaAttempt, type ArenaLaunch, type ArenaList, type ArenaPreset, type InspectedAttempt, TASK_FILE_PLACEHOLDER, arenaNewArguments, arenaOf, arenaPickArguments,
	isArenaName, isAttemptLabel, newArenaProblem, readNewArenaResult, readPickArenaResult,
} from "../../shared/arenas";
import type { Engine } from "../../shared/engine";
import type { Repository, TimberStatus } from "../../shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand, readTimberResult } from "../../shared/timber-result";

/** The part of the engine about arenas. */
export type ArenaCapabilities = Pick<Engine, "listArenas" | "listArenaPresets" | "inspectArena" | "newArena" | "pickArena">;

/**
 * How an acted create or pick ends: as asked ("works"), with setup that
 * fails at the first attempt ("setup-fails"), or with the last loser kept by
 * Timber ("keeps").
 */
export const ARENA_ENDINGS = ["works", "setup-fails", "keeps"] as const;
export type ArenaEnding = typeof ARENA_ENDINGS[number];

export interface ArenaControls {
	/** Decide what the arenas of one repository answer from now on, or null for the sample. */
	setArenas(repository: string, list: ArenaList | null): void;
	/** Decide the saved arena presets of a repository. */
	setArenaPresets(repository: string, presets: ArenaPreset[]): void;
	/** Decide how creates and picks end from now on. "works" at the start. */
	endArenaCommands(ending: ArenaEnding): void;
	/** What the last create was asked, for tests: the command shown, and the task as Timber would get it in its file. */
	lastArenaTask(): { command: string; task: string } | null;
	/** What Timber would say an attempt's agent runs, as `__app-arena launch` (see ./mock-terminals.ts). */
	arenaLaunch(repository: string, worktree: string, arena: string, attempt: string): ArenaLaunch;
}

/** A repository named here acts out a Timber without arenas for apps; any other starts with none. */
export const sampleArenas: Readonly<Record<string, ArenaList>> = {
	"/work/billing": { state: "unsupported" },
};

interface MockArenaOptions {
	/** The repository in the list with this primary checkout, there on disk, or undefined. */
	listed: (path: string) => Repository | undefined;
	timber: () => TimberStatus;
	/** Add an attempt's worktree to the pretend disk, as Timber would. */
	addWorktree: (repository: string, path: string, branch: string) => void;
	/** Remove a worktree from the pretend disk, as pick would. */
	removeWorktree: (repository: string, path: string) => void;
	/** The names of the app's running sessions in these folders, as the main process checks before a pick. */
	runningIn: (paths: readonly string[]) => string[];
	/** How long a create or pick takes. */
	delay: () => number;
}

const COMMIT = "2222222222222222222222222222222222222222";
const PROGRAMS: Record<string, string> = { codex: "codex", claude: "claude", cursor: "cursor-agent", wrapper: "/usr/local/bin/arena-wrapper" };

/**
 * Arenas acted out in memory, for the browser build and tests. As the main
 * process does, a repository must be in the list and Timber must be ready,
 * and pick is refused while a session runs in an attempt. Each create and
 * pick is written as Timber's record and read with the same code as the real
 * one. The task is kept only for `lastArenaTask`, never in a record.
 */
export function createMockArenas(options: MockArenaOptions): ArenaCapabilities & ArenaControls {
	const { listed, timber, addWorktree, removeWorktree, runningIn, delay } = options;
	const lists = new Map<string, ArenaList>();
	const presets = new Map<string, ArenaPreset[]>();
	let ending: ArenaEnding = "works";
	let lastTask: { command: string; task: string } | null = null;

	const listOf = (path: string): ArenaList => {
		if (!lists.has(path)) lists.set(path, structuredClone(sampleArenas[path] ?? { state: "listed", arenas: [] }));
		return lists.get(path)!;
	};
	const problemOf = (repository: string): string | null => {
		if (!listed(repository)) return `${repository} is not a repository in the app's list.`;
		return timber().state === "ready" ? null : "Timber is not ready.";
	};
	const wait = async () => {
		const milliseconds = delay();
		if (milliseconds > 0) await new Promise(resolve => setTimeout(resolve, milliseconds));
	};
	const notRun = (diagnostic: string) => ({ outcome: "failed" as const, ran: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } });
	const envelope = (command: "arena-new" | "arena-pick", repository: string, diagnostic: string | null, fields: object) => JSON.stringify({
		schemaVersion: 1, command, outcome: diagnostic === null ? "succeeded" : "failed", exitCode: diagnostic === null ? 0 : 1,
		repository: { commonGitDir: `${repository}/.git`, primaryWorktreeRoot: repository, currentWorktreeRoot: repository },
		worktree: null, materialized: false, diagnostic, ...fields,
	});
	/** Pretend counts for an attempt: the first of each arena did the most. */
	const comparisonOf = (index: number) => ({
		commits: index === 0 ? 2 : index % 2,
		committed: { files: 3 - Math.min(index, 2), insertions: 40 - index * 7, deletions: 5 + index },
		uncommitted: { files: index % 2, insertions: index % 2 ? 4 : 0, deletions: 0 },
		untracked: index === 1 ? 2 : 0,
		ignored: 0,
	});

	return {
		async listArenas(repository) {
			const problem = problemOf(repository);
			if (problem) return { state: "failed", message: problem };
			return structuredClone(listOf(repository));
		},

		async listArenaPresets(repository) {
			const problem = problemOf(repository);
			if (problem) return { ok: false, message: problem };
			return { ok: true, presets: structuredClone(presets.get(repository) ?? []) };
		},

		async inspectArena({ repository, arena }) {
			const problem = problemOf(repository);
			if (problem) return { state: "failed", message: problem };
			const list = listOf(repository);
			if (list.state === "unsupported") return { state: "unsupported" };
			const found = arenaOf(list, arena);
			if (found === null || found.outcome !== "read") return { state: "failed", message: `timber arena pick ${arena} --inspect --json could not compare the attempts: Arena ${arena} was not found.` };
			const attempts: InspectedAttempt[] = found.attempts.map((attempt, index) => {
				const removed = attempt.git === "missing";
				return {
					label: attempt.label, tool: attempt.tool, preset: attempt.preset, model: attempt.model, effort: attempt.effort, branch: attempt.branch, path: attempt.path,
					state: attempt.state, stage: attempt.stage, removed, archiveRef: attempt.archive?.ref ?? null,
					comparison: removed ? null : comparisonOf(index), reason: removed ? "The attempt's worktree was removed." : null,
				};
			});
			return { state: "inspected", arena, base: found.base, winner: found.winner, attempts };
		},

		async newArena(request) {
			const { repository, name, task, groups, base } = request;
			const problem = newArenaProblem({ name, task, groups, base }) ?? problemOf(repository);
			if (problem) return { ...notRun(problem), arena: null };
			await wait();
			const command = describeTimberCommand(arenaNewArguments({ name, groups, base }, TASK_FILE_PLACEHOLDER, RESULT_FILE_PLACEHOLDER));
			lastTask = { command, task };
			const list = listOf(repository);
			const typed = name.trim();
			const arenaName = /^[A-Z][A-Z0-9]*-\d+$/.test(typed) ? typed.toLowerCase() : typed;
			const ended = (diagnostic: string | null, fields: object) => {
				const exitCode = diagnostic === null ? 0 : 1;
				return readNewArenaResult({ command, result: readTimberResult("arena-new", envelope("arena-new", repository, diagnostic, fields), exitCode), output: { text: "", truncated: false } });
			};
			if (list.state === "unsupported") return { ...notRun("The Timber found has no arenas for apps."), arena: null };
			if (!isArenaName(arenaName)) return ended(`Invalid arena name: ${typed}. Use lowercase letters, digits, - and _.`, {});
			if (list.state === "listed" && arenaOf(list, arenaName)) return ended("Arena already exists; inspect its retained state or choose another name.", {});

			const counts = new Map<string, number>();
			const attempts: ArenaAttempt[] = groups.flatMap(group => Array.from({ length: group.runs }, () => {
				const preset = group.kind === "preset" ? group.preset : group.tool;
				const number = (counts.get(preset) ?? 0) + 1;
				counts.set(preset, number);
				const label = `${preset}-${number}`;
				const tool = group.kind === "preset" ? (presets.get(repository)?.find(candidate => candidate.name === preset)?.tool ?? "wrapper") : group.tool;
				return {
					label, tool, preset, model: group.kind === "tool" ? group.model : null, effort: group.kind === "tool" ? group.effort : null,
					branch: `arena/${arenaName}/${label}`, path: `${repository}-worktrees/arena-${arenaName}-${label}`,
					state: "prepared" as const, stage: "ready", git: "ok" as const, archive: null,
				};
			}));
			const failing = ending === "setup-fails";
			if (failing) {
				attempts[0] = { ...attempts[0]!, state: "setup-failed", stage: "failed" };
				attempts.splice(1);
			}
			for (const attempt of attempts) addWorktree(repository, attempt.path, attempt.branch);
			const baseRef = { ref: base === null ? "refs/heads/main" : `refs/heads/${base.trim()}`, commit: COMMIT };
			if (list.state === "listed") {
				list.arenas = [...list.arenas, { name: arenaName, outcome: "read" as const, base: baseRef, createdAt: new Date().toISOString(), ticket: arenaName === typed ? null : typed, active: false, winner: null, attempts }]
					.sort((one, other) => one.name.localeCompare(other.name));
			}
			const report = {
				name: arenaName, id: "00000000-0000-4000-8000-000000000000", base: baseRef,
				failure: failing ? { stage: "setup", attempt: attempts[0]!.label } : null,
				attempts: attempts.map(attempt => ({
					label: attempt.label, tool: attempt.tool, preset: attempt.preset, model: attempt.model, effort: attempt.effort, branch: attempt.branch, path: attempt.path,
					created: true, stage: attempt.stage, failedStage: failing ? "setup" : null,
				})),
			};
			return ended(failing ? "Command returned a nonzero exit status; reconcile the worktree inventory before retrying." : null, { arenaNew: report });
		},

		async pickArena(request) {
			const { repository, arena, winner } = request;
			if (!isArenaName(arena) || !isAttemptLabel(winner)) return { ...notRun("The request for timber arena pick is not complete."), pick: null };
			const problem = problemOf(repository);
			if (problem) return { ...notRun(problem), pick: null };
			const list = listOf(repository);
			const found = arenaOf(list, arena);
			if (found === null || found.outcome !== "read") return { ...notRun(`Timber lists no arena called ${arena}.`), pick: null };
			const running = runningIn(found.attempts.map(attempt => attempt.path));
			if (running.length > 0) {
				return { ...notRun(`A session still runs in this arena: ${running.join(", ")}. Pick removes the other attempts' worktrees, so end their sessions first. The app never stops them for you.`), pick: null };
			}
			await wait();
			const command = describeTimberCommand(arenaPickArguments({ arena, winner }, RESULT_FILE_PLACEHOLDER));
			const losers = found.attempts.filter(attempt => attempt.label !== winner && attempt.git === "ok");
			const kept = ending === "keeps" ? losers.at(-1) : undefined;
			const outcomes = found.attempts.map((attempt, index) => {
				if (attempt.label === winner) return { label: attempt.label, outcome: "winner", archiveRef: null, reason: null };
				if (attempt.git !== "ok") return { label: attempt.label, outcome: "already-removed", archiveRef: attempt.archive?.ref ?? null, reason: null };
				if (attempt === kept) return { label: attempt.label, outcome: "kept", archiveRef: null, reason: "Arena attempt identity is missing, stale, or replaced; inspect Git worktrees and private markers. Nothing was recreated." };
				const archived = comparisonOf(index).commits > 0 || comparisonOf(index).untracked > 0;
				return { label: attempt.label, outcome: archived ? "archived" : "removed", archiveRef: archived ? `refs/timber/arena/${arena}/${attempt.label}` : null, reason: null };
			});
			if (!found.attempts.some(attempt => attempt.label === winner)) {
				const diagnostic = `No attempt "${winner}" in arena ${arena}.`;
				return readPickArenaResult({ command, result: readTimberResult("arena-pick", envelope("arena-pick", repository, diagnostic, {}), 1), output: { text: "", truncated: false } }, { arena, winner });
			}
			for (const attempt of found.attempts) {
				const outcome = outcomes.find(candidate => candidate.label === attempt.label)!;
				if (outcome.outcome === "removed" || outcome.outcome === "archived") {
					removeWorktree(repository, attempt.path);
					attempt.git = "missing";
				}
				if (outcome.outcome === "winner") attempt.state = "picked";
				if (outcome.outcome === "archived") {
					attempt.state = "archived";
					attempt.archive = { ref: outcome.archiveRef!, commit: COMMIT, present: true };
				}
			}
			found.winner = winner;
			const diagnostic = kept ? "Command returned a nonzero exit status; reconcile the worktree inventory before retrying." : null;
			const text = envelope("arena-pick", repository, diagnostic, { arenaPick: { name: arena, winner, attempts: outcomes } });
			return readPickArenaResult({ command, result: readTimberResult("arena-pick", text, diagnostic === null ? 0 : 1), output: { text: "", truncated: false } }, { arena, winner });
		},

		setArenas(repository, list) {
			if (list === null) lists.delete(repository);
			else lists.set(repository, structuredClone(list));
		},
		setArenaPresets(repository, next) {
			presets.set(repository, structuredClone(next));
		},
		endArenaCommands(next) {
			ending = next;
		},
		lastArenaTask: () => lastTask,
		arenaLaunch(repository, worktree, arena, attempt) {
			const found = arenaOf(lists.get(repository), arena);
			const entry = found?.outcome === "read" ? found.attempts.find(candidate => candidate.label === attempt) : undefined;
			if (!entry) return { outcome: "failed", message: `No attempt "${attempt}" in arena ${arena}; use an exact label from __app-arena list. Nothing was started.` };
			if (entry.tool === "manual") return { outcome: "no-agent" };
			const program = PROGRAMS[entry.tool] ?? entry.tool;
			const environment = { TIMBER_TASK_FILE: `${repository}/.git/timber/arenas/${arena}/task.txt`, TIMBER_ARENA: arena, TIMBER_ATTEMPT: attempt, TIMBER_REPO: repository, TIMBER_WORKTREE: worktree, TIMBER_BRANCH: entry.branch };
			return { outcome: "ready", argv: [program, ...(entry.model ? ["--model", entry.model] : []), environment.TIMBER_TASK_FILE], cwd: entry.path, environment, unset: ["TIMBER_TASK_ID", "TIMBER_WORKFLOW"] };
		},
	};
}
