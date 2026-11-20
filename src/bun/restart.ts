import { readFile, readlink, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Launch, type RestartPlan, type RestartResult, parseEnviron, splitNul } from "../shared/restart";
import { installRootOf } from "./uninstall";

/**
 * Restarting the app from inside it, so that a preference read only at start
 * is used. Electrobun has no relaunch, so the app does it as Electrobun's
 * updater does: start a small detached waiter first, then quit. The waiter
 * waits until the launcher that started this app is gone, and then starts
 * that launcher again with the arguments, environment, and working folder it
 * had. See docs/architecture.md, "Settings that need a restart".
 *
 * Only an installed copy on Linux can: the launcher is read from /proc, and a
 * copy started from source belongs to `bun run dev` or `bun run start`, whose
 * watchers would lose track of an app started again behind their back.
 */

/** How long the waiter waits for the old app to be gone, in tenths of a second. Then it gives up rather than start a second app beside it. */
export const RESTART_WAIT_TENTHS = 200;

/**
 * The waiter: a fixed shell script, never built from input. Its arguments are
 * the launcher's pid, then the command to start. `kill -0` asks whether the
 * process is still there without signalling it.
 */
export const WAITER_SCRIPT = `pid=$1; shift; n=0; while kill -0 "$pid" 2>/dev/null; do n=$((n+1)); if [ "$n" -gt ${RESTART_WAIT_TENTHS} ]; then exit 1; fi; sleep 0.1; done; exec "$@"`;

/** A started waiter, which can be stopped when the app does not quit after all. */
export interface Waiter {
	kill(): void;
}

export interface RestarterDependencies {
	/** End every terminal and quit. Answers whether quitting started. */
	quit: () => Promise<boolean>;
	/** The executable that runs the app. In an install it is `<install>/app/bin/bun`. */
	execPath?: string;
	platform?: string;
	/** `ELECTROBUN_LAUNCHER_PID`, which Electrobun's launcher sets for the app it starts. */
	launcherPid?: string | undefined;
	/** Where processes are described, `/proc` on Linux. */
	procRoot?: string;
	/** Start the waiter, detached, with the environment and working folder given. */
	spawn?: (command: string[], options: { env: Record<string, string>; cwd: string }) => Waiter;
}

export interface Restarter {
	/** Whether this copy can restart itself. Read-only and safe to call again. */
	plan(): Promise<RestartPlan>;
	/** Start the waiter, then quit. Runs at most once at a time. */
	restart(): Promise<RestartResult>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const BY_HAND = "Quit and start it again to use the saved setting.";

/** The command the waiter runs: the shell script, then the launcher's pid and how to start it again. */
export function waiterCommand(pid: number, launch: Launch): string[] {
	return ["/bin/sh", "-c", WAITER_SCRIPT, "sh", String(pid), launch.executable, ...launch.args];
}

function spawnWaiter(command: string[], options: { env: Record<string, string>; cwd: string }): Waiter {
	// Detached, so it is in a session of its own and outlives the app. The environment goes in as the
	// process's own, never in its arguments, which every user of the machine can read.
	const child = Bun.spawn(command, { env: options.env, cwd: options.cwd, detached: true, stdio: ["ignore", "ignore", "ignore"] });
	child.unref();
	return { kill: () => child.kill() };
}

/**
 * How the launcher with this pid was started, read from `procRoot`. The
 * launcher must be the one installed beside this app: anything else, such as
 * a shell, is not started again. Its arguments, environment, and working
 * folder are taken as they were.
 */
export async function readLaunch(procRoot: string, pid: number, launcher: string): Promise<Launch | string> {
	const folder = join(procRoot, String(pid));
	let executable: string;
	try {
		executable = await readlink(join(folder, "exe"));
	} catch (error) {
		return `The app's launcher could not be read: ${messageOf(error)}`;
	}
	// The kernel names the launcher with links resolved, so compare it with the installed one resolved too.
	const installed = await realpath(launcher).catch(() => launcher);
	if (executable !== installed) return `The app was not started by its own launcher (${launcher}).`;
	try {
		const [cmdline, environ, cwd] = await Promise.all([
			readFile(join(folder, "cmdline"), "utf8"),
			readFile(join(folder, "environ"), "utf8"),
			readlink(join(folder, "cwd")),
		]);
		return { executable: launcher, args: splitNul(cmdline).slice(1), env: parseEnviron(environ), cwd };
	} catch (error) {
		return `How the app was started could not be read: ${messageOf(error)}`;
	}
}

export function createRestarter(dependencies: RestarterDependencies): Restarter {
	const execPath = dependencies.execPath ?? process.execPath;
	const platform = dependencies.platform ?? process.platform;
	const launcherPid = "launcherPid" in dependencies ? dependencies.launcherPid : process.env["ELECTROBUN_LAUNCHER_PID"];
	const procRoot = dependencies.procRoot ?? "/proc";
	const spawn = dependencies.spawn ?? spawnWaiter;
	let running = false;

	async function find(): Promise<{ pid: number; launch: Launch } | string> {
		if (platform !== "linux") return `Restarting from inside the app is built for Linux only so far. ${BY_HAND}`;
		const root = installRootOf(execPath);
		if (root === null) {
			return `This copy of the app runs from source in ${dirname(execPath)}, so it cannot restart itself. Quit it and run the command again to use the saved setting.`;
		}
		const pid = launcherPid !== undefined && /^[1-9]\d{0,9}$/.test(launcherPid) ? Number(launcherPid) : null;
		if (pid === null) return `The app could not tell which launcher started it. ${BY_HAND}`;
		const launch = await readLaunch(procRoot, pid, join(root, "app", "bin", "launcher"));
		return typeof launch === "string" ? `${launch} ${BY_HAND}` : { pid, launch };
	}

	async function restartOnce(): Promise<RestartResult> {
		let found: Awaited<ReturnType<typeof find>>;
		try {
			found = await find();
		} catch (error) {
			return { outcome: "failed", message: `How the app was started could not be read: ${messageOf(error)}` };
		}
		if (typeof found === "string") return { outcome: "unavailable", message: found };
		let waiter: Waiter;
		try {
			waiter = spawn(waiterCommand(found.pid, found.launch), { env: found.launch.env, cwd: found.launch.cwd });
		} catch (error) {
			return { outcome: "failed", message: `Could not get ready to start the app again: ${messageOf(error)}` };
		}
		let quitting: boolean;
		try {
			quitting = await dependencies.quit();
		} catch (error) {
			waiter.kill();
			return { outcome: "failed", message: `The app did not quit: ${messageOf(error)}` };
		}
		if (!quitting) {
			// Otherwise the waiter would start a second app whenever this one quits later.
			waiter.kill();
			return { outcome: "failed", message: "Something kept the app open, so it did not restart. Try again in a moment." };
		}
		return { outcome: "restarting" };
	}

	return {
		async plan() {
			const found = await find();
			return typeof found === "string" ? { available: false, reason: found } : { available: true };
		},

		async restart() {
			if (running) return { outcome: "failed", message: "The app is already restarting." };
			running = true;
			const result = await restartOnce();
			// After a quit that started, stay running: the app is going, and a second waiter would start a second app.
			if (result.outcome !== "restarting") running = false;
			return result;
		},
	};
}
