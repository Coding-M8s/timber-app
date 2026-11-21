import {
	CHOPS_FILE, type ChopApprovals, type ChopList, type ChopsFileState, type Chop, type PersonalChop, type RunChopRequest, type RunChopResult,
	chopDigestInput, commandChops, findListedChop, isChopApproved, mergeChops, parseChopsFile, withChopApproval,
} from "../../shared/chops";
import type { OpenTerminalRequest, OpenTerminalResult } from "../../shared/terminal";

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
}

/** The mock's chops: files by main checkout, approvals in memory, and running through the pretend terminals. */
export function createMockChops() {
	const files = new Map<string, string>(Object.entries(sampleChopsFiles));
	const listeners = new Set<(repository: string) => void>();
	let approvals: ChopApprovals = {};

	/** The answer for a repository that is listed: its file read as the desktop app reads it, merged with the saved chops. */
	function list(repository: string, personal: readonly PersonalChop[]): ChopList {
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
		return { outcome: "listed", file, path: `${repository}/${CHOPS_FILE}`, ...mergeChops(personal, repository, chops) };
	}

	/** As the main process: the chop is read once, a repository chop runs once its text is approved, and the shell is named after it. */
	async function run(
		request: RunChopRequest,
		listed: ChopList,
		open: (request: OpenTerminalRequest, chop: { name: string; text: string }) => Promise<OpenTerminalResult>,
	): Promise<RunChopResult> {
		if (listed.outcome !== "listed") return { outcome: listed.outcome === "not-listed" ? "not-listed" : "failed", message: listed.message };
		const chop = findListedChop(commandChops(listed), request.chop);
		if (chop === null) return { outcome: "no-chop", message: `No command chop called "${request.chop}" is in ${request.repository} now. Nothing was started.` };
		// The browser has no SHA-256 to call at once; the digest input stands in, in memory only.
		const digest = chopDigestInput(chop);
		if (!isChopApproved(approvals, request.repository, chop, digest)) {
			if (request.approve !== chop.text) return { outcome: "needs-approval", chop: structuredClone(chop), path: listed.path };
			approvals = withChopApproval(approvals, request.repository, digest);
		}
		return open({ repository: request.repository, worktree: request.worktree, cols: request.cols, rows: request.rows }, { name: chop.name, text: chop.text });
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
		} satisfies ChopsControls,
	};
}
