import type { Engine } from "../../shared/engine";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "./mock";

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
	return createMockEngine(sampleRepositories, timber);
}
