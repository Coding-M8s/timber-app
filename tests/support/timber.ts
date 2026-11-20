import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { findTimber } from "../../src/bun/timber";
import type { TimberStatus } from "../../src/shared/model";
import { windows } from "./runtime";
const fixtures = join(import.meta.dir, "..", "fixtures", "timber-ls");
const resultFixtures = join(import.meta.dir, "..", "fixtures", "timber-result");
const rebaseFixtures = join(import.meta.dir, "..", "fixtures", "timber-rebase");
const doneFixtures = join(import.meta.dir, "..", "fixtures", "timber-done");
const prFixture = (name: string) => readFileSync(join(import.meta.dir, "..", "fixtures", "timber-pr", name), "utf8");

/**
 * Output recorded from `timber ls --json` of Timber 0.1.1 on Linux, exactly
 * as printed, except that the temporary folder it ran in is written `/work`.
 *
 * - `succeeded` lists a primary checkout and six linked worktrees: a detached
 *   HEAD, one with changes and a space in a file name, one whose folder is
 *   missing, a locked one, one whose folder was replaced by a plain folder,
 *   and one with spaces and non-ASCII characters in its path and branch.
 * - `failed` is the record for a folder outside any repository (exit code 1).
 *
 * `withBases` is from Timber 0.1.2, the first release that reports each
 * worktree's saved `base`. It lists a primary checkout (no saved base) and
 * six linked worktrees: `feat/based` made with `timber new --base
 * origin/main`, `feat/local` with `--base refs/heads/main`, `feat/broken`
 * whose saved `base.json` was overwritten with text that is not JSON, `plain`
 * added with plain Git, and `gone` and `swapped` as above, which Timber
 * could not verify and so reports as stale.
 *
 * `withIssues` is from Timber's main branch after 0.1.2 (`bun
 * src/index.ts ls --json`), the first that reports each worktree's saved
 * `issue`. Saving a link needs a tracker lookup, so each `issue.json` was
 * written by hand in the form Timber saves (src/git/issue-link.ts in Timber),
 * and Timber read them back offline. It lists a primary checkout and
 * `plain` (no link), `feat/jira`, `feat/github`, and `feat/linear` (linked),
 * and `feat/broken`, whose `issue.json` is not JSON (invalid, malformed).
 */
export const recorded = {
	succeeded: readFileSync(join(fixtures, "succeeded.json"), "utf8"),
	withBases: readFileSync(join(fixtures, "with-bases.json"), "utf8"),
	withIssues: readFileSync(join(fixtures, "with-issues.json"), "utf8"),
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

/**
 * Result files recorded from `timber rebase --result-file` of Timber 0.1.2 on
 * Linux, exactly as written, except that the temporary folder it ran in is
 * written `/work`. Each ran in a new repository `/work/sample` with its
 * linked worktree `/work/sample-worktrees/feat`, with a fixed test identity.
 *
 * - `rebased`: `feat` was rebased onto `refs/heads/main`, which had a new
 *   commit (exit code 0).
 * - `upToDate`: `feat` already contained `refs/heads/main` (exit code 0).
 * - `conflicts`: both branches changed `a.txt` and `my file.txt`, so Git paused
 *   the rebase on those two files (exit code 1).
 * - `refused`: the worktree had an untracked file, so Timber refused before
 *   it did anything (exit code 1).
 * - `failedHook`: a `pre-rebase` hook rejected the rebase. The base was known
 *   and not saved (exit code 1).
 * - `failedFetch`: the base was `refs/remotes/origin/x` and `origin` could not
 *   be reached, so there was no base at all (exit code 1).
 */
export const recordedRebase = {
	rebased: readFileSync(join(rebaseFixtures, "rebased.json"), "utf8"),
	upToDate: readFileSync(join(rebaseFixtures, "up-to-date.json"), "utf8"),
	conflicts: readFileSync(join(rebaseFixtures, "conflicts.json"), "utf8"),
	refused: readFileSync(join(rebaseFixtures, "refused.json"), "utf8"),
	failedHook: readFileSync(join(rebaseFixtures, "failed-hook.json"), "utf8"),
	failedFetch: readFileSync(join(rebaseFixtures, "failed-fetch.json"), "utf8"),
};

/**
 * Result files of `timber pr --result-file` from Timber 0.1.3 on Linux, with
 * the temporary folder it ran in written `/work`. Each is for the linked
 * worktree `/work/sample-worktrees/feat` of `/work/sample`, made with `timber
 * new --base origin/main`, whose `origin` is a bare repository on disk.
 *
 * - `refusedNotGithub` and `refusedNoTitle` were recorded: Timber refused
 *   because `origin` is not on github.com, and because no title was given.
 *   Nothing was pushed (exit code 1).
 * - `created`, `exists`, `failedLogin`, and `failedAfterPush` were written by
 *   hand from `refusedNotGithub` in the form docs/ide-contract.md in Timber
 *   gives, because recording them would open a real pull request on GitHub.
 */
export const recordedPr = {
	refusedNotGithub: prFixture("refused-not-github.json"),
	refusedNoTitle: prFixture("refused-no-title.json"),
	created: prFixture("created.json"),
	exists: prFixture("exists.json"),
	failedLogin: prFixture("failed-login.json"),
	failedAfterPush: prFixture("failed-after-push.json"),
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

const appConfigFixture = (name: string) => readFileSync(join(import.meta.dir, "..", "fixtures", "timber-app-config", name), "utf8");

/**
 * What `timber __app-config read --scope repository` printed on Linux, exactly
 * as it was, except that the temporary folder it ran in is written `/work`.
 * Recorded before Timber 0.1.2, the first release with this command: these
 * come from a build of Timber's main branch at commit e1ccd00. It
 * ran with a private HOME and XDG_CONFIG_HOME and no credential variables.
 * The repository is `/work/sample`.
 *
 * The machine `config.toml` defines `review` (an agent command), `triage`
 * (`agent = false`), and `explore` (no agent, no description).
 *
 * `records` are standard output, each with exit code 0:
 * - `merged`: `.timber.toml` sets `review = false`, adds `ship` (an agent
 *   command with `wait_for_setup`), and redefines `explore` with a
 *   description. Timber lists triage, explore, ship.
 * - `inherited`: no `.timber.toml`, so the machine's three workflows.
 * - `switchedOff`: `.timber.toml` holds `workflows = false`.
 * - `none`: neither file exists.
 *
 * `failures` are standard error when it exited with 1 and printed nothing:
 * - `invalidToml`: `.timber.toml` is not TOML.
 * - `invalidConfig`: `.timber.toml` sets a workflow's agent to text.
 * - `unknownCommand`: what the released Timber 0.1.1 prints, which has no
 *   `__app-config`: a first-use hint, then the error.
 */
export const recordedAppConfig = {
	records: {
		merged: appConfigFixture("merged.json"),
		inherited: appConfigFixture("inherited.json"),
		switchedOff: appConfigFixture("switched-off.json"),
		none: appConfigFixture("none.json"),
	},
	failures: {
		invalidToml: appConfigFixture("invalid-toml.stderr"),
		invalidConfig: appConfigFixture("invalid-config.stderr"),
		unknownCommand: appConfigFixture("unknown-command-0.1.1.stderr"),
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

const backupFixture = (name: string) => readFileSync(join(import.meta.dir, "..", "fixtures", "timber-backup", name), "utf8");

/**
 * What Timber's main branch at 1e145a0 (built as 0.1.2, the first with
 * `backup list --json`, `backup restore --result-file`, and `__app-backup
 * delete`) printed and wrote on Linux, exactly, except that the temporary
 * folder it ran in is written `/work`. Each ran in a new repository
 * `/work/sample` with linked worktrees `/work/sample-worktrees/feat` and
 * `/work/sample-worktrees/two words` (branch `fix/zażółć`), and a backup of
 * each worktree and of `main`, made a second apart.
 *
 * - `list.usable`: the three backups, all usable (exit code 0).
 * - `list.mixed`: after a rebase paused on a conflict in `two words`, which
 *   protects its backup, a stray folder in backup storage, which is not
 *   usable, and `main`'s backup renamed to `.deleting-<id>`, an unfinished
 *   deletion (exit code 0).
 * - `list.failed`: run outside any repository (exit code 1).
 * - `restore.restored`: `feat`'s backup restored into `/work/sample-recovery <id>` (exit code 0).
 * - `restore.refused`: the same again; the folder exists (exit code 1).
 * - `delete.protected`: the protected backup (exit code 1).
 * - `delete.changed`: `feat`'s backup with another backup's digest (exit code 1).
 * - `delete.deleted`: `feat`'s backup with its own digest (exit code 0).
 * - `unknownCommand`: standard error of `timber backup list --json` from the
 *   released 0.1.2, which has no list (exit code 1, nothing on standard output).
 */
export const recordedBackup = {
	list: { usable: backupFixture("list-usable.json"), mixed: backupFixture("list-mixed.json"), failed: backupFixture("list-failed.json") },
	restore: { restored: backupFixture("restore-restored.json"), refused: backupFixture("restore-refused.json") },
	delete: { protected: backupFixture("delete-protected.json"), changed: backupFixture("delete-changed.json"), deleted: backupFixture("delete-deleted.json") },
	unknownCommand: backupFixture("unknown-command-0.1.2.stderr"),
};

/**
 * A recorded path under `/work`, up to the end of the path: a quote, a
 * backslash, a line break, or punctuation that follows a path in a sentence.
 * A word such as `/worktree` is not one.
 */
const RECORDED_PATH = /\/work(?![^/"\s])(?:\/[^/"\\\n,;:]*)*/g;

/**
 * A recording with its `/work` paths in place of the paths of a test, in
 * this system's form, as the real Timber prints them here: on Windows with
 * backslashes. `places` maps a recorded path to the test's own, and the
 * first that starts a recorded path is used, so list the longest first.
 * `json` says the recording is JSON, whose text needs a backslash escaped.
 * On Linux and macOS this only puts the test's folders in place.
 */
export function recordedHere(text: string, places: readonly (readonly [recorded: string, local: string])[], { json }: { json: boolean }): string {
	return text.replace(RECORDED_PATH, path => {
		const place = places.find(([recorded]) => path.startsWith(recorded));
		if (place === undefined) return path;
		const local = place[1] + path.slice(place[0].length).replaceAll("/", sep);
		return json ? JSON.stringify(local).slice(1, -1) : local;
	});
}

/**
 * How long a test that runs the installed Timber may take. On Windows a run
 * of Timber 0.1.3 takes from under a second (`timber ls`) to over four
 * (`timber backup list`), so a test that runs it several times does not
 * finish in Bun's default five seconds. Bun sets the default again for each
 * test file, so each file that runs the installed Timber calls
 * `setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS)` itself.
 */
export const REAL_TIMBER_TIMEOUT_MS = windows ? 60_000 : 5_000;

/** The Timber installed on this machine, or null. Tests that need the real one are skipped without it. */
const found = await findTimber();
export const realTimber: string | null = found.state === "ready" ? found.path : null;

/**
 * Run Git in a real temporary repository, with a fixed identity and no user
 * configuration. Automatic maintenance is off so that no background job
 * changes `.git` while a test compares it before and after.
 */
export function git(cwd: string, ...args: string[]): string {
	return gitWith({}, cwd, ...args);
}

/** `git`, with `env` added to its environment, for a test that needs other settings, such as another global config file. */
export function gitWith(env: Record<string, string>, cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=Timber Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1", ...env },
	});
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
	return result.stdout.toString();
}

/**
 * A new repository `root/name` on `main` with one commit, "Initial commit",
 * of `files` (a path inside the repository and its text). Returns its path.
 */
export function makeRepository(root: string, name: string, files: Record<string, string> = { "tracked.txt": "one\n" }): string {
	const path = join(root, name);
	git(root, "init", "--initial-branch=main", path);
	for (const [file, text] of Object.entries(files)) {
		mkdirSync(dirname(join(path, file)), { recursive: true });
		writeFileSync(join(path, file), text);
	}
	git(path, "add", ".");
	git(path, "commit", "-m", "Initial commit");
	return path;
}

/** The identity the `git` helper commits with, as environment variables, for Git run by something else, such as Timber. */
export const gitIdentity = { GIT_AUTHOR_NAME: "Timber Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Timber Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };

/**
 * An environment for running the real Timber: this process's, with a new home
 * `root/home` of its own and no user or system Git configuration, so Timber's
 * first-use marker and any user configuration stay out of the test.
 */
export function isolatedEnvironment(root: string): Record<string, string | undefined> {
	const home = join(root, "home");
	mkdirSync(home);
	return { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state"), GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" };
}

/** A Timber of `version` found ready: `ready(path)`, or `ready(path, otherVersion)`. */
export const readyAt = (version: string) => (path: string, at = version): TimberStatus => ({ state: "ready", path, version: at });

/** Timber 0.1.1 found ready at `path`. */
export const ready = readyAt("0.1.1");

/**
 * Make a new, empty folder for metadata written by hand in the form Timber
 * saves it, such as a worktree's `timber` folder. On Linux and macOS it is
 * open to this user only. On Windows Timber reads such a folder only when
 * its access list allows nobody but this user, SYSTEM, and Administrators,
 * so the folder gets that list and nothing inherited, and what is written in
 * it inherits the same. A temporary folder can allow others too, such as a
 * sandbox group.
 */
export function privateFolder(path: string): void {
	mkdirSync(path, { mode: 0o700 });
	if (!windows) return;
	const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
	const whoami = Bun.spawnSync([join(system32, "whoami.exe"), "/user", "/fo", "csv", "/nh"], { stdout: "pipe", stderr: "pipe" });
	const user = /"(S-1-[\d-]+)"/.exec(whoami.stdout.toString())?.[1];
	if (whoami.exitCode !== 0 || user === undefined) throw new Error(`whoami /user failed: ${whoami.stderr.toString()}`);
	const grants = [user, "S-1-5-18", "S-1-5-32-544"].flatMap(sid => ["/grant:r", `*${sid}:(OI)(CI)F`]);
	const icacls = Bun.spawnSync([join(system32, "icacls.exe"), path, "/inheritance:r", ...grants], { stdout: "pipe", stderr: "pipe" });
	if (icacls.exitCode !== 0) throw new Error(`icacls failed: ${icacls.stdout.toString()}${icacls.stderr.toString()}`);
}

/**
 * The folder of each worktree Git lists for the repository at `cwd`, in this
 * system's form. Git on Windows prints them with forward slashes.
 */
export function listedWorktrees(cwd: string): string[] {
	return git(cwd, "worktree", "list", "--porcelain")
		.split(/\r?\n/)
		.filter(line => line.startsWith("worktree "))
		.map(line => resolve(line.slice("worktree ".length)));
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
const run = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"));
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
writeFileSync(join(folder, "notes.json"), JSON.stringify({
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
	const path = bunStandIn(folder, STAND_IN_SCRIPT);
	return { path, notes: () => JSON.parse(readFileSync(join(folder, "notes.json"), "utf8")) as StandInNotes };
}

/** What a stand-in Timber made with `standIn` does: print, wait, and exit as told, after reading standard input to its end. */
export interface Act {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	/** Wait this long before printing, to act out a Timber that is stuck. */
	waitMs?: number;
}

const ACT_SCRIPT = `
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const act = JSON.parse(readFileSync(join(folder, "act.json"), "utf8"));
// Read standard input to its end. With input left open, this would never return.
const input = readFileSync(0);
writeFileSync(join(folder, "notes.json"), JSON.stringify({ arguments: process.argv.slice(2), cwd: process.cwd(), input: input.length }));
setTimeout(() => {
	if (act.stdout) writeFileSync(1, act.stdout);
	if (act.stderr) writeFileSync(2, act.stderr);
	process.exit(act.exitCode ?? 0);
}, act.waitMs ?? 0);
`;

/**
 * A real executable in a new folder `root/name` that acts out `act`, so the
 * tests spawn an actual process, exactly as the app does. `notes` reads what
 * it was given the latest time it ran, or null when it has not run.
 */
export function standIn(root: string, name: string, act: Act): { path: string; notes: () => { arguments: string[]; cwd: string; input: number } | null } {
	const here = join(root, name);
	mkdirSync(here, { recursive: true });
	writeFileSync(join(here, "act.json"), JSON.stringify(act));
	const path = bunStandIn(here, ACT_SCRIPT);
	const notes = join(here, "notes.json");
	return { path, notes: () => (existsSync(notes) ? JSON.parse(readFileSync(notes, "utf8")) : null) };
}

/** Each stand-in script compiled for Windows in this run of the tests, by its text. */
const compiled = new Map<string, string>();
let compiledFolder: string | null = null;

/**
 * Put a stand-in Timber in `folder` that runs `script` on the same Bun that
 * runs the tests, and return its path. The script finds the files beside the
 * stand-in in `folder`, a variable this defines, and its arguments in
 * `process.argv.slice(2)`.
 *
 * On Linux and macOS the stand-in is a shell script that starts Bun. On
 * Windows it is an executable compiled with `bun build --compile`, like the
 * installed `timber.exe`: a `.cmd` file would run through cmd.exe, which
 * refuses an argument with a line break, and stopping it would leave the Bun
 * it started running. Each script is compiled once and linked into each folder.
 */
export function bunStandIn(folder: string, script: string): string {
	if (!windows) {
		writeFileSync(join(folder, "stand-in.cjs"), `const folder = __dirname;\n${script}`);
		const path = join(folder, "timber");
		writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/stand-in.cjs" "$@"\n`);
		chmodSync(path, 0o755);
		return path;
	}
	let executable = compiled.get(script);
	if (executable === undefined) {
		if (compiledFolder === null) {
			const made = mkdtempSync(join(tmpdir(), "timber-app-stand-ins-"));
			compiledFolder = made;
			process.on("exit", () => rmSync(made, { recursive: true, force: true }));
		}
		const source = join(compiledFolder, `stand-in-${compiled.size}.cjs`);
		executable = join(compiledFolder, `stand-in-${compiled.size}.exe`);
		writeFileSync(source, `const folder = require("node:path").dirname(process.execPath);\n${script}`);
		const build = Bun.spawnSync([process.execPath, "build", "--compile", source, "--outfile", executable], { stdout: "pipe", stderr: "pipe" });
		if (build.exitCode !== 0) throw new Error(`Could not compile a stand-in Timber: ${build.stderr.toString()}`);
		compiled.set(script, executable);
	}
	const path = join(folder, "timber.exe");
	try {
		linkSync(executable, path);
	} catch {
		// A link cannot reach another drive.
		copyFileSync(executable, path);
	}
	return path;
}
