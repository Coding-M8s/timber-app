/**
 * The order of the repositories in the sidebar, as the person arranged it.
 * Each repository is named by the path of its primary checkout. Everything
 * here is pure.
 */

/**
 * `order` with `path` moved to `index`, counted in the order without it.
 * An index past either end clamps to that end. A path that is not in the
 * order gives the order unchanged.
 */
export function moveInOrder(order: readonly string[], path: string, index: number): string[] {
	if (!order.includes(path)) return [...order];
	const rest = order.filter(candidate => candidate !== path);
	const at = Math.min(rest.length, Math.max(0, Math.trunc(index)));
	return [...rest.slice(0, at), path, ...rest.slice(at)];
}

/**
 * `items` sorted as `order` names them. An item the order does not name keeps
 * its place relative to the other items it does not name, after all of the
 * named ones, so an order that is out of date never loses an item. Paths in
 * the order that name no item are skipped.
 */
export function applyOrder<Item extends { path: string }>(items: readonly Item[], order: readonly string[]): Item[] {
	const rank = new Map<string, number>();
	for (const path of order) {
		if (!rank.has(path)) rank.set(path, rank.size);
	}
	const named = items.filter(item => rank.has(item.path)).sort((one, other) => rank.get(one.path)! - rank.get(other.path)!);
	const others = items.filter(item => !rank.has(item.path));
	return [...named, ...others];
}

/** Whether two lists of items are in the same order of paths. */
export function sameOrder(one: readonly { path: string }[], other: readonly { path: string }[]): boolean {
	return one.length === other.length && one.every((item, index) => item.path === other[index]!.path);
}

/**
 * `paths` with `path` moved to sit just before `before`, or to the end when
 * `before` is null. A `before` that is not in `paths`, or is `path` itself,
 * counts as the end. A path that is not in `paths` gives them unchanged.
 */
export function moveBefore(paths: readonly string[], path: string, before: string | null): string[] {
	if (!paths.includes(path)) return [...paths];
	const rest = paths.filter(candidate => candidate !== path);
	const at = before === null ? -1 : rest.indexOf(before);
	return at < 0 ? [...rest, path] : [...rest.slice(0, at), path, ...rest.slice(at)];
}

/**
 * The sibling `path` goes before to move it one place, as `moveBefore` takes
 * it: undefined when it cannot move that way (first going up, last going
 * down, or not in `paths`), null for the end.
 */
export function stepBefore(paths: readonly string[], path: string, step: -1 | 1): string | null | undefined {
	const at = paths.indexOf(path);
	if (at < 0) return undefined;
	if (step === -1) return at === 0 ? undefined : paths[at - 1];
	if (at === paths.length - 1) return undefined;
	return paths[at + 2] ?? null;
}

/**
 * The whole order of a repository's worktrees after the ones in `moved`, a
 * reordering of `shown`, were arranged: `moved` first, then every other path
 * of `all` (such as an arena's attempts) in the order it had.
 */
export function orderWithShown(all: readonly string[], moved: readonly string[]): string[] {
	const named = new Set(moved);
	return [...moved, ...all.filter(path => !named.has(path))];
}
