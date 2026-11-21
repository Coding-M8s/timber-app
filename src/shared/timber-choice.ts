/**
 * Which Timber the app runs, as chosen in Settings, Timber, Executable. Pure.
 *
 * - `bundled`: the Timber that comes with the app, or the timber on PATH on a
 *   platform the app ships none for. The default.
 * - `path`: the timber on the PATH the app was started with.
 * - `file`: one executable, by its full path. Nothing else is tried when it
 *   does not answer.
 */
export type TimberChoice =
	| { kind: "bundled" }
	| { kind: "path" }
	| { kind: "file"; path: string };

export const TIMBER_CHOICE_KINDS = ["bundled", "path", "file"] as const;

export function defaultTimberChoice(): TimberChoice {
	return { kind: "bundled" };
}

/** Whether `path` is a full path on Windows or elsewhere, which is all a chosen file may be. */
export function isFullPath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/** The choice in `value`, or undefined when it cannot be read. A file must be a full path. */
export function readTimberChoice(value: unknown): TimberChoice | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { kind, path } = value as { kind?: unknown; path?: unknown };
	if (kind === "bundled" || kind === "path") return { kind };
	if (kind === "file" && typeof path === "string" && path.trim() === path && isFullPath(path) && !/[\0\r\n]/.test(path)) {
		return { kind, path };
	}
	return undefined;
}

export function sameTimberChoice(one: TimberChoice, other: TimberChoice): boolean {
	return one.kind === other.kind && (one.kind !== "file" || other.kind === "file" && one.path === other.path);
}

export function writeTimberChoice(choice: TimberChoice): unknown {
	return choice.kind === "file" ? { kind: choice.kind, path: choice.path } : { kind: choice.kind };
}
