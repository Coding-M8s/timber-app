import { FFIType, dlopen } from "bun:ffi";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type DmabufChoice, type RenderingStatus, decideRendering } from "../shared/rendering";
import { defaultPreferences } from "../shared/preferences";
import { parseSettings } from "../shared/settings";

/**
 * The PCI vendor ids of the graphics devices Linux lists as render nodes
 * (renderD128 and on). Empty when none can be read.
 */
export function readGraphicsVendors(drm = "/sys/class/drm"): string[] {
	try {
		return readdirSync(drm)
			.filter(name => /^renderD\d+$/.test(name))
			.sort()
			.flatMap(name => {
				try {
					return [readFileSync(join(drm, name, "device", "vendor"), "utf8").trim()];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

/**
 * The renderer choice in the settings file, read at once because WebKitGTK
 * reads its variable before anything else could. A missing or damaged file
 * gives the default; damage is reported by the usual settings reader later.
 */
export function readSavedDmabufChoice(file: string): DmabufChoice {
	try {
		return parseSettings(readFileSync(file, "utf8"))?.preferences?.dmabuf ?? defaultPreferences().dmabuf;
	} catch {
		return defaultPreferences().dmabuf;
	}
}

/**
 * Writes the variables into the process's C environment, where WebKitGTK
 * reads them with getenv. Setting process.env is not enough: Bun keeps it
 * apart from the C environment. The web processes WebKitGTK starts inherit
 * the C environment; terminals the app starts get process.env, so they do
 * not. Call before the first web view is made. Linux only.
 */
export function applyWebkitRendering(variables: Record<string, string>): void {
	const names = Object.keys(variables);
	if (names.length === 0) return;
	const libc = dlopen("libc.so.6", {
		setenv: { args: [FFIType.cstring, FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
	});
	try {
		for (const name of names) {
			// Overwrite off: a value already in the C environment wins.
			libc.symbols.setenv(Buffer.from(`${name}\0`), Buffer.from(`${variables[name]}\0`), 0);
		}
	} finally {
		libc.close();
	}
}

/** Decide the renderer from the environment, the settings file, and the graphics found, and apply it. Never throws. */
export function setUpRendering(settingsFile: string, environment = process.env, platform = process.platform): RenderingStatus {
	try {
		const choice = platform === "linux" ? readSavedDmabufChoice(settingsFile) : defaultPreferences().dmabuf;
		const { status, variables } = decideRendering(platform, environment, choice, () => readGraphicsVendors());
		applyWebkitRendering(variables);
		return status;
	} catch (error) {
		console.warn(`Could not choose how WebKitGTK draws: ${error instanceof Error ? error.message : String(error)}`);
		return { applies: false };
	}
}
