import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditorLauncher } from "../src/bun/editor";
import type { PseudoTerminal, StartPseudoTerminal } from "../src/bun/pseudo-terminal";
import { LAUNCH_REUSE_MILLISECONDS, createRecentListings } from "../src/bun/recent-listings";
import { createRepositoryList } from "../src/bun/repository-list";
import type { RepositoryReader } from "../src/bun/repository-reader";
import { type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { EditorSetting } from "../src/shared/editor";
import type { Repository } from "../src/shared/model";
import { defaultPreferences } from "../src/shared/preferences";
import { serializeSettings } from "../src/shared/settings";
import { fingerprint, git } from "./support/timber";

/*
 * Opening a session or the external editor, through the chain the main process wires (see src/bun/index.ts): a reader
 * that counts its reloads, which each stand for one `timber ls`, the kept listings, the repository list on a real
 * settings file, and the terminals and editor. The worktrees are real folders of a real temporary repository; only
 * the pseudo terminal is a stand-in, so this runs on every system.
 */

let root: string;
let primary: string;
let linked: string;
let made: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-launch-")));
	primary = join(root, "sample");
	linked = join(root, "sample-worktrees", "feat-x");
	made = join(root, "sample-worktrees", "feat-y");
	mkdirSync(primary);
	git(primary, "init", "-q", "-b", "main");
	writeFileSync(join(primary, "README.md"), "hello\n");
	git(primary, "add", "README.md");
	git(primary, "commit", "-q", "-m", "first");
	git(primary, "worktree", "add", "-q", "-b", "feat/x", linked);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** A pseudo terminal that runs nothing and ends when it is closed or killed. */
const standInTerminal: StartPseudoTerminal = () => {
	let ended: { exitCode: number | null; signal: string | null } | null = null;
	let end = () => {};
	const exited = new Promise<void>(resolve => {
		end = () => {
			ended ??= { exitCode: 0, signal: null };
			resolve();
		};
	});
	const terminal: PseudoTerminal = { pid: 0, ended: () => ended, exited, drained: exited, write: () => {}, resize: () => {}, close: () => end(), kill: () => end() };
	return terminal;
};

const worktreeAt = (path: string, index: number): Repository["worktrees"][number] => ({
	id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : `feat/${index}`, head: null, primary: index === 0, detached: false,
	locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
});

let sessions: TerminalSessions | undefined;
afterEach(() => sessions?.killAll());

function setup() {
	let clock = 0;
	/** What Timber lists now. */
	let listed = [primary, linked];
	let reloads = 0;
	const reader: RepositoryReader = {
		find: async () => ({ outcome: "not-a-repository" }),
		reload: async path => {
			reloads += 1;
			return { path, name: "sample", available: true, failure: null, setup: "repository", fallbackBase: null, worktrees: listed.map(worktreeAt) };
		},
	};
	const listings = createRecentListings(reader, { now: () => clock, watching: () => 1 });
	const settingsFile = join(mkdtempSync(join(root, "config-")), "settings.json");
	writeFileSync(settingsFile, serializeSettings({ repositories: [{ path: primary, commonDir: join(primary, ".git") }] }));
	const repositories = createRepositoryList({ settingsFile, pickFolder: async () => null, reader: listings, environment: {}, warn: () => {} });
	const environment = { ...process.env };
	let editor: EditorSetting | null = null;
	sessions = createTerminalSessions({
		findRepository: path => repositories.find(path),
		findKnownRepository: path => repositories.findKnown(path),
		agents: async () => [{ name: "Prober", command: "bun" }],
		workflows: async () => ({ ok: true, workflows: [{ name: "review", description: null, agent: { kind: "command", command: "bun", args: [] } }] }),
		arenaLaunch: async request => ({ outcome: "ready", argv: ["bun"], cwd: request.worktree, environment: {}, unset: [] }),
		timber: async () => ({ state: "ready", source: "path", path: process.execPath, version: "0.2.0" }),
		onOutput: () => {},
		onChange: () => {},
		environment,
		startTerminal: standInTerminal,
		closeMilliseconds: 100,
	});
	const terminals = sessions;
	const launcher = createEditorLauncher({
		preferences: async () => ({ ...defaultPreferences(), editor }),
		findRepository: path => repositories.find(path),
		findKnownRepository: path => repositories.findKnown(path),
		environment,
		watchMilliseconds: 0,
		openSession: (request, launch) => terminals.open(request, undefined, launch),
	});
	return {
		repositories, listings, terminals, launcher,
		reloads: () => reloads,
		advance: (milliseconds: number) => void (clock += milliseconds),
		list: (paths: string[]) => void (listed = paths),
		useEditor: (setting: EditorSetting) => void (editor = setting),
	};
}

const where = (worktree: string) => ({ repository: primary, worktree, cols: 80, rows: 24 });

describe("opening a session or the editor from the kept listing", () => {
	test("a terminal, an agent, a workflow's agent, an arena attempt, and both kinds of editor run no timber ls once the sidebar has read the repository", async () => {
		const { repositories, terminals, launcher, reloads, advance, useEditor } = setup();
		// What the sidebar does on start.
		await repositories.reload(primary);
		expect(reloads()).toBe(1);
		// A while later, longer than the Changes view reuses a listing.
		advance(60_000);

		const opened = [
			await terminals.open(where(linked)),
			await terminals.open({ ...where(linked), agent: "Prober" }),
			await terminals.open({ ...where(linked), workflowAgent: { workflow: "review" } }),
			await terminals.open({ ...where(linked), arenaAttempt: { arena: "demo", attempt: "codex-1" } }),
		];
		expect(opened.map(result => result.outcome)).toEqual(["opened", "opened", "opened", "opened"]);
		useEditor({ command: "bun", terminal: true });
		expect((await launcher.open({ repository: primary, worktree: linked })).outcome).toBe("opened");
		// An external editor that is not there: the answer comes after the listing was checked.
		useEditor({ command: "no-such-editor-for-timber-app", terminal: false });
		expect((await launcher.open({ repository: primary, worktree: linked })).outcome).toBe("not-found");
		expect(reloads()).toBe(1);
	});

	test("a worktree removed outside the app is refused as not listed once the watcher heard it", async () => {
		const { repositories, listings, terminals, launcher, reloads, list, useEditor } = setup();
		await repositories.reload(primary);
		// Timber no longer lists it, its folder is still there, and the watcher reports the change.
		list([primary]);
		listings.forget(primary);
		const message = `Timber lists no worktree at ${linked} in ${primary}. No terminal was started. Refresh the list.`;
		expect(await terminals.open(where(linked))).toEqual({ outcome: "not-listed", message });
		useEditor({ command: "bun", terminal: false });
		expect(await launcher.open({ repository: primary, worktree: linked })).toEqual({
			outcome: "not-listed", message: `Timber lists no worktree at ${linked} in ${primary}. No editor was started. Refresh the list.`,
		});
		expect(terminals.list()).toEqual([]);
		// Each refusal is Timber's answer of now: one read each, as before.
		expect(reloads()).toBe(3);
	});

	test("a worktree made a moment ago, before the watcher heard it, is read again rather than refused", async () => {
		const { repositories, terminals, reloads, list } = setup();
		await repositories.reload(primary);
		git(primary, "worktree", "add", "-q", "-b", "feat/y", made);
		list([primary, linked, made]);
		expect((await terminals.open(where(made))).outcome).toBe("opened");
		expect(reloads()).toBe(2);
		git(primary, "worktree", "remove", made);
	});

	test("with no listing yet, after a change, or past the guard age, a launch reads the repository as before", async () => {
		const { repositories, listings, terminals, reloads, advance } = setup();
		expect((await terminals.open(where(linked))).outcome).toBe("opened");
		expect(reloads()).toBe(1);
		listings.forget(primary);
		expect((await terminals.open(where(linked))).outcome).toBe("opened");
		expect(reloads()).toBe(2);
		advance(LAUNCH_REUSE_MILLISECONDS);
		expect((await terminals.open(where(linked))).outcome).toBe("opened");
		expect(reloads()).toBe(3);
		// A repository not in the app's list is refused without reading anything.
		expect((await terminals.open({ ...where(linked), repository: root })).outcome).toBe("not-listed");
		expect(reloads()).toBe(3);
		await repositories.list();
		expect(reloads()).toBe(4);
	});

	test("Setup, which runs a Timber command, and every command that changes a repository still read it again", async () => {
		const { repositories, terminals, reloads } = setup();
		await repositories.reload(primary);
		expect((await terminals.open({ ...where(linked), timberWorktreeSetup: {} })).outcome).toBe("opened");
		expect(reloads()).toBe(2);
		await repositories.find(primary);
		expect(reloads()).toBe(3);
		// The Changes view and chops keep their own ten seconds.
		await repositories.findRecent(primary);
		expect(reloads()).toBe(3);
	});

	test("reads leave the repository's files and refs as they were", async () => {
		const before = fingerprint(primary);
		const { repositories, terminals } = setup();
		await repositories.reload(primary);
		await terminals.open(where(linked));
		expect(fingerprint(primary)).toEqual(before);
	});
});
