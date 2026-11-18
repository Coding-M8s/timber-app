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
