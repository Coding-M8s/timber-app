import { CHOP_LIMIT, type ListedChop, sameChopName } from "./chops";
import { cleanSessionName } from "./terminal";

/**
 * The person's order of a repository's chops, and which of them are
 * favorites. Pure, so the rules can be tested without a window.
 *
 * Kept in the app's settings (the `chopOrder` preference), by the primary
 * checkout of the repository, never in the repository: a chop from
 * `.timber/chops.json` can be starred and moved, and the file never
 * changes. Chops are known by name, ignoring case, as the merged list of a
 * repository has each name once (`mergeChops` in ./chops.ts), whatever its
 * kind. One order holds both kinds, so a tab shows its own chops in it.
 *
 * The chops panel shows the favorites first, then the rest, each in the
 * saved order. A chop neither list names yet, such as a new one, goes at
 * the end of the rest, in listed order. A name not listed now, such as a
 * deleted chop or one of a damaged file, is kept while there is room, so a
 * chop made again with that name, or a file read again, gets its place and
 * its star back.
 */

export interface ChopArrangement {
	/** The favorites' names, top to bottom. */
	favorites: readonly string[];
	/** The other chops' names, top to bottom. */
	rest: readonly string[];
}

/** The arrangement of each repository, by its primary checkout. */
export type ChopArrangements = Readonly<Record<string, ChopArrangement>>;

/**
 * The most names kept for one repository, favorites and rest together:
 * every personal chop and every chop of the file.
 */
export const CHOP_ORDER_LIMIT = 2 * CHOP_LIMIT;
/**
 * The most repositories with an arrangement. An arrangement is not dropped
 * when its repository leaves the list, so a save drops the ones changed
 * longest ago past this many (`withChopArrangement`).
 */
export const CHOP_ORDER_REPOSITORY_LIMIT = 200;

export const NO_CHOP_ARRANGEMENT: ChopArrangement = { favorites: [], rest: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isName = (value: unknown): value is string => typeof value === "string" && cleanSessionName(value) === value;
const indexIn = (names: readonly string[], name: string) => names.findIndex(other => sameChopName(other, name));

/** One repository's arrangement, or undefined when any of it cannot be read: names clean, each once ignoring case, within the limit. */
function readArrangement(value: unknown): ChopArrangement | undefined {
	if (!isRecord(value)) return undefined;
	const { favorites, rest } = value;
	if (!Array.isArray(favorites) || !Array.isArray(rest) || !favorites.every(isName) || !rest.every(isName)) return undefined;
	const names = [...favorites, ...rest];
	if (names.length > CHOP_ORDER_LIMIT || names.some((name, index) => indexIn(names, name) !== index)) return undefined;
	return { favorites: [...favorites], rest: [...rest] };
}

/**
 * The arrangements from a save, or undefined when any of it cannot be
 * read, so a save never keeps half of what was asked. An empty
 * arrangement is left out.
 */
export function readChopArrangements(value: unknown): Record<string, ChopArrangement> | undefined {
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value);
	if (entries.length > CHOP_ORDER_REPOSITORY_LIMIT) return undefined;
	const arrangements: Record<string, ChopArrangement> = {};
	for (const [repository, entry] of entries) {
		const arrangement = readArrangement(entry);
		if (repository === "" || arrangement === undefined) return undefined;
		if (arrangement.favorites.length + arrangement.rest.length > 0) arrangements[repository] = arrangement;
	}
	return arrangements;
}

/**
 * What can be read of arrangements in a settings file that
 * `readChopArrangements` refused: each name that can be read, once, up to
 * the limits, so one hand edit does not cost the rest.
 */
export function salvageChopArrangements(value: unknown): Record<string, ChopArrangement> | undefined {
	if (!isRecord(value)) return undefined;
	const arrangements: Record<string, ChopArrangement> = {};
	for (const [repository, entry] of Object.entries(value)) {
		if (Object.keys(arrangements).length === CHOP_ORDER_REPOSITORY_LIMIT) break;
		if (repository === "" || !isRecord(entry)) continue;
		const seen: string[] = [];
		const keep = (list: unknown) => (Array.isArray(list) ? list : []).filter((name): name is string => {
			if (!isName(name) || indexIn(seen, name) !== -1 || seen.length === CHOP_ORDER_LIMIT) return false;
			seen.push(name);
			return true;
		});
		const favorites = keep(entry.favorites);
		const rest = keep(entry.rest);
		if (seen.length > 0) arrangements[repository] = { favorites, rest };
	}
	return arrangements;
}

/** The arrangements as written to the settings file. */
export function writeChopArrangements(arrangements: ChopArrangements): Record<string, { favorites: string[]; rest: string[] }> {
	return Object.fromEntries(Object.entries(arrangements).map(([repository, { favorites, rest }]) => [repository, { favorites: [...favorites], rest: [...rest] }]));
}

const sameNames = (one: readonly string[], other: readonly string[]) => one.length === other.length && one.every((name, index) => name === other[index]);

export function sameChopArrangements(one: ChopArrangements, other: ChopArrangements): boolean {
	const keys = Object.keys(one);
	if (keys.length !== Object.keys(other).length) return false;
	return keys.every(key => {
		const theirs = other[key];
		return theirs !== undefined && sameNames(one[key]!.favorites, theirs.favorites) && sameNames(one[key]!.rest, theirs.rest);
	});
}

/** A repository's arrangement, or an empty one. */
export function chopArrangementOf(arrangements: ChopArrangements, repository: string): ChopArrangement {
	return Object.hasOwn(arrangements, repository) ? arrangements[repository]! : NO_CHOP_ARRANGEMENT;
}

/**
 * The arrangements with one repository's replaced, or left out when it is
 * empty. The one replaced goes last, so the file keeps them from the one
 * changed longest ago to the latest, and past `CHOP_ORDER_REPOSITORY_LIMIT`
 * the oldest are dropped.
 */
export function withChopArrangement(arrangements: ChopArrangements, repository: string, arrangement: ChopArrangement): Record<string, ChopArrangement> {
	const others = Object.entries(arrangements).filter(([key]) => key !== repository);
	const kept = arrangement.favorites.length + arrangement.rest.length === 0 ? others : [...others, [repository, arrangement] as const];
	return Object.fromEntries(kept.slice(-CHOP_ORDER_REPOSITORY_LIMIT));
}

export interface ArrangedChop<Chop extends Pick<ListedChop, "name"> = ListedChop> {
	chop: Chop;
	favorite: boolean;
}

/**
 * The chops as the panel shows them: the favorites in their order, then
 * the rest in theirs, then the chops neither names, in the order given.
 */
export function arrangeChops<Chop extends Pick<ListedChop, "name">>(chops: readonly Chop[], arrangement: ChopArrangement): ArrangedChop<Chop>[] {
	const ranked = chops.map((chop, listed) => {
		const favorite = indexIn(arrangement.favorites, chop.name);
		const rest = indexIn(arrangement.rest, chop.name);
		const rank = favorite !== -1 ? favorite : rest !== -1 ? CHOP_ORDER_LIMIT + rest : 2 * CHOP_ORDER_LIMIT + listed;
		return { chop, favorite: favorite !== -1, rank };
	});
	ranked.sort((one, other) => one.rank - other.rank);
	return ranked.map(({ chop, favorite }) => ({ chop, favorite }));
}

/** Where a chop goes: into the favorites or the rest, before a chop of that part, or at its end for null. */
export interface ChopPlace {
	favorite: boolean;
	before: string | null;
}

/**
 * The arrangement once `name`, one of `chops`, is put at `place`. Both
 * lists then name every chop listed, as arranged, followed by the names
 * they held that are not listed now, kept while the limit has room.
 * Unchanged when `name` is not listed.
 */
export function placeChop(chops: readonly Pick<ListedChop, "name">[], arrangement: ChopArrangement, name: string, place: ChopPlace): ChopArrangement {
	const arranged = arrangeChops(chops, arrangement);
	const moved = arranged.find(entry => sameChopName(entry.chop.name, name));
	if (moved === undefined) return arrangement;
	const others = arranged.filter(entry => entry !== moved);
	const favorites = others.filter(entry => entry.favorite).map(entry => entry.chop.name);
	const rest = others.filter(entry => !entry.favorite).map(entry => entry.chop.name);
	const into = place.favorite ? favorites : rest;
	const at = place.before === null ? -1 : indexIn(into, place.before);
	into.splice(at === -1 ? into.length : at, 0, moved.chop.name);
	const listed = arranged.map(entry => entry.chop.name);
	let room = CHOP_ORDER_LIMIT - listed.length;
	const unlisted = (names: readonly string[]) => names.filter(other => indexIn(listed, other) === -1 && room-- > 0);
	return { favorites: [...favorites, ...unlisted(arrangement.favorites)], rest: [...rest, ...unlisted(arrangement.rest)] };
}

/** The arrangement with a chop starred, at the end of the favorites, or unstarred, at the top of the rest. */
export function toggleChopFavorite(chops: readonly Pick<ListedChop, "name">[], arrangement: ChopArrangement, name: string): ChopArrangement {
	const favorite = indexIn(arrangement.favorites, name) !== -1;
	if (favorite) {
		const top = arrangeChops(chops, arrangement).find(entry => !entry.favorite);
		return placeChop(chops, arrangement, name, { favorite: false, before: top?.chop.name ?? null });
	}
	return placeChop(chops, arrangement, name, { favorite: true, before: null });
}

/**
 * Where Alt+Up (-1) or Alt+Down (1) puts a chop: in the place of the row
 * shown next to it in its part, so it passes that row and no other, while
 * chops of the other tab, or hidden by the filter, keep their places. Null
 * at the top or the bottom of its part: a step never stars or unstars.
 * `arranged` is every listed chop, as `arrangeChops` gives them; `shown` is
 * the rows on screen, in the same order.
 */
export function stepChop(arranged: readonly ArrangedChop<Pick<ListedChop, "name">>[], shown: readonly ArrangedChop<Pick<ListedChop, "name">>[], name: string, step: -1 | 1): ChopPlace | null {
	const index = shown.findIndex(row => sameChopName(row.chop.name, name));
	if (index === -1) return null;
	const { favorite } = shown[index]!;
	const neighbor = shown[index + step];
	if (neighbor === undefined || neighbor.favorite !== favorite) return null;
	if (step === -1) return { favorite, before: neighbor.chop.name };
	const part = arranged.filter(entry => entry.favorite === favorite && !sameChopName(entry.chop.name, name));
	const after = part[part.findIndex(entry => sameChopName(entry.chop.name, neighbor.chop.name)) + 1];
	return { favorite, before: after?.chop.name ?? null };
}

/** A personal chop saved under a new name. */
export interface ChopRename {
	/** The chop's repository, or null for a chop for every repository. */
	repository: string | null;
	from: string;
	to: string;
	/**
	 * For a chop for every repository: the repositories where the person's
	 * own chop for that repository has the old or the new name, so that one
	 * is listed there and keeps its place.
	 */
	shadowed?: readonly string[];
}

/**
 * The arrangements once personal chops are renamed, all at once, so two
 * chops that swap names swap places too. In each repository a rename
 * reaches (its own, or every one for a chop for every repository, except
 * the `shadowed` ones), the old name gives its place and star to the new
 * one. The renamed chop is the one listed under its new name there, so a
 * place the new name held before, such as a deleted chop's or the file
 * chop's it now takes the place of, is dropped. A rename for the
 * repository goes before one for every repository to the same name.
 */
export function renameInArrangements(arrangements: ChopArrangements, renames: readonly ChopRename[]): Record<string, ChopArrangement> {
	const renamed: Record<string, ChopArrangement> = {};
	for (const [key, arrangement] of Object.entries(arrangements)) {
		const names = [...arrangement.favorites, ...arrangement.rest];
		const reaching = renames
			.filter(rename => (rename.repository === null ? !(rename.shadowed ?? []).includes(key) : rename.repository === key) && indexIn(names, rename.from) !== -1)
			.sort((one, other) => Number(one.repository === null) - Number(other.repository === null));
		const taken: string[] = [];
		const applied = reaching.filter(rename => {
			if (indexIn(taken, rename.to) !== -1) return false;
			taken.push(rename.to);
			return true;
		});
		if (applied.length === 0) {
			renamed[key] = arrangement;
			continue;
		}
		const renamedFrom = (name: string) => applied.find(rename => sameChopName(rename.from, name));
		// A name a rename takes is dropped where it stood, unless that name is itself renamed away.
		const swap = (list: readonly string[]) => list.flatMap(name => {
			const rename = renamedFrom(name);
			if (rename !== undefined) return [rename.to];
			return indexIn(taken, name) === -1 ? [name] : [];
		});
		renamed[key] = { favorites: swap(arrangement.favorites), rest: swap(arrangement.rest) };
	}
	return renamed;
}

/** Where a chop is now, for a screen reader: its place among the rows shown in its part. */
export function describeChopPlace(rows: readonly ArrangedChop<Pick<ListedChop, "name">>[], name: string): string {
	const row = rows.find(entry => sameChopName(entry.chop.name, name));
	if (row === undefined) return "";
	const part = rows.filter(entry => entry.favorite === row.favorite);
	const position = part.findIndex(entry => entry === row) + 1;
	return `${row.chop.name}, ${position} of ${part.length} in ${row.favorite ? "Favorites" : "Other chops"}.`;
}

/** What a step that cannot go further says. */
export function describeChopAtEnd(name: string, favorite: boolean, step: -1 | 1): string {
	return `${name} is already ${step === -1 ? "first" : "last"} in ${favorite ? "Favorites" : "Other chops"}.`;
}
