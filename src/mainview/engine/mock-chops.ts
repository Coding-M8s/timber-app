import { CHOPS_FILE, type ChopList, type ChopsFileState, type Chop, type PersonalChop, mergeChops, parseChopsFile } from "../../shared/chops";

/**
 * The repository chops files of the sample worktrees, by worktree path, as
 * text, read through the same parser and merge as the desktop app. The
 * primary checkout of the sample repository shares a few, one worktree has a
 * damaged file, and the rest have none.
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
	"/work/timber-worktrees/fix-macos-portability": `{ "version": 1, "chops": [ { "name": "Lint", "kind": "script", "text": "bun run lint" } ] }\n`,
};

export interface ChopsControls {
	/** Decide the text of one worktree's chops file, by its path, or null for no file. The interface is not told. */
	setChopsFile(worktree: string, text: string | null): void;
}

/** The mock's answer for a worktree that is listed: its file read as the desktop app reads it, merged with the saved chops. */
export function createMockChops() {
	const files = new Map<string, string>(Object.entries(sampleChopsFiles));
	return {
		list(repository: string, worktree: string, personal: readonly PersonalChop[]): ChopList {
			const text = files.get(worktree);
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
			return { outcome: "listed", file, path: `${worktree}/${CHOPS_FILE}`, ...mergeChops(personal, repository, chops) };
		},
		controls: {
			setChopsFile(worktree, text) {
				if (text === null) files.delete(worktree);
				else files.set(worktree, text);
			},
		} satisfies ChopsControls,
	};
}
