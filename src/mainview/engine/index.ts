import type { Engine } from "../../shared/engine";
import { createMockEngine } from "./mock";

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
	return createMockEngine();
}
