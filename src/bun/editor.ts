import { statSync } from "node:fs";
import { describeCommandLine } from "../shared/command-line";
import { editorCommand, editorSessionName, editorTarget, otherExecutableNames } from "../shared/editor";
import type { OpenInEditorRequest, OpenInEditorResult } from "../shared/model";
import type { Preferences } from "../shared/preferences";
import type { OpenTerminalRequest, OpenTerminalResult } from "../shared/terminal";
import { findExecutable, isWindowsBatch } from "./find-executable";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { signalName } from "./signal-name";
import type { AgentLaunch } from "./terminals";
import { messageOf } from "../shared/error-message";

/**
 * How long to wait after starting an editor to hear whether it stopped right
 * away with an error, such as a launcher script that cannot find the editor
 * behind it. A launcher that hands over and exits with 0 is fine.
 */
const WATCH_MILLISECONDS = 500;

export interface EditorDependencies {
	/** The preferences as saved. The editor command comes only from here, never from the interface. */
	preferences: () => Promise<Preferences>;
	/** The repository in the app's list, read again (see ./listed-worktree.ts). Asked when the kept listing is not enough. */
	findRepository: FindRepository;
	/** The repository in the app's list, perhaps from its last listing, asked first (see `RepositoryList.findKnown`). Left out, it is read again. */
	findKnownRepository?: FindRepository;
	/** The environment the app was started with. Its PATH is where the editor is looked for, and the editor gets all of it. */
	environment?: Record<string, string | undefined>;
	/** How long to watch for an editor that stops right away. Tests shorten it. */
	watchMilliseconds?: number;
	/** The operating system, as `process.platform` names it. Tests pass another. */
	platform?: NodeJS.Platform;
	/**
	 * Start an editor that runs in a terminal in a new session (see
	 * `TerminalSessions.open`). Left out where there are no terminals, and
	 * then such an editor is not started.
	 */
	openSession?: (request: OpenTerminalRequest, launch: AgentLaunch) => Promise<OpenTerminalResult>;
}

/** Opening a worktree in the person's own editor: the main process side of "Open in editor". */
export interface EditorLauncher {
	open(request: OpenInEditorRequest): Promise<OpenInEditorResult>;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
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
	return ended ? { code: child.exitCode, signal: signalName(child.signalCode) } : null;
}

/**
 * "Open in editor".
 *
 * - The command is the saved editor setting, split into an executable and
 *   arguments without a shell, with the worktree's registered path as one
 *   argument. The interface only names the worktree.
 * - Only a worktree that Timber lists, in a repository in the app's list, and
 *   whose folder is there, is opened. A file is opened in place of the folder
 *   when the request names one inside the worktree that is there.
 * - The executable is looked for on the PATH the app was started with, and
 *   then under its other names (`otherExecutableNames`), such as `zeditor`
 *   for `zed`. The answer shows the command with the name that ran. A
 *   full path works too. A relative path is refused, because what it means
 *   would depend on the folder.
 * - The editor is started detached, in its own session, with no standard
 *   input or output, and the app does not wait for it. Closing the app does
 *   not close it.
 * - An editor that runs in a terminal is started in a new session of the
 *   worktree instead, found on the PATH by the terminal sessions as above,
 *   named after its executable, with the same command shown. The answer
 *   carries the session. Each press starts another.
 * - On Windows a `.cmd` or `.bat` file is refused (see `isWindowsBatch`).
 *   VS Code's `code` on Windows is such a file.
 */
export function createEditorLauncher(dependencies: EditorDependencies): EditorLauncher {
	const { preferences, findRepository, findKnownRepository, environment = process.env, watchMilliseconds = WATCH_MILLISECONDS, platform = process.platform, openSession } = dependencies;

	async function open(request: OpenInEditorRequest): Promise<OpenInEditorResult> {
		const { editor } = await preferences();
		if (editor === null) return { outcome: "not-configured" };

		// The path is checked before any command is built from it, so no answer shows a command for a path that is not listed.
		const finders = findKnownRepository === undefined ? findRepository : { known: findKnownRepository, fresh: findRepository };
		const listed = await findListedWorktree(finders, request.repository, request.worktree, "No editor was started.");
		if (!listed.ok) return { outcome: "not-listed", message: listed.message };

		const target = editorTarget(request.worktree, request.file);
		if (!target.ok) return { outcome: "failed", command: null, message: `${target.message} No editor was started.` };
		if (request.file !== undefined && !isFile(target.path)) {
			return { outcome: "failed", command: null, message: `There is no file at ${target.path}. No editor was started.` };
		}

		const built = editorCommand(editor, target.path);
		if (!built.ok) return { outcome: "failed", command: null, message: `${built.message} Change it in Settings, Editor.` };
		const asSet = describeCommandLine([built.executable, ...built.arguments]);
		const { executable } = built;
		const words = { what: "the editor", command: "The editor command", section: "Settings, Editor" };
		if (editor.terminal) {
			if (openSession === undefined) return { outcome: "failed", command: asSet, message: "Terminals cannot run here, so an editor that runs in a terminal is not started." };
			const launch: AgentLaunch = {
				name: editorSessionName(executable), executable, arguments: built.arguments, words, section: words.section, otherNames: otherExecutableNames(executable), kind: "editor",
			};
			const started = await openSession({ repository: request.repository, worktree: request.worktree, cols: 80, rows: 24 }, launch);
			switch (started.outcome) {
				case "opened": return { outcome: "opened", command: started.session.command, session: started.session };
				case "not-listed": return { outcome: "not-listed", message: started.message };
				case "not-found": return { outcome: "not-found", command: started.command, executable: started.executable, message: started.message };
				case "failed": return { outcome: "failed", command: started.command ?? asSet, message: started.message };
				default: return { outcome: "failed", command: asSet, message: started.message };
			}
		}

		const lookup = findExecutable(executable, environment.PATH ?? "", words, otherExecutableNames(executable));
		if (!lookup.ok) {
			return lookup.reason === "relative"
				? { outcome: "failed", command: asSet, message: lookup.message }
				: { outcome: "not-found", command: asSet, executable, message: lookup.message };
		}
		const resolved = lookup.path;
		// From here on the command names the executable that was found, which may be another name of the one in the setting.
		const command = describeCommandLine([lookup.executable, ...built.arguments]);

		if (platform === "win32" && isWindowsBatch(resolved)) {
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
