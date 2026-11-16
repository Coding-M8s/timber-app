import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findTimber } from "../../src/bun/timber";

const windows = process.platform === "win32";
const fixtures = join(import.meta.dir, "..", "fixtures", "timber-ls");

/**
 * Output recorded from `timber ls --json` of Timber 0.1.1 on Linux, exactly
 * as printed, except that the temporary folder it ran in is written `/work`.
 *
 * - `succeeded` lists a primary checkout and six linked worktrees: a detached
 *   HEAD, one with changes and a space in a file name, one whose folder is
 *   missing, a locked one, one whose folder was replaced by a plain folder,
 *   and one with spaces and non-ASCII characters in its path and branch.
 * - `failed` is the record for a folder outside any repository (exit code 1).
 */
export const recorded = {
	succeeded: readFileSync(join(fixtures, "succeeded.json"), "utf8"),
	failed: readFileSync(join(fixtures, "failed.json"), "utf8"),
};

/** The Timber installed on this machine, or null. Tests that need the real one are skipped without it. */
const found = await findTimber();
export const realTimber: string | null = found.state === "ready" ? found.path : null;

/** Run Git in a real temporary repository, with a fixed identity and no user configuration. */
export function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=Timber Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" },
	});
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
	return result.stdout.toString();
}

/**
 * Put a real executable in a new folder `root/name`. Whatever it is asked, it
 * prints `output` and exits with `exitCode`, and it notes the arguments and
 * the working directory it was given in files beside itself. So the tests
 * spawn an actual process, exactly as the app does.
 */
export function standInTimber(root: string, name: string, output: string, exitCode: number): { path: string; folder: string } {
	const folder = join(root, name);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "output"), output);
	const path = join(folder, windows ? "timber.cmd" : "timber");
	writeFileSync(path, windows
		? `@echo off\r\necho %*> "%~dp0arguments"\r\ncd > "%~dp0cwd"\r\ntype "%~dp0output"\r\nexit /b ${exitCode}\r\n`
		: `#!/bin/sh\nhere="$(dirname "$0")"\nprintf '%s\\n' "$*" > "$here/arguments"\npwd > "$here/cwd"\ncat "$here/output"\nexit ${exitCode}\n`);
	if (!windows) chmodSync(path, 0o755);
	return { path, folder };
}
