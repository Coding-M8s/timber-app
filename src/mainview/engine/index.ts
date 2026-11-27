import type { Engine } from "../../shared/engine";
import { browserSampleRepositories, browserSampleTags, createMockEngine, sampleTimberStatuses } from "./mock";
import { browserSessionStorage } from "./mock-session-storage";

/**
 * Pick the engine for where the interface is running. Electrobun injects
 * `__electrobunWebviewId` into its webviews before any script runs; a plain
 * browser tab has no such value and gets sample data instead.
 */
export async function createEngine(): Promise<Engine> {
	if ("__electrobunWebviewId" in window) {
		const { createDesktopEngine } = await import("./desktop");
		return createDesktopEngine();
	}
	// In a browser, ?timber=not-found or ?timber=too-old shows the notice for that state, and ?timber=newer-release the banner.
	const state = new URLSearchParams(location.search).get("timber");
	const timber = state === "newer-release"
		? { ...sampleTimberStatuses.ready, newerRelease: "9.9.9" }
		: state !== null && Object.hasOwn(sampleTimberStatuses, state)
			? sampleTimberStatuses[state as keyof typeof sampleTimberStatuses]
			: sampleTimberStatuses.ready;
	// Acted commands take a moment here, so a dialog's running state can be seen.
	// The open sessions are kept in localStorage, so a reload acts out quitting and opening the app again.
	// The sidebar starts with worktrees of every tag, the timber header colored, and a colored group, Clients.
	const engine = createMockEngine(browserSampleRepositories, timber, { commandMilliseconds: 1200, savedSessions: browserSessionStorage(), sidebar: browserSampleTags });
	// A reload or a closed tab is the quit of the browser build.
	globalThis.addEventListener("pagehide", () => engine.saveSessionsNow());
	// The browser console can act out what the main process would do, for example
	// timberMock.failReads("Git is busy"), timberMock.announceChange("/work/timber"),
	// timberMock.failTimber("/work/timber", "Not a Git repository: /work/timber"),
	// timberMock.pickFolder("/tmp") to choose what Add repository picks, or
	// timberMock.endCommands("setup-fails") to choose how timber new and timber open end.
	// For the Rebase dialog: timberMock.endRebaseResults("conflicts") chooses how timber rebase ends: "rebased", "up-to-date",
	// "conflicts", "refused", "failed", or "no-result".
	// For Pull: timberMock.endSyncActions("diverged") chooses how a pull ends: "pulled", "fetch-failed", "diverged",
	// "local-changes", or "failed". For Push: timberMock.endSyncActions("remote-moved") chooses how a push ends: "pushed",
	// "push-up-to-date", "remote-moved", "offline", "sign-in", or "failed".
	// For the Done dialog: timberMock.setChanges(path, { modified: ["a.ts"] }),
	// timberMock.expirePreviewsAfter(5000), timberMock.failBranchDeletion(true), and
	// timberMock.setDoneDelay(3000) to close the dialog while a removal runs.
	// For Open in editor: timberMock.endEditorLaunches("not-found") or ("fails").
	// For Uninstall in About: timberMock.endUninstalls("fails"), ("keeps-settings"), or ("unavailable").
	// For Restart now after saving a setting read at start: timberMock.endRestarts("fails") or ("unavailable"), and
	// timberMock.restartCount() counts the restarts acted out. Nothing quits.
	// For the Changes view: timberMock.failFileChanges("Git is busy"), or timberMock.setFileChanges(path, files).
	// For the file viewer: timberMock.setWorktreeFile(worktree, "notes.md", "text"), { kind: "bytes", bytes: [0] }, or null for a missing file.
	// Changing the open file acts out an agent writing it: the File tab shows it within a few seconds, or, while it holds
	// unsaved edits, says it changed on disk. timberMock.delayFileSaves(2000) slows saves.
	// For themes: timberMock.setThemeImport(text) gives Import a file, and timberMock.exportedThemes() lists what Export wrote.
	// For icons: timberMock.setIconFile(bytes) gives Choose image file its bytes (else the browser's picker opens), and
	// timberMock.setRemoteIcon(path, null) acts out a repository whose origin is not on GitHub or Bitbucket.
	// For agent sessions: timberMock.missingExecutables(["codex"]) acts out an agent that is not on the PATH.
	// For timber new typed in a terminal: timberMock.typeTimberNew("/work/timber", "feat/x", true) hands a new worktree to the app.
	// For sessions after a restart: timberMock.saveSessionsNow() saves the open sessions as quitting does, a reload opens
	// them again, and timberMock.missingConversations([id]) acts out a conversation that is gone.
	// For agent status: timberMock.agentStatus(id, "state=blocked:kind=permission") acts out an OSC 7501 report,
	// timberMock.notices() lists the desktop notifications on screen, timberMock.alertSounds() the sounds played with their sessions, and timberMock.clickNotice(id) clicks one.
	// For tasks (subagents and background tasks): type subagents in a session to act out four child records, and subagents clear to clear them.
	// For fetching: timberMock.endFetches("offline"), ("authentication"), or ("failed") chooses how Fetch now ends,
	// and timberMock.forcePush("/work/timber", "main") acts out a fetch that found a rewritten upstream.
	// For Timber's settings: timberMock.setTimberConfig("/work/timber", { remote: "origin" }) acts out a change made
	// outside the app (a save based on the earlier read is then a conflict), timberMock.breakTimberConfig(path, "Invalid TOML")
	// a file Timber cannot read, and timberMock.setConnection(false) a login check that fails.
	// For workflows: timberMock.setWorkflows("/work/timber", { ok: false, message: "..." }), or null for the sample.
	// For the New worktree Tracker field: timber has GitHub and Jira, api-server GitHub only. timberMock.setGithubRemote(path, false)
	// takes GitHub away (null for the sample), and saving or removing a Jira or Linear login in Settings adds or takes away that tracker.
	// For backups: timberMock.setBackups("/work/timber", { state: "failed", message: "..." }), or null for the sample, and
	// timberMock.endBackupCommands("refused"), ("partial"), or ("no-result") chooses how a restore or delete ends.
	// For arenas: timberMock.setArenaPresets("/work/timber", [{ name: "fast", tool: "codex" }]) adds presets to New arena,
	// timberMock.endArenaCommands("setup-fails") or ("keeps") chooses how a create or pick ends, and billing has no arenas.
	// The billing worktree feat/tax-rules shows every kind of change.
	// A removal and a fetch take a moment here, so the running state can be seen.
	engine.setDoneDelay(900);
	engine.setFetchDelay(900);
	Object.assign(window, { timberMock: engine });
	return engine;
}
