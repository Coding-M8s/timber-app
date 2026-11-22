import {
	CHOPS_FILE, type ChopApprovals, type ChopList, type ChopsFileState, type Chop, type PersonalChop, type RunChopRequest, type RunChopResult,
	chopDigestInput, findListedChop, isChopApproved, listedChops, mergeChops, parseChopsFile, withChopApproval,
} from "../../shared/chops";
import { type AgentSetting, findAgent } from "../../shared/agent";
import { type FileChopSounds, chopSoundToPlay } from "../../shared/chop-sounds";
import type { SoundChoice } from "../../shared/sound-setting";
import type { ChopTerminals } from "./mock-terminals";

/**
 * The repository chops files of the sample repositories, by the path of the
 * main checkout, as text, read through the same parser and merge as the
 * desktop app. The sample Timber repository shares a few, the API server has
 * a damaged file, and the rest have none.
 */
export const sampleChopsFiles: Readonly<Record<string, string>> = {
	"/work/timber": `${JSON.stringify({
		version: 1,
		chops: [
			{ name: "Test", kind: "command", text: "bun test", description: "Run every test once" },
			{ name: "Dev server", kind: "command", text: "bun run dev:web", description: "The interface in a browser, with sample data" },
			{ name: "Review the diff", kind: "prompt", text: "Review the changes on this branch against main.\nList risks and missing tests, most serious first.", agent: "Claude Code" },
		],
	}, null, "\t")}\n`,
	"/work/api-server": `{ "version": 1, "chops": [ { "name": "Lint", "kind": "script", "text": "bun run lint" } ] }\n`,
};

export interface ChopsControls {
	/** Decide the text of a repository's chops file, by its main checkout, or null for no file. Heard through `onChopsChanged`, as the main process's watch would. */
	setChopsFile(repository: string, text: string | null): void;
	/** The approvals the mock keeps, by repository, as digest inputs (`chopDigestInput`). */
	chopApprovals(): ChopApprovals;
	/** The chop sounds played as chops started, oldest first: the chop's name and its sound. */
	chopSounds(): { chop: string; sound: SoundChoice }[];
}

/** The mock's chops: files by main checkout, approvals in memory, and running through the pretend terminals. */
export function createMockChops() {
	const files = new Map<string, string>(Object.entries(sampleChopsFiles));
	const listeners = new Set<(repository: string) => void>();
	let approvals: ChopApprovals = {};
	/** The chop sounds played, oldest first. */
	const played: { chop: string; sound: SoundChoice }[] = [];

	/** The answer for a repository that is listed: its file read as the desktop app reads it, merged with the saved chops. */
	function list(repository: string, personal: readonly PersonalChop[], fileSounds: FileChopSounds = {}): ChopList {
		const text = files.get(repository);
		let file: ChopsFileState = { state: "missing" };
		let chops: Chop[] = [];
		if (text !== undefined) {
			const reading = parseChopsFile(text);
			if (reading.ok) {
				file = { state: "read" };
				chops = reading.chops;
			} else {
				file = { state: "damaged", message: reading.message };
			}
		}
		return { outcome: "listed", file, path: `${repository}/${CHOPS_FILE}`, ...mergeChops(personal, repository, chops, Object.hasOwn(fileSounds, repository) ? fileSounds[repository] : []) };
	}

	/**
	 * As the main process: the chop is read once, a repository chop runs once
	 * its text is approved, a command's shell is named after it, and a prompt
	 * goes to the session named or to a new agent: the chop's, or the first
	 * saved one. Once it started, its sound plays, unless chop sounds are off.
	 */
	async function run(request: RunChopRequest, listed: ChopList, terminals: ChopTerminals, agents: readonly AgentSetting[], playChopSounds = true): Promise<RunChopResult> {
		const result = await start(request, listed, terminals, agents);
		if (result.outcome === "opened" || result.outcome === "sent") {
			const chop = findListedChop(listedChops(listed), request.chop);
			const sound = chop === null ? null : chopSoundToPlay(chop, playChopSounds);
			if (sound !== null) played.push({ chop: chop!.name, sound: structuredClone(sound) });
		}
		return result;
	}

	async function start(request: RunChopRequest, listed: ChopList, terminals: ChopTerminals, agents: readonly AgentSetting[]): Promise<RunChopResult> {
		if (listed.outcome !== "listed") return { outcome: listed.outcome === "not-listed" ? "not-listed" : "failed", message: listed.message };
		const chop = findListedChop(listedChops(listed), request.chop);
		if (chop === null) return { outcome: "no-chop", message: `No chop called "${request.chop}" is in ${request.repository} now. Nothing was started.` };
		if (request.session !== undefined && (chop.kind !== "prompt" || typeof request.session !== "string")) {
			const message = chop.kind === "prompt" ? "The request names no session. Nothing was sent." : `${chop.name} is a command, which runs in a new session only. Nothing was started.`;
			return { outcome: "no-chop", message };
		}
		let agent: AgentSetting | null = null;
		if (chop.kind === "prompt" && request.session === undefined) {
			agent = chop.agent === null ? agents[0] ?? null : findAgent(agents, chop.agent);
			if (agent === null) {
				const message = chop.agent === null ? "No agent is saved in Settings, Agents, so the prompt has no agent to go to. Copy it instead." : `No agent called "${chop.agent}" is saved in Settings, Agents, so ${chop.name} cannot start it. Nothing was started.`;
				return { outcome: "not-configured", message };
			}
		}
		// The browser has no SHA-256 to call at once; the digest input stands in, in memory only.
		const digest = chopDigestInput(chop);
		if (!isChopApproved(approvals, request.repository, chop, digest)) {
			if (request.approve !== chop.text) return { outcome: "needs-approval", chop: structuredClone(chop), path: listed.path };
			approvals = withChopApproval(approvals, request.repository, digest);
		}
		const where = { repository: request.repository, worktree: request.worktree, cols: request.cols, rows: request.rows };
		if (chop.kind === "command") return terminals.openChopTerminal(where, { kind: "command", name: chop.name, text: chop.text });
		if (agent !== null) return terminals.openChopTerminal({ ...where, agent: agent.name }, { kind: "prompt", text: chop.text });
		const sent = terminals.sendPrompt(request.session!, request.repository, request.worktree, chop.text);
		if (sent.outcome !== "pasted") return sent;
		const target = terminals.sessionById(request.session!);
		return target === null ? { outcome: "gone", message: "The session has ended." } : { outcome: "sent", session: target };
	}

	return {
		list,
		run,
		onChopsChanged(listener: (repository: string) => void) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		controls: {
			setChopsFile(repository, text) {
				if (text === null) files.delete(repository);
				else files.set(repository, text);
				const heard = [...listeners];
				void Promise.resolve().then(() => {
					for (const listener of heard) listener(repository);
				});
			},
			chopApprovals: () => structuredClone(approvals),
			chopSounds: () => structuredClone(played),
		} satisfies ChopsControls,
	};
}
