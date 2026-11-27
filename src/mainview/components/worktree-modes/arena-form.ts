import { type ArenaCreation, type ArenaPreset, type NewArenaRequest, type OfferedArenaTool, offeredArenaTools } from "../../../shared/arenas";
import { type ArenaGroupDraft, baseOf, describeCreated, firstGroupDraft, fitGroups, groupOf } from "../../arena-format";
import type { AppStore } from "../../store/store";
import type { Submission } from "../../store/submission";
import type { ModeRun } from "./agent-choice";

export interface ArenaFormState {
	/** A name or ticket key, as typed. Timber decides the arena's name from it. */
	name: string;
	/** The task. It goes to Timber in a private file only, never on the command line. */
	task: string;
	groups: readonly ArenaGroupDraft[];
	/** The ref every attempt starts from, as typed. Empty for Timber's default. */
	base: string;
	/**
	 * The tools offered: the registry's agents the Timber found runs natively.
	 * Until they are read, and when they cannot be, those every Timber with
	 * arenas for apps runs.
	 */
	tools: readonly OfferedArenaTool[];
	/** Why the tools could not be read, or null. The tools every such Timber runs are offered either way. */
	toolsProblem: string | null;
	/** The repository's saved presets, offered beside the tools. Empty until read. */
	presets: readonly ArenaPreset[];
	/** Why the presets could not be read, or null. The tools are offered either way. */
	presetsProblem: string | null;
	/**
	 * What Timber reserved before a create stopped, or null. A reserved arena
	 * keeps its name, so the same name is not offered again.
	 */
	reserved: ArenaCreation | null;
}

/**
 * The fields of the "Arena" mode and what running them does, kept apart from
 * React so it can be tested without a window (see ./arena.tsx for the hook
 * and the fields themselves).
 */
export interface ArenaForm {
	getState(): ArenaFormState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	setName(name: string): void;
	setTask(task: string): void;
	setGroups(groups: readonly ArenaGroupDraft[]): void;
	setBase(base: string): void;
	/** Read the Timber's tools and the repository's presets, once: later calls read nothing, as each read runs Timber. */
	readChoices(): Promise<void>;
	/**
	 * Run `timber arena new` with the fields as they are now. The store starts
	 * each attempt's agent itself, so the run reports no worktree for the
	 * dialog to start one in. A create that stopped keeps what Timber reserved.
	 */
	/** `tag` is given to every attempt Timber creates. */
	run(tag?: string): Promise<ModeRun>;
}

/** The request the fields make. The dialog words its command from the same fields, and `run` sends this. */
export function arenaRequest(repository: string, state: Pick<ArenaFormState, "name" | "task" | "groups" | "base">): NewArenaRequest {
	return { repository, name: state.name.trim(), task: state.task, groups: state.groups.map(groupOf), base: baseOf(state.base) };
}

/** `repository` is the path of the primary checkout. */
export function createArenaForm(
	store: Pick<AppStore, "newArena" | "listArenaPresets" | "listArenaTools">,
	repository: string,
	submission: Pick<Submission, "clearFailure">,
): ArenaForm {
	const tools = offeredArenaTools({ state: "older" });
	let state: ArenaFormState = { name: "", task: "", groups: [firstGroupDraft(tools)], base: "", tools, toolsProblem: null, presets: [], presetsProblem: null, reserved: null };
	const listeners = new Set<() => void>();
	let choicesAsked = false;

	function update(change: Partial<ArenaFormState>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	/** An edit puts an earlier failure away, as in the other modes. */
	function edit(change: Partial<ArenaFormState>): void {
		update(change);
		submission.clearFailure();
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		setName: name => edit({ name }),
		setTask: task => edit({ task }),
		setGroups: groups => edit({ groups }),
		setBase: base => edit({ base }),
		async readChoices() {
			if (choicesAsked) return;
			choicesAsked = true;
			const [listed, answer] = await Promise.all([store.listArenaTools(repository), store.listArenaPresets(repository)]);
			const tools = offeredArenaTools(listed);
			update({
				tools,
				toolsProblem: listed.state === "failed" ? listed.message : null,
				// A group typed meanwhile keeps what it can: a tool no longer offered becomes the first one offered.
				groups: fitGroups(state.groups, tools),
				...(answer.ok ? { presets: answer.presets, presetsProblem: null } : { presets: [], presetsProblem: answer.message }),
			});
		},
		async run(tag) {
			const result = await store.newArena(arenaRequest(repository, state), tag);
			if (result.outcome === "created") {
				return { outcome: { ok: true, toast: describeCreated(result.arena.name, result.arena.attempts.length) }, created: null, setup: null };
			}
			if (result.arena) update({ reserved: result.arena });
			return { outcome: { ok: false, failure: result.failure }, created: null, setup: null };
		},
	};
}
