import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditorLauncher } from "../src/bun/editor";
import { type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import { defaultPreferences } from "../src/shared/preferences";
import type { Repository } from "../src/shared/model";
import type { TerminalOutput } from "../src/shared/terminal";
import { until } from "./support/runtime";
import { git } from "./support/timber";

const posix = process.platform !== "win32";

// The launcher against real terminal sessions, wired as src/bun/index.ts wires them.
describe.skipIf(!posix)("Open in editor with a terminal editor, through real terminal sessions", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let bin: string;
	let sessions: TerminalSessions;
	let outputs: TerminalOutput[];

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-editor-session-")));
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat login");
		bin = join(root, "editor bin");
		mkdirSync(repository, { recursive: true });
		mkdirSync(bin);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "hello\n");
		git(repository, "add", "README.md");
		git(repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "first");
		git(repository, "worktree", "add", "-q", "-b", "feat/login", worktree);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	afterEach(() => {
		sessions?.killAll();
	});

	const listed = (): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository", fallbackBase: null,
		worktrees: [repository, worktree].map((path, index) => ({
			id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : "feat/login", head: null, primary: index === 0, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
		})),
	});

	/** A pretend terminal editor in the PATH: prints its folder and arguments, then waits for a line. */
	function fakeEditor(name: string): string {
		const script = join(bin, name);
		writeFileSync(script, `#!/bin/sh\nprintf '${name} in %s args' "$(pwd)"\nfor arg in "$@"; do printf ' [%s]' "$arg"; done\necho\nread line\n`);
		chmodSync(script, 0o755);
		return script;
	}

	// A PATH of the test's own, so an editor installed on this machine is not found by mistake.
	function launcherFor(command: string) {
		outputs = [];
		const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8" };
		const findRepository = async (path: string) => path === repository ? listed() : null;
		const terminals = createTerminalSessions({ findRepository, onOutput: output => outputs.push(output), onChange: () => {}, environment, closeMilliseconds: 500 });
		sessions = terminals;
		return createEditorLauncher({
			preferences: async () => ({ ...defaultPreferences(), editor: { command, terminal: true } }),
			findRepository,
			environment,
			openSession: (request, launch) => terminals.open(request, undefined, launch),
		});
	}

	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");

	test("opens a session in the worktree, of kind editor, named after the executable, with the path as the last argument", async () => {
		const script = fakeEditor("fake-nvim");
		const result = await launcherFor("fake-nvim -p").open({ repository, worktree });
		if (result.outcome !== "opened" || result.session === undefined) throw new Error(`Not opened: ${JSON.stringify(result)}`);
		expect(result.session).toMatchObject({ kind: "editor", name: "fake-nvim", path: worktree, shell: script, state: { kind: "running" } });
		expect(await until(() => printed(result.session!.id).includes(`fake-nvim in ${worktree} args [-p] [${worktree}]`))).toBe(true);
		expect(sessions.list().map(session => session.kind)).toEqual(["editor"]);
	});

	test("a terminal editor set as zed is found as zeditor on the PATH", async () => {
		const script = fakeEditor("zeditor");
		const result = await launcherFor("zed").open({ repository, worktree });
		if (result.outcome !== "opened" || result.session === undefined) throw new Error(`Not opened: ${JSON.stringify(result)}`);
		expect(result.session).toMatchObject({ kind: "editor", path: worktree, shell: script });
		expect(await until(() => printed(result.session!.id).includes(`zeditor in ${worktree} args [${worktree}]`))).toBe(true);
	});
});
