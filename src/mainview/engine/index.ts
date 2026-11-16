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
	// For the Done dialog: timberMock.setChanges(path, { modified: ["a.ts"] }),
	// timberMock.expirePreviewsAfter(5000), and timberMock.failBranchDeletion(true).
	// For Open in editor: timberMock.endEditorLaunches("not-found") or ("fails").
	// For the Changes tab: timberMock.failFileChanges("Git is busy"), or timberMock.setFileChanges(path, files).
	// For agent sessions: timberMock.missingExecutables(["codex"]) acts out an agent that is not on the PATH.
	// The billing worktree feat/tax-rules shows every kind of change.
	// A removal takes a moment here, so the running state can be seen.
	engine.setDoneDelay(900);
	Object.assign(window, { timberMock: engine });
	return engine;
}
