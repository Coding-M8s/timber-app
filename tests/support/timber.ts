import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findTimber } from "../../src/bun/timber";

const windows = process.platform === "win32";
const fixtures = join(import.meta.dir, "..", "fixtures", "timber-ls");
const resultFixtures = join(import.meta.dir, "..", "fixtures", "timber-result");
const doneFixtures = join(import.meta.dir, "..", "fixtures", "timber-done");

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

/**
 * Result files recorded from `timber new ... --result-file` of Timber 0.1.1 on
 * Linux, exactly as written, except that the temporary folder it ran in is
 * written `/work`.
 *
 * - `succeeded` created the worktree feat/login (exit code 0).
 * - `failed` is the same command run again: the branch is already checked out
 *   (exit code 1).
 */
export const recordedResult = {
	succeeded: readFileSync(join(resultFixtures, "succeeded.json"), "utf8"),
	failed: readFileSync(join(resultFixtures, "failed.json"), "utf8"),
};

const doneFixture = (name: string) => readFileSync(join(doneFixtures, name), "utf8");
const configFixture = (name: string) => readFileSync(join(import.meta.dir, "..", "fixtures", "timber-config", name), "utf8");

/**
 * What `timber __app-config` of Timber's main branch (built as 0.1.2) printed
 * and wrote on Linux, exactly as it was, except that the temporary folder it
 * ran in is written `/work` and the GitHub login is written `sample-user`.
 * The machine file sets an agent. The repository `/work/sample` sets a
 * starting branch, two setup scripts (the second spans two lines), and a
 * named workflow.
 *
 * - `reads`: standard output of `read` for each scope.
 * - `results`: result files of `apply` in the repository: `saved`, `invalid`
 *   (a blank branch, an empty script, an empty editor command, and a Jira
 *   site that is not HTTPS), `conflict` (the same draft applied again with
 *   the old revision), and `refused` (the file is tracked by Git).
 * - `checks`: standard output of `check`: GitHub accepted through the GitHub
 *   CLI, Jira with no site anywhere, and Linear with a made-up key.
 */
export const recordedConfig = {
	reads: { machine: configFixture("read-machine.json"), repository: configFixture("read-repository.json") },
	results: {
		saved: configFixture("result-saved.json"),
		invalid: configFixture("result-invalid.json"),
		conflict: configFixture("result-conflict.json"),
		refused: configFixture("result-refused.json"),
	},
	checks: {
		github: configFixture("check-github-accepted.json"),
		jiraNoSite: configFixture("check-jira-no-site.json"),
		linearRejected: configFixture("check-linear-rejected.json"),
	},
};

/**
 * What `timber __ide-done` of Timber 0.1.1 printed and wrote on Linux, exactly
 * as it was, except that the temporary folder it ran in is written `/work`.
 * The repository is `/work/sample` with worktrees in `/work/sample-worktrees`.
 *
 * `previews` are standard output of `preview`:
 * - `clean`: nothing to lose.
 * - `dirty`: an edited file, a staged new file, a renamed file, untracked files
 *   (one in a folder, one with a space and non-ASCII characters), and ignored
 *   files.
 * - `ignored`: only an ignored file.
 * - `keepBranch`, `base`, `everyOption`: the clean worktree with
 *   `--keep-branch`, with `--base=main`, and with both plus `--keep-ignored`.
 * - `detached`: a detached HEAD.
 * - `unpublished`: a branch with a commit that is nowhere else. The preview
 *   does not mention it.
 *
 * `refusals` are standard error of `preview` when it exits with 1 and prints
 * no preview: the primary checkout, a locked worktree, `--keep-ignored` with
 * ignored files, a base that does not exist, the worktree's own branch as the
 * base, a path that is no worktree, and a relative path.
 *
 * `results` are result files of `apply`:
 * - `removed`: the dirty worktree was removed (exit code 0).
 * - `changed`: a file was added after the preview (exit code 1, nothing removed).
 * - `otherTarget`: the approval was for another worktree (exit code 1).
 * - `primary`: the target was the primary checkout (exit code 1, no worktree).
 * - `partial`: the folder was removed and deleting the branch failed (exit code 1).
 */
export const recordedDone = {
	previews: {
		clean: doneFixture("preview-clean.json"),
		dirty: doneFixture("preview-dirty.json"),
		ignored: doneFixture("preview-ignored.json"),
		keepBranch: doneFixture("preview-keep-branch.json"),
		base: doneFixture("preview-base.json"),
		everyOption: doneFixture("preview-keep-branch-keep-ignored-base.json"),
		detached: doneFixture("preview-detached.json"),
		unpublished: doneFixture("preview-unpublished.json"),
	},
	refusals: JSON.parse(doneFixture("refusals.json")) as Record<"primary" | "locked" | "keep-ignored" | "missing-base" | "own-base" | "not-a-worktree" | "relative-path", string>,
	results: {
		removed: doneFixture("result-removed.json"),
		changed: doneFixture("result-changed.json"),
		otherTarget: doneFixture("result-other-target.json"),
		primary: doneFixture("result-primary.json"),
		partial: doneFixture("result-partial.json"),
	},
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
 * Every file under `folder` with its size and time of last change, and what
 * Git says about the repository. Equal before and after means that nothing in
 * between changed a file, a ref, or the index.
 */
export function fingerprint(folder: string): string {
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else files.push(`${path} ${statSync(path).size} ${statSync(path).mtimeMs}`);
		}
	};
	walk(folder);
	// Without optional locks, so that looking does not itself refresh the index file.
	const run = (...args: string[]) => Bun.spawnSync(["git", "-C", folder, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).stdout.toString();
	return [...files, run("for-each-ref"), run("worktree", "list", "--porcelain"), run("status", "--porcelain"), run("ls-files", "--stage")].join("\n");
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

/** What a stand-in Timber does when it is run with `--result-file`. */
export interface StandInRun {
	/** What to write to the result file. Null leaves no file. */
	result: string | null;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	/** End by a signal instead of exiting, after writing everything above. */
	kill?: boolean;
}

/** What a stand-in noted about the latest time it was run. */
export interface StandInNotes {
	arguments: string[];
	cwd: string;
	/** The path it was given after `--result-file`, or null. */
	resultFile: string | null;
	/** Whether a file was already there, which the real Timber refuses. */
	resultFileExisted: boolean;
	/** Permission bits of the folder holding the result file, or null when there is no such folder. */
	folderMode: number | null;
	/** The path it was given after `--approval-file`, or null. */
	approvalFile: string | null;
	/** What that file held when the stand-in ran, as base64 so that every byte counts. Null when there was no file. */
	approval: string | null;
	/** Permission bits of the approval file, or null. */
	approvalMode: number | null;
	/** The path it was given after `--input-file`, or null. */
	inputFile: string | null;
	/** What that file held when the stand-in ran, as text. Null when there was no file. */
	input: string | null;
	/** Permission bits of the input file, or null. */
	inputMode: number | null;
}

const STAND_IN_SCRIPT = `
const { existsSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const run = JSON.parse(readFileSync(join(__dirname, "run.json"), "utf8"));
const given = process.argv.slice(2);
const at = given.indexOf("--result-file");
const resultFile = at === -1 ? null : given[at + 1] ?? null;
let folderMode = null;
try { if (resultFile !== null) folderMode = statSync(dirname(resultFile)).mode & 0o777; } catch {}
const approvalAt = given.indexOf("--approval-file");
const approvalFile = approvalAt === -1 ? null : given[approvalAt + 1] ?? null;
let approval = null;
let approvalMode = null;
try {
	if (approvalFile !== null) {
		approval = readFileSync(approvalFile).toString("base64");
		approvalMode = statSync(approvalFile).mode & 0o777;
	}
} catch {}
const inputAt = given.indexOf("--input-file");
const inputFile = inputAt === -1 ? null : given[inputAt + 1] ?? null;
let input = null;
let inputMode = null;
try {
	if (inputFile !== null) {
		input = readFileSync(inputFile, "utf8");
		inputMode = statSync(inputFile).mode & 0o777;
	}
} catch {}
writeFileSync(join(__dirname, "notes.json"), JSON.stringify({
	arguments: given, cwd: process.cwd(), resultFile, folderMode, approvalFile, approval, approvalMode, inputFile, input, inputMode,
	resultFileExisted: resultFile !== null && existsSync(resultFile),
}));
if (run.result !== null && resultFile !== null) writeFileSync(resultFile, run.result, { flag: "wx", mode: 0o600 });
if (run.stdout) writeFileSync(1, run.stdout);
if (run.stderr) writeFileSync(2, run.stderr);
if (run.kill) process.kill(process.pid, "SIGKILL");
else process.exit(run.exitCode ?? 0);
`;

/**
 * Put a real executable in a new folder `root/name` that acts out one run of
 * a Timber command with `--result-file`: it writes the result file as Timber
 * does (a new file, refusing one that exists), prints, and exits as told. So
 * the tests spawn an actual process, exactly as the app does. `notes` reads
 * what it was given the latest time it ran.
 */
export function standInResultTimber(root: string, name: string, run: StandInRun): { path: string; notes: () => StandInNotes } {
	const folder = join(root, name);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "run.json"), JSON.stringify(run));
	writeFileSync(join(folder, "stand-in.cjs"), STAND_IN_SCRIPT);
	const path = join(folder, windows ? "timber.cmd" : "timber");
	// The stand-in runs on the same Bun that runs the tests.
	writeFileSync(path, windows
		? `@echo off\r\n"${process.execPath}" "%~dp0stand-in.cjs" %*\r\nexit /b %errorlevel%\r\n`
		: `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/stand-in.cjs" "$@"\n`);
	if (!windows) chmodSync(path, 0o755);
	return { path, notes: () => JSON.parse(readFileSync(join(folder, "notes.json"), "utf8")) as StandInNotes };
}
