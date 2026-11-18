import { delimiter, isAbsolute } from "node:path";
import { notFoundOnPath } from "../shared/search-path";

export type ExecutableLookup =
	/** `executable` is the name that was found: the one in the command, or one of its other names. */
	| { ok: true; path: string; executable: string }
	/** The command starts with a relative path such as `./bin/tool`, whose meaning would depend on the folder. */
	| { ok: false; reason: "relative"; message: string }
	| { ok: false; reason: "not-found"; message: string };

/** Words for the messages: what is being started, and where in Settings its command is set. */
export interface ExecutableWords {
	/** Such as "the editor" or "Codex". */
	what: string;
	/** Such as "The editor command" or "The command of Codex". */
	command: string;
	/** Such as "Settings, Editor". */
	section: string;
}

/**
 * Find the executable a command starts with, as "Open in editor" and agent
 * sessions do: a name is looked for on `searchPath`, the PATH the app was
 * started with, and a full path only has to be an executable file. A
 * relative path is refused. Nothing runs.
 *
 * `otherNames` are names the same program is installed under elsewhere. They
 * are looked for, in order, only when `executable` is a name that is not on
 * the search path.
 */
export function findExecutable(executable: string, searchPath: string, words: ExecutableWords, otherNames: readonly string[] = []): ExecutableLookup {
	if (!isAbsolute(executable) && /[\\/]/.test(executable)) {
		return {
			ok: false,
			reason: "relative",
			message: `${words.command} starts with the relative path ${executable}. Use a command found on the PATH, or a full path, in ${words.section}.`,
		};
	}
	// With a full path, `Bun.which` only checks that it is an executable file.
	const resolved = Bun.which(executable, { PATH: searchPath });
	if (resolved !== null) return { ok: true, path: resolved, executable };
	if (isAbsolute(executable)) return { ok: false, reason: "not-found", message: `Could not start ${words.what}. There is no executable file at ${executable}.` };
	for (const name of otherNames) {
		const other = Bun.which(name, { PATH: searchPath });
		if (other !== null) return { ok: true, path: other, executable: name };
	}
	const where = `${notFoundOnPath([executable, ...otherNames], searchPath, delimiter)} A change to PATH needs a restart of the app, or use the full path in ${words.section}.`;
	return { ok: false, reason: "not-found", message: `Could not start ${words.what}. ${where}` };
}
