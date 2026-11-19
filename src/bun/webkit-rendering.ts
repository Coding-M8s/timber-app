import { FFIType, dlopen } from "bun:ffi";

/**
 * Environment variables that choose how WebKitGTK draws the window, for
 * this platform and environment. On Linux the DMA-BUF renderer is turned
 * off: on Pop!_OS 24.04 with Intel Arc graphics under XWayland it drew the
 * interface at 13 to 40 frames a second, and without it at 57 to 60. A
 * value the person set themselves is left alone, so it can be turned back on
 * with WEBKIT_DISABLE_DMABUF_RENDERER=0. Pure, for testing.
 */
export function webkitRenderingVariables(
	platform: NodeJS.Platform,
	environment: Record<string, string | undefined>,
): Record<string, string> {
	if (platform !== "linux") return {};
	if (environment.WEBKIT_DISABLE_DMABUF_RENDERER !== undefined) return {};
	return { WEBKIT_DISABLE_DMABUF_RENDERER: "1" };
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
