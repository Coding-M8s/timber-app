import type { Engine } from "../../shared/engine";
import { browserSampleRepositories, createMockEngine, sampleTimberStatuses } from "./mock";

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
	// In a browser, ?timber=not-found or ?timber=too-old shows the notice for that state.
	const state = new URLSearchParams(location.search).get("timber");
	const timber = state !== null && Object.hasOwn(sampleTimberStatuses, state)
		? sampleTimberStatuses[state as keyof typeof sampleTimberStatuses]
		: sampleTimberStatuses.ready;
	// Acted commands take a moment here, so a dialog's running state can be seen.
	const engine = createMockEngine(browserSampleRepositories, timber, { commandMilliseconds: 1200 });
	// The browser console can act out what the main process would do, for example
	// timberMock.failReads("Git is busy"), timberMock.announceChange("/work/timber"),
	// timberMock.failTimber("/work/timber", "Not a Git repository: /work/timber"),
	// timberMock.pickFolder("/tmp") to choose what Add repository picks, or
	// timberMock.endCommands("setup-fails") to choose how timber new and timber open end.
	// For the Rebase dialog: timberMock.endRebaseResults("conflicts") chooses how timber rebase ends: "rebased", "up-to-date",
	// "conflicts", "refused", "failed", "no-result", or "unsupported".
	// For the Done dialog: timberMock.setChanges(path, { modified: ["a.ts"] }),
	// timberMock.expirePreviewsAfter(5000), and timberMock.failBranchDeletion(true).
	// For Open in editor: timberMock.endEditorLaunches("not-found") or ("fails").
	// For Uninstall in About: timberMock.endUninstalls("fails"), ("keeps-settings"), or ("unavailable").
	// For the Changes tab: timberMock.failFileChanges("Git is busy"), or timberMock.setFileChanges(path, files).
	// For themes: timberMock.setThemeImport(text) gives Import a file, and timberMock.exportedThemes() lists what Export wrote.
	// For agent sessions: timberMock.missingExecutables(["codex"]) acts out an agent that is not on the PATH.
	// For agent status: timberMock.agentStatus(id, "state=blocked:kind=permission") acts out an OSC 7501 report,
	// timberMock.notices() lists the desktop notifications, and timberMock.clickNotice(id) clicks one.
	// For fetching: timberMock.endFetches("offline"), ("authentication"), or ("failed") chooses how Fetch now ends,
	// and timberMock.forcePush("/work/timber", "main") acts out a fetch that found a rewritten upstream.
	// For Timber's settings: timberMock.setTimberConfig("/work/timber", { remote: "origin" }) acts out a change made
	// outside the app (a save based on the earlier read is then a conflict), timberMock.breakTimberConfig(path, "Invalid TOML")
	// a file Timber cannot read, and timberMock.setConnection(false) a login check that fails.
	// For workflows: timberMock.setWorkflows("/work/timber", { ok: false, message: "..." }), or null for the sample.
	// The billing worktree feat/tax-rules shows every kind of change.
	// A removal and a fetch take a moment here, so the running state can be seen.
	engine.setDoneDelay(900);
	engine.setFetchDelay(900);
	Object.assign(window, { timberMock: engine });
	return engine;
}
