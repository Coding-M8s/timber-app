import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { UNINSTALL_ARGUMENTS, type UninstallPlan, type UninstallRequest, type UninstallResult, parseInstallRecord, uninstallTargets } from "../shared/uninstall";

/**
 * Uninstalling the app from inside the app.
 *
 * The app does not remove its own install. Electrobun's installer leaves an
 * uninstaller beside the app, with a record of what it installed, and this
 * runs that uninstaller as an executable plus an argument array, never
 * through a shell. The only thing the app deletes itself is its own settings
 * folder, which the uninstaller does not know about, and only when asked.
 *
 * Only an installed copy on Linux can do this. A copy run from a checkout
 * has no uninstaller beside it and says so.
 */

const UNINSTALLER = "uninstall";
const INSTALL_RECORD = ".electrobun-uninstall.json";
/** The uninstaller deletes a few folders. One that takes this long is stuck. */
const TIME_LIMIT_MILLISECONDS = 60_000;
/** Long enough for the answer to reach the window before the app goes. */
const QUIT_DELAY_MILLISECONDS = 400;
const OUTPUT_LIMIT = 600;

export interface UninstallRun {
	/** Null when the uninstaller was stopped for taking too long. */
	exitCode: number | null;
	/** What it printed, which holds nothing private. */
	output: string;
}

export interface UninstallerDependencies {
	/** The folder of the app's settings file. */
	settingsFolder: string;
	/** Stop saving settings and delete them. Throws when they could not be deleted. */
	forgetSettings: () => Promise<void>;
	/** End every session and quit the app, without asking. */
	quit: () => void;
	/** The executable that runs the app. In an install it is `<install>/app/bin/bun`. */
	execPath?: string;
	platform?: string;
	run?: (command: readonly string[]) => Promise<UninstallRun>;
	quitDelayMilliseconds?: number;
}

export interface Uninstaller {
	/** What uninstalling would do. Read-only and safe to call again. */
	plan(): Promise<UninstallPlan>;
	/** Run the uninstaller, forget the settings when asked, and quit. Runs at most once at a time. */
	uninstall(request: UninstallRequest): Promise<UninstallResult>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The folder of an install, given the executable that runs the app from it. Null when it does not run from an install. */
export function installRootOf(execPath: string): string | null {
	const bin = dirname(execPath);
	const app = dirname(bin);
	return basename(bin) === "bin" && basename(app) === "app" ? dirname(app) : null;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isFile();
	} catch {
		return false;
	}
}

async function runUninstaller(command: readonly string[]): Promise<UninstallRun> {
	const child = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	let stopped = false;
	const timer = setTimeout(() => {
		stopped = true;
		child.kill("SIGKILL");
	}, TIME_LIMIT_MILLISECONDS);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		return { exitCode: stopped ? null : exitCode, output: `${stdout}${stderr}`.trim() };
	} finally {
		clearTimeout(timer);
	}
}

export function createUninstaller(dependencies: UninstallerDependencies): Uninstaller {
	const execPath = dependencies.execPath ?? process.execPath;
	const platform = dependencies.platform ?? process.platform;
	const run = dependencies.run ?? runUninstaller;
	let running = false;

	async function plan(): Promise<UninstallPlan> {
		if (platform !== "linux") {
			return { available: false, reason: "Uninstalling from inside the app is built for Linux only so far." };
		}
		const root = installRootOf(execPath);
		const uninstaller = root === null ? null : join(root, UNINSTALLER);
		if (root === null || uninstaller === null || !(await isFile(uninstaller))) {
			return { available: false, reason: `This copy of the app was not installed, so there is nothing to uninstall. It runs from ${dirname(execPath)}.` };
		}
		const recordFile = join(root, INSTALL_RECORD);
		let content: string;
		try {
			content = await readFile(recordFile, "utf8");
		} catch (error) {
			return { available: false, reason: `The install record at ${recordFile} could not be read: ${messageOf(error)}` };
		}
		const record = parseInstallRecord(content);
		if (record === null) {
			return { available: false, reason: `The install record at ${recordFile} is not one this app understands.` };
		}
		const removes: string[] = [];
		for (const target of uninstallTargets(root, record)) {
			if (await exists(target)) removes.push(target);
		}
		return { available: true, command: [uninstaller, ...UNINSTALL_ARGUMENTS], removes, settingsFolder: dependencies.settingsFolder };
	}

	async function uninstall(request: UninstallRequest): Promise<UninstallResult> {
		if (running) return { outcome: "failed", message: "The uninstaller is already running." };
		running = true;
		try {
			const planned = await plan();
			if (!planned.available) return { outcome: "unavailable", message: planned.reason };

			let ended: UninstallRun;
			try {
				ended = await run(planned.command);
			} catch (error) {
				return { outcome: "failed", message: `The uninstaller could not be started: ${messageOf(error)}` };
			}
			if (ended.exitCode !== 0) {
				const how = ended.exitCode === null ? `was stopped after ${TIME_LIMIT_MILLISECONDS / 1000} seconds` : `ended with exit code ${ended.exitCode}`;
				const printed = ended.output.slice(-OUTPUT_LIMIT);
				return { outcome: "failed", message: printed === "" ? `The uninstaller ${how}.` : `The uninstaller ${how}: ${printed}` };
			}

			let settingsProblem: string | null = null;
			if (request.forgetSettings) {
				try {
					await dependencies.forgetSettings();
				} catch (error) {
					settingsProblem = messageOf(error);
				}
			}
			// With a problem to tell, the app stays open until the person has read it.
			if (settingsProblem === null) setTimeout(() => dependencies.quit(), dependencies.quitDelayMilliseconds ?? QUIT_DELAY_MILLISECONDS);
			return { outcome: "uninstalled", settingsProblem };
		} finally {
			running = false;
		}
	}

	return { plan, uninstall };
}
