/**
 * Words for a search path, the PATH the app was started with, in the "not
 * found" messages. Pure. A PATH can hold dozens of folders, so a message
 * names the first few and counts the rest.
 */

/** How many folders a message names before it counts the rest. */
export const SHOWN_FOLDERS = 3;

/**
 * A search path for a message: its first folders as they stand in it, then
 * how many more there are. `delimiter` is what separates the folders, `:` or,
 * on Windows, `;`.
 */
export function describeSearchPath(searchPath: string, delimiter: string): string {
	const folders = searchPath.split(delimiter).filter(folder => folder !== "");
	if (folders.length === 0) return "(empty)";
	const shown = folders.slice(0, SHOWN_FOLDERS).join(delimiter);
	const more = folders.length - SHOWN_FOLDERS;
	if (more <= 0) return shown;
	return `${shown} and ${more} more ${more === 1 ? "folder" : "folders"}`;
}

/**
 * The sentence for an executable that is not on the search path. `names` are
 * the names that were looked for, the one in the command first.
 */
export function notFoundOnPath(names: readonly string[], searchPath: string, delimiter: string): string {
	const quoted = names.map(name => `"${name}"`);
	const subject = quoted.length <= 1
		? `${quoted[0] ?? "The command"} was not found`
		: `Neither ${quoted.slice(0, -1).join(", ")} nor ${quoted[quoted.length - 1]} was found`;
	return `${subject} on the PATH the app was started with: ${describeSearchPath(searchPath, delimiter)}.`;
}
