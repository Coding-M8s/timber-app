import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { ALL_CHOPS_LABEL, EMPTY_PANE_CHOP_LIMIT, emptyPaneChops } from "../src/mainview/chop-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import type { ChopArrangement } from "../src/shared/chop-order";
import type { ChopList, ListedChop, PersonalChop } from "../src/shared/chops";

/**
 * The chop buttons of an empty session pane: at most three, in the chops
 * panel's order with the favorites first, and "All chops" when there are
 * more.
 */

const listed = (chops: ListedChop[]): ChopList => ({ outcome: "listed", file: { state: "read" }, path: "/r/.timber/chops.json", chops, overridden: [] });
const chop = (name: string, kind: ListedChop["kind"] = "command"): ListedChop => ({ name, kind, text: `run ${name}`, description: "", agent: null, source: "personal-every", sound: null });
const arrangement = (favorites: string[], rest: string[] = []): ChopArrangement => ({ favorites, rest });
const names = (result: ReturnType<typeof emptyPaneChops>) => result.chops.map(entry => entry.name);

describe("emptyPaneChops", () => {
	test("offers three", () => {
		expect(EMPTY_PANE_CHOP_LIMIT).toBe(3);
	});

	test("with no favorites, the first three in listed order, and more when there are more", () => {
		const list = listed([chop("One"), chop("Two"), chop("Three", "prompt"), chop("Four")]);
		expect(names(emptyPaneChops(list, arrangement([])))).toEqual(["One", "Two", "Three"]);
		expect(emptyPaneChops(list, arrangement([])).more).toBe(true);
	});

	test("with no favorites, the saved order of the rest decides", () => {
		const list = listed([chop("One"), chop("Two"), chop("Three"), chop("Four")]);
		expect(names(emptyPaneChops(list, arrangement([], ["Four", "Two"])))).toEqual(["Four", "Two", "One"]);
	});

	test("fewer than three chops are all offered, with nothing more", () => {
		const result = emptyPaneChops(listed([chop("One"), chop("Two", "prompt")]), arrangement(["Two"]));
		expect(names(result)).toEqual(["Two", "One"]);
		expect(result.more).toBe(false);
	});

	test("exactly three chops are all offered, with nothing more", () => {
		const result = emptyPaneChops(listed([chop("One"), chop("Two"), chop("Three")]), arrangement([]));
		expect(names(result)).toEqual(["One", "Two", "Three"]);
		expect(result.more).toBe(false);
	});

	test("fewer than three favorites come first, and the next chops in order take the other places", () => {
		const list = listed([chop("One"), chop("Two"), chop("Three"), chop("Four"), chop("Five")]);
		const result = emptyPaneChops(list, arrangement(["Four"], ["Five", "One"]));
		expect(names(result)).toEqual(["Four", "Five", "One"]);
		expect(result.more).toBe(true);
	});

	test("more than three favorites: the first three in their order", () => {
		const list = listed([chop("One"), chop("Two"), chop("Three"), chop("Four")]);
		expect(names(emptyPaneChops(list, arrangement(["Four", "Three", "Two", "One"])))).toEqual(["Four", "Three", "Two"]);
	});

	test("favorites of both kinds keep their order together, whatever their kind", () => {
		const list = listed([chop("Test"), chop("Lint"), chop("Review", "prompt"), chop("Explain", "prompt"), chop("Build")]);
		const result = emptyPaneChops(list, arrangement(["Review", "Lint", "Explain"]));
		expect(result.chops.map(entry => [entry.name, entry.kind])).toEqual([["Review", "prompt"], ["Lint", "command"], ["Explain", "prompt"]]);
	});

	test("a favorite that is no longer listed takes no place", () => {
		const list = listed([chop("One"), chop("Two"), chop("Three"), chop("Four")]);
		expect(names(emptyPaneChops(list, arrangement(["Gone", "Three"])))).toEqual(["Three", "One", "Two"]);
	});

	test("favorites are found by name ignoring case", () => {
		const list = listed([chop("One"), chop("Two"), chop("Three"), chop("Four")]);
		expect(names(emptyPaneChops(list, arrangement(["four"])))).toEqual(["Four", "One", "Two"]);
	});

	test("nothing until the list was read, or when it could not be", () => {
		expect(emptyPaneChops(null, arrangement(["One"]))).toEqual({ chops: [], more: false });
		expect(emptyPaneChops(undefined, arrangement([]))).toEqual({ chops: [], more: false });
		expect(emptyPaneChops({ outcome: "failed", message: "unreadable" } as ChopList, arrangement([]))).toEqual({ chops: [], more: false });
	});

	test("the limit can be another number", () => {
		const list = listed([chop("One"), chop("Two")]);
		expect(emptyPaneChops(list, arrangement([]), 1)).toMatchObject({ more: true });
		expect(names(emptyPaneChops(list, arrangement([]), 1))).toEqual(["One"]);
	});
});

const settle = async () => {
	for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
};
const TIMBER = "/work/timber";
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const mine = (name: string): PersonalChop => ({ name, kind: "command", text: `make ${name}`, description: "", agent: null, repository: null, sound: null });

/** The labels of the empty pane's chop buttons, in order. */
function paneButtons(store: ReturnType<typeof createAppStore>): string[] {
	const markup = renderToStaticMarkup(<App store={store} />);
	const start = markup.indexOf('<div class="empty-actions" role="group" aria-label="Chops">');
	if (start === -1) return [];
	const group = markup.slice(start, markup.indexOf("</div>", start));
	return [...group.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(match => match[1]!);
}

async function paneStore(personal: PersonalChop[] = []) {
	const engine = createMockEngine();
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	if (personal.length > 0) expect(await store.savePreferences({ chops: personal })).toMatchObject({ outcome: "saved" });
	store.select(FEATURE.id);
	await store.readChops(TIMBER);
	return { engine, store };
}

describe("the empty session pane's chops (mock engine)", () => {
	test("with three chops, each has a button and there is no \"All chops\"", async () => {
		const { store } = await paneStore();
		expect(paneButtons(store)).toEqual(["Run Test", "Run Dev server", "Send Review the diff"]);
	});

	test("with more than three, three buttons and \"All chops\"", async () => {
		const { store } = await paneStore([mine("Build"), mine("Lint")]);
		expect(paneButtons(store)).toEqual(["Run Build", "Run Lint", "Run Test", ALL_CHOPS_LABEL]);
	});

	test("starring and moving a chop change the buttons at once, before the save answers", async () => {
		const { store } = await paneStore([mine("Build"), mine("Lint")]);
		const saved = store.saveChopOrder({ [TIMBER]: { favorites: ["Review the diff", "Dev server"], rest: [] } });
		expect(paneButtons(store)).toEqual(["Send Review the diff", "Run Dev server", "Run Build", ALL_CHOPS_LABEL]);
		await saved;
		expect(paneButtons(store)).toEqual(["Send Review the diff", "Run Dev server", "Run Build", ALL_CHOPS_LABEL]);
		await store.saveChopOrder({ [TIMBER]: { favorites: ["Dev server"], rest: ["Lint"] } });
		expect(paneButtons(store)).toEqual(["Run Dev server", "Run Lint", "Run Build", ALL_CHOPS_LABEL]);
	});

	test("with \"Use chops\" off, no chop button and no \"All chops\"", async () => {
		const { store } = await paneStore([mine("Build"), mine("Lint")]);
		expect(await store.savePreferences({ useChops: false })).toMatchObject({ outcome: "saved" });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(paneButtons(store)).toEqual([]);
		expect(markup).not.toContain(`>${ALL_CHOPS_LABEL}</button>`);
		expect(markup).toContain("No session here yet");
	});
});
