import { isAbsolute } from "node:path";
import { describeCommandLine } from "../shared/command-line";
import { TERMINAL_EDITOR_REASON, editorCommand } from "../shared/editor";
import type { OpenInEditorRequest, OpenInEditorResult } from "../shared/model";
import type { Preferences } from "../shared/preferences";
import { type FindRepository, findListedWorktree } from "./listed-worktree";

/**
 * How long to wait after starting an editor to hear whether it stopped right
 * away with an error, such as a launcher script that cannot find the editor
 * behind it. A launcher that hands over and exits with 0 is fine.
 */
const WATCH_MILLISECONDS = 500;

/**
 * Windows runs a `.cmd` or `.bat` file through cmd.exe, which reads `&`, `%`,
 * and `^` in the arguments again, so a worktree path could change the command.
 * VS Code's `code` on Windows is such a file. Until launching is tested there,
 * they are refused.
 */
const WINDOWS_BATCH = /\.(cmd|bat)$/i;

export interface EditorDependencies {
	/** The preferences as saved. The editor command comes only from here, never from the interface. */
	preferences: () => Promise<Preferences>;
	/** The repository in the app's list, read again (see ./listed-worktree.ts). */
	findRepository: FindRepository;
	/** The environment the app was started with. Its PATH is where the editor is looked for, and the editor gets all of it. */
	environment?: Record<string, string | undefined>;
	/** How long to watch for an editor that stops right away. Tests shorten it. */
	watchMilliseconds?: number;
	/** The operating system, as `process.platform` names it. Tests pass another. */
	platform?: NodeJS.Platform;
}

/** Opening a worktree in the person's own editor: the main process side of "Open in editor". */
export interface EditorLauncher {
	open(request: OpenInEditorRequest): Promise<OpenInEditorResult>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Wait up to `milliseconds` for the process to end. Null when it is still running then. */
async function earlyExit(child: Bun.Subprocess, milliseconds: number): Promise<{ code: number | null; signal: string | null } | null> {
	if (milliseconds <= 0) return null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const ended = await Promise.race([
		child.exited.then(() => true),
		new Promise<false>(resolve => {
			timer = setTimeout(() => resolve(false), milliseconds);
		}),
	]);
	clearTimeout(timer);
	return ended ? { code: child.exitCode, signal: child.signalCode } : null;
}

/**
 * "Open in editor".
 *
 * - The command is the saved editor setting, split into an executable and
 *   arguments without a shell, with the worktree's registered path as one
 *   argument. The interface only names the worktree.
 * - Only a worktree that Timber lists, in a repository in the app's list, and
 *   whose folder is there, is opened.
 * - The executable is looked for on the PATH the app was started with. A
 *   full path works too. A relative path is refused, because what it means
 *   would depend on the folder.
 * - The editor is started detached, in its own session, with no standard
 *   input or output, and the app does not wait for it. Closing the app does
 *   not close it.
 * - An editor that runs in a terminal is not started: starting it in the
 *   worktree's terminal session is a later step.
 * - On Windows a `.cmd` or `.bat` file is refused (see `WINDOWS_BATCH`).
 */
export function createEditorLauncher(dependencies: EditorDependencies): EditorLauncher {
	const { preferences, findRepository, environment = process.env, watchMilliseconds = WATCH_MILLISECONDS, platform = process.platform } = dependencies;

	async function open(request: OpenInEditorRequest): Promise<OpenInEditorResult> {
		const { editor } = await preferences();
		if (editor === null) return { outcome: "not-configured" };

		// The path is checked before any command is built from it, so no answer shows a command for a path that is not listed.
		const listed = await findListedWorktree(findRepository, request.repository, request.worktree, "No editor was started.");
		if (!listed.ok) return { outcome: "not-listed", message: listed.message };

		const built = editorCommand(editor, request.worktree);
		if (!built.ok) return { outcome: "failed", command: null, message: `${built.message} Change it in Settings, Editor.` };
		const command = describeCommandLine([built.executable, ...built.arguments]);
		if (editor.terminal) return { outcome: "terminal-editor", command, message: TERMINAL_EDITOR_REASON };

		const { executable } = built;
		const searchPath = environment.PATH ?? "";
		if (!isAbsolute(executable) && /[\\/]/.test(executable)) {
			return {
				outcome: "failed",
				command,
				message: `The editor command starts with the relative path ${executable}. Use a command found on the PATH, or a full path, in Settings, Editor.`,
			};
		}
		// With a full path, `Bun.which` only checks that it is an executable file.
		const resolved = Bun.which(executable, { PATH: searchPath });
		if (resolved === null) {
			const where = isAbsolute(executable)
				? `There is no executable file at ${executable}.`
				: `"${executable}" was not found on the PATH the app was started with: ${searchPath === "" ? "(empty)" : searchPath}. A change to PATH needs a restart of the app, or use the full path in Settings, Editor.`;
			return { outcome: "not-found", command, executable, message: `Could not start the editor. ${where}` };
		}

		if (platform === "win32" && WINDOWS_BATCH.test(resolved)) {
			return {
				outcome: "failed",
				command,
				message: `${resolved} is a batch file, which Windows runs through cmd.exe. Starting editors that way is not tested on Windows yet, so the app does not do it. Use the editor's own .exe as a full path in Settings, Editor.`,
			};
		}

		let child: Bun.Subprocess;
		try {
			child = Bun.spawn([resolved, ...built.arguments], {
				cwd: request.worktree,
				env: environment,
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
				detached: true,
			});
		} catch (error) {
			return { outcome: "failed", command, message: `Could not start ${resolved}: ${messageOf(error)}` };
		}
		// The app does not wait for the editor, so the editor never keeps it running.
		child.unref();

		const exit = await earlyExit(child, watchMilliseconds);
		if (exit !== null && exit.code !== 0) {
			const how = exit.code === null ? `was stopped by ${exit.signal ?? "a signal"}` : `exited with code ${exit.code}`;
			return { outcome: "failed", command, message: `The editor ${how} right after it started. Try the command in a terminal to see why.` };
		}
		return { outcome: "opened", command };
	}

	return { open };
}
