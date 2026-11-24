import type { AgentSetting } from "../../shared/agent";
import type { AgentLocation } from "../../shared/agent-lookup";
import type { GitOperation } from "../../shared/commit-staged";
import {
	type GenerateTextRequest, type GenerateTextResult, type GeneratedText, NOT_GENERATED, NO_COMMITS_AHEAD, type WorktreePart, commitGenerateBlocker, describeGenerateCommand, generateCommand,
	pickGenerator, readGenerated,
} from "../../shared/generate-text";
import { sameArguments } from "../../shared/index-writes";
import type { Worktree } from "../../shared/model";

/** What the pretend agent answers until `setGeneratedText` gives another. */
const SAMPLES: Record<GenerateTextRequest["kind"], string> = {
	"commit": "Round totals after tax\n\nMove rounding out of the rules so that each line keeps its full precision.",
	"pull-request": "Round totals after tax\n\nTotals were rounded before tax was added, so a long order could be off by a few cents.\n\n- Round once, after tax\n- Keep each line's full precision",
};

export interface MockGenerateControls {
	/** How long the pretend agent takes to write, in milliseconds. 1200 at first. */
	setGenerateDelay(milliseconds: number): void;
	/** Make every later run fail with this message, as an agent prints it, or pass null to let them work again. Try "Not logged in. Run claude and sign in.". */
	failGenerate(message: string | null): void;
	/** Make the pretend agent answer this for one kind of text, or its sample again with null. */
	setGeneratedText(kind: GenerateTextRequest["kind"], answer: string | null): void;
	/** Pretend these changed in the worktree while the agent ran, and that this many files were too large to give. */
	setGenerateSideEffects(changed: WorktreePart[], leftOut?: number | null): void;
	/** Every run that started, oldest first, as it was asked for. */
	generateRequests(): GenerateTextRequest[];
}

/** What the pretend engine knows for one run, read when it starts. */
export interface MockGenerateFacts {
	worktree: Worktree;
	agents: readonly AgentSetting[];
	locations: readonly AgentLocation[];
	choice: string;
	staged: number;
	operation: GitOperation | null;
}

/** The pretend agent that writes text: it refuses as the main process does, takes a while, can fail, and can be stopped. */
export function createMockGenerate() {
	let delay = 1200;
	let failure: string | null = null;
	let changed: WorktreePart[] = [];
	let leftOut: number | null = 0;
	const answers: Partial<Record<GenerateTextRequest["kind"], string>> = {};
	const requests: GenerateTextRequest[] = [];
	const stops = new Map<string, () => void>();

	async function generate(request: GenerateTextRequest, facts: MockGenerateFacts): Promise<GenerateTextResult> {
		const refuse = (message: string): GenerateTextResult => ({ outcome: "refused", message: `${message} ${NOT_GENERATED}` });
		const picked = pickGenerator(facts.agents, facts.locations, facts.choice);
		if (!picked.ok) return refuse(picked.reason);
		if (!sameArguments(generateCommand(picked.generator), request.shown)) return refuse("The command to run is not the one that was shown.");
		const { worktree } = facts;
		if (request.kind === "commit") {
			const blocker = commitGenerateBlocker({ staged: facts.staged, operation: facts.operation, detached: worktree.detached });
			if (blocker !== null) return refuse(blocker);
		} else if (worktree.baseCounts?.kind === "counted" && worktree.baseCounts.ahead === 0) return refuse(NO_COMMITS_AHEAD);
		requests.push(structuredClone(request));
		const stopped = await new Promise<boolean>(resolve => {
			const timer = setTimeout(() => resolve(false), delay);
			stops.set(request.id, () => {
				clearTimeout(timer);
				resolve(true);
			});
		});
		stops.delete(request.id);
		if (stopped) return { outcome: "stopped" };
		const command = describeGenerateCommand(picked.generator);
		if (failure !== null) return { outcome: "failed", command, message: failure };
		const read: { ok: true; text: GeneratedText } | { ok: false; message: string } = readGenerated(request.kind, answers[request.kind] ?? SAMPLES[request.kind]);
		return read.ok ? { outcome: "generated", text: read.text, changed: [...changed], leftOut } : { outcome: "failed", command, message: read.message };
	}

	const controls: MockGenerateControls = {
		setGenerateDelay(milliseconds) {
			delay = milliseconds;
		},
		failGenerate(message) {
			failure = message;
		},
		setGeneratedText(kind, answer) {
			if (answer === null) delete answers[kind];
			else answers[kind] = answer;
		},
		setGenerateSideEffects(next, files = 0) {
			changed = next;
			leftOut = files;
		},
		generateRequests: () => structuredClone(requests),
	};

	return {
		generate,
		async stop(id: string): Promise<boolean> {
			const stop = stops.get(id);
			stop?.();
			return stop !== undefined;
		},
		controls,
	};
}
