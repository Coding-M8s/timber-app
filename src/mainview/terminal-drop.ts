/**
 * Paths dropped on a session, as the text pasted at its prompt. Pure, so it
 * is tested without a window (see ./path-drop.ts for the drag events).
 *
 * WebKitGTK, the Linux window's webview, gives a page an empty
 * `text/uri-list` for files dragged from a file manager and writes one of
 * them, the one under the pointer, as a link's text in `text/html`. A drop
 * of several files there brings only that one path. Rows dragged from the
 * Files panel carry their paths in `FILE_PATHS_TYPE`.
 */

/** The drag data type of the absolute paths of rows dragged from the Files panel, as a JSON list. */
export const FILE_PATHS_TYPE = "application/x-timber-paths";

/** The path of a `file:` URI on this machine, decoded, or null for anything else or a broken escape. */
export function fileUriToPath(uri: string): string | null {
	const match = /^file:\/\/([^/]*)(\/.*)$/i.exec(uri.trim());
	if (!match) return null;
	const host = match[1]!.toLowerCase();
	if (host !== "" && host !== "localhost") return null;
	let path: string;
	try {
		path = decodeURIComponent(match[2]!);
	} catch {
		return null;
	}
	// A Windows drive: file:///C:/x is C:/x.
	if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** The paths in a `text/uri-list`: one URI a line, with `#` comment lines. */
export function pathsFromUriList(list: string): string[] {
	return list
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line !== "" && !line.startsWith("#"))
		.map(fileUriToPath)
		.filter((path): path is string => path !== null);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** The paths of the `file:` URIs written in html, as links' addresses or text, once each. */
export function pathsFromHtml(html: string): string[] {
	const paths: string[] = [];
	for (const [uri] of html.matchAll(/file:\/\/[^\s"<>]+/gi)) {
		const path = fileUriToPath(uri.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name: string) => ENTITIES[name]!));
		if (path !== null && !paths.includes(path)) paths.push(path);
	}
	return paths;
}

/** The app's own paths, which must be a JSON list; anything in it that is not a string is left out. */
function ownPaths(text: string): string[] {
	try {
		const value: unknown = JSON.parse(text);
		return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : [];
	} catch {
		return [];
	}
}

/**
 * The paths a drop carries, read with `getData`: the app's own first, then
 * the URI list, then the html where WebKitGTK writes its one path. Plain
 * text is never taken for a path.
 */
export function droppedPaths(getData: (type: string) => string): string[] {
	const own = getData(FILE_PATHS_TYPE);
	if (own !== "") return ownPaths(own);
	const listed = pathsFromUriList(getData("text/uri-list"));
	if (listed.length > 0) return listed;
	return pathsFromHtml(getData("text/html"));
}

/** Whether a drag, by its data types (all a page can read before the drop), carries files or paths. */
export function carriesDroppedPaths(types: readonly string[]): boolean {
	return types.includes("Files") || types.includes("text/uri-list") || types.includes(FILE_PATHS_TYPE);
}

/** Characters a POSIX shell reads as themselves. */
const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** A path as a POSIX shell word: as it is when it is plain, otherwise in single quotes. */
export function shellQuote(path: string): string {
	if (SAFE.test(path)) return path;
	return `'${path.replaceAll("'", `'\\''`)}'`;
}

/** The text pasted for dropped paths: quoted, separated by spaces, with a space after the last. Empty for none. */
export function pathsPasteText(paths: readonly string[]): string {
	return paths.length === 0 ? "" : `${paths.map(shellQuote).join(" ")} `;
}

/** The absolute path of a Files panel entry, a `/` separated path inside its worktree. */
export function worktreeFilePath(worktreePath: string, entryPath: string): string {
	const separator = worktreePath.includes("\\") && !worktreePath.includes("/") ? "\\" : "/";
	const root = worktreePath.replace(/[\\/]+$/, "");
	return `${root}${separator}${separator === "/" ? entryPath : entryPath.replaceAll("/", "\\")}`;
}
