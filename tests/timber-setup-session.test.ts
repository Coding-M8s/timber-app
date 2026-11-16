import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { Repository, TimberStatus } from "../src/shared/model";
import type { TerminalChange, TerminalOutput } from "../src/shared/terminal";

const posix = process.platform !== "win32";

async function until(check: () => boolean, milliseconds = 5000): Promise<boolean> {
	const deadline = Date.now() + milliseconds;
	while (Date.now() < deadline) {
		if (check()) return true;
		await Bun.sleep(20);
	}
	return check();
}

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

// Pseudo terminals exist on Linux and macOS only.
describe.skipIf(!posix)("timber setup in a session", () => {
	let root: string;
	let repository: string;
	let fakeTimber: string;
	let sessions: TerminalSessions;
	let outputs: TerminalOutput[];
	let changes: TerminalChange[];

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-setup-")));
		repository = join(root, "my repo");
		mkdirSync(repository);
		git(repository, "init", "-q", "-b", "main");
		// A stand-in for Timber that prints where it runs and its arguments, waits for a line as setup does, and exits.
		fakeTimber = join(root, "bin", "timber");
		mkdirSync(join(root, "bin"));
		writeFileSync(fakeTimber, `#!/bin/sh\nprintf 'timber in %s args' "$(pwd)"\nfor arg in "$@"; do printf ' [%s]' "$arg"; done\necho\nread answer\necho "saved $answer"\n`);
		chmodSync(fakeTimber, 0o755);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	afterEach(() => {
		sessions?.killAll();
	});

	const listed = (): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository",
		worktrees: [{
			id: `id:${repository}`, path: repository, canonicalPath: repository, branch: "main", head: null, primary: true, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, sync: null,
		}],
	});

	function start(timber: TimberStatus): TerminalSessions {
		outputs = [];
		changes = [];
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: output => outputs.push(output),
			onChange: change => changes.push(change),
			environment: { PATH: process.env.PATH, HOME: root, SHELL: "/bin/sh", LANG: "C.UTF-8" },
			timber: async () => timber,
			closeMilliseconds: 500,
		});
		return sessions;
	}

	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");
	const ready: () => TimberStatus = () => ({ state: "ready", path: fakeTimber, version: "0.1.1" });

	test("repository setup runs the Timber that was found, in the worktree's folder, and its end is reported", async () => {
		start(ready());
		const result = await sessions.open({ repository, worktree: repository, cols: 80, rows: 24, timberSetup: "repository" });
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		expect(result.session).toMatchObject({ kind: "timber", name: "Timber setup", shell: fakeTimber, command: `${fakeTimber} setup` });
		expect(await until(() => printed(result.session.id).includes(`timber in ${repository} args [setup]`))).toBe(true);
		sessions.write(result.session.id, "yes\r");
		expect(await until(() => changes.some(change => change.id === result.session.id && change.session?.state.kind === "exited"))).toBe(true);
		expect(printed(result.session.id)).toContain("saved yes");
		const ended = changes.findLast(change => change.id === result.session.id)!.session!;
		expect(ended.state).toEqual({ kind: "exited", exitCode: 0, signal: null });
	});

	test("machine setup adds --global, and a second one gets its own name", async () => {
		start(ready());
		const first = await sessions.open({ repository, worktree: repository, cols: 80, rows: 24, timberSetup: "machine" });
		const second = await sessions.open({ repository, worktree: repository, cols: 80, rows: 24, timberSetup: "machine" });
		if (first.outcome !== "opened" || second.outcome !== "opened") throw new Error("Not opened");
		expect(first.session.command).toBe(`${fakeTimber} setup --global`);
		expect(second.session.name).toBe("Timber setup 2");
		expect(await until(() => printed(first.session.id).includes("args [setup] [--global]"))).toBe(true);
	});

	test("nothing starts while Timber is not ready, or for a request that cannot be read", async () => {
		start({ state: "not-found", override: null });
		const missing = await sessions.open({ repository, worktree: repository, cols: 80, rows: 24, timberSetup: "repository" });
		expect(missing).toMatchObject({ outcome: "not-configured", message: expect.stringContaining("No usable Timber") });
		start(ready());
		const odd = await sessions.open({ repository, worktree: repository, cols: 80, rows: 24, timberSetup: "everything" as never });
		expect(odd.outcome).toBe("failed");
		const both = await sessions.open({ repository, worktree: repository, cols: 80, rows: 24, timberSetup: "machine", agent: "Codex" });
		expect(both.outcome).toBe("not-configured");
		const unlisted = await sessions.open({ repository: root, worktree: root, cols: 80, rows: 24, timberSetup: "machine" });
		expect(unlisted).toMatchObject({ outcome: "not-listed", message: expect.stringContaining("Timber setup was not started.") });
		expect(sessions.list()).toEqual([]);
	});
});
