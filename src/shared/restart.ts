/**
 * Restarting the app, so that a preference read only at start is used. Pure:
 * nothing here reads a file or runs a process. See docs/architecture.md,
 * "Settings that need a restart".
 */

/** Whether this copy of the app can restart itself, and why not when it cannot. */
export type RestartPlan =
	| { available: true }
	| { available: false; reason: string };

export type RestartResult =
	/** The app is quitting, and starts again once it is gone. The answer may never arrive. */
	| { outcome: "restarting" }
	/** Nothing happened: this copy cannot restart itself. */
	| { outcome: "unavailable"; message: string }
	/** The app did not quit, so it does not start again either. */
	| { outcome: "failed"; message: string };

/**
 * How the app was started, as read from its launcher: the program, its
 * arguments after the program name, its environment, and its working folder.
 * Starting the program again with these gives the same app.
 */
export interface Launch {
	executable: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
}

/**
 * The strings of a `/proc/<pid>/cmdline` or `/proc/<pid>/environ` file: each
 * ends with a NUL. A last string without its NUL is kept.
 */
export function splitNul(text: string): string[] {
	if (text === "") return [];
	const parts = text.split("\0");
	if (parts.at(-1) === "") parts.pop();
	return parts;
}

/** An environment from `/proc/<pid>/environ`. Entries without `=` are left out; the first of a repeated name wins, as getenv finds it. */
export function parseEnviron(text: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const entry of splitNul(text)) {
		const at = entry.indexOf("=");
		if (at <= 0) continue;
		const name = entry.slice(0, at);
		if (!Object.hasOwn(env, name)) env[name] = entry.slice(at + 1);
	}
	return env;
}
