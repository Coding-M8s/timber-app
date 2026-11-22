import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { Sidebar } from "../src/mainview/components/Sidebar";
import { RepositoryGroupNameView } from "../src/mainview/components/RepositoryGroupName";
import { MOVE_GROUP_HINT } from "../src/mainview/format";
import { createMockEngine, sampleRepositories, sampleUnavailableRepository } from "../src/mainview/engine/mock";
import { StoreProvider } from "../src/mainview/store/react";
import { sessionsOf } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import {
	arrangeSidebar,
	canDragRepositories,
	chooseFromRepositoryMenu,
	dropSlotsOf,
	groupDropMark,
	groupDropSlotsOf,
	groupDropTarget,
	groupNameBlurAction,
	repositoryDropMark,
	groupNameKeyAction,
	groupNeedsLook,
} from "../src/mainview/sidebar-groups";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const API_SERVER = "/work/api-server";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const primaryId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === TIMBER)!.id;
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

function elementsIn(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (Array.isArray(node)) return node.flatMap(elementsIn);
	if (typeof node !== "object" || node === null || !("props" in node)) return [];
	const element = node as ReactElement<Record<string, unknown>>;
	return [element, ...elementsIn(element.props.children as ReactNode)];
}

/** The sidebar's elements as drawn now, so a test can call a control's own handler as the browser would. */
function sidebarElements(store: ReturnType<typeof createAppStore>) {
	let elements: ReactElement<Record<string, unknown>>[] = [];
	function Probe() {
		elements = elementsIn(Sidebar());
		return null;
	}
	renderToStaticMarkup(<StoreProvider store={store}><Probe /></StoreProvider>);
	const labelled = (label: string) => elements.find(element => element.props["aria-label"] === label);
	return { elements, labelled };
}

/** The markup of the element that opens with `<tag ... aria-label="label"`, up to its end. */
function sectionOf(markup: string, label: string): string {
	const start = markup.indexOf(`aria-label="${label}"`);
	if (start === -1) return "";
	const open = markup.lastIndexOf("<section", start);
	let depth = 0;
	const pattern = /<section\b|<\/section>/g;
	pattern.lastIndex = open;
	for (let match = pattern.exec(markup); match; match = pattern.exec(markup)) {
		depth += match[0] === "</section>" ? -1 : 1;
		if (depth === 0) return markup.slice(open, match.index + match[0].length);
	}
	return markup.slice(open);
}

const key = (name: string, change: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => {
	let prevented = false;
	const event = { key: name, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...change, preventDefault: () => { prevented = true; }, currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) } };
	return { event, prevented: () => prevented };
};

// The key handlers give the focus back after a frame. This run has no window, so the frame comes at once.
beforeEach(() => {
	Object.assign(globalThis, { requestAnimationFrame: (callback: () => void) => { callback(); return 0; } });
});
afterEach(() => {
	Reflect.deleteProperty(globalThis, "requestAnimationFrame");
});

describe("with no groups", () => {
	test("the sidebar is as before, with a New group button and a More button on each repository", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).not.toContain("repository-group");
		expect(markup).toContain('aria-label="New group" title="New group"');
		expect(markup).toContain('aria-label="More for timber" title="More for timber"');
		expect(markup).toContain('aria-label="More for api-server" title="More for api-server"');
		// Remove moved into the menu.
		expect(markup).not.toContain("Remove timber from the list");
		expect(markup).not.toContain("group-remove");
		expect(markup.indexOf('aria-label="timber"')).toBeLessThan(markup.indexOf('aria-label="api-server"'));
	});

	test("the New group button comes after Refresh", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup.indexOf('aria-label="Refresh worktrees"')).toBeLessThan(markup.indexOf('aria-label="New group"'));
		expect(markup.indexOf('aria-label="New group"')).toBeLessThan(markup.indexOf('class="groups"'));
	});

	test("a missing folder still offers its Remove text button", async () => {
		const { store } = await startedStore(createMockEngine([...sampleRepositories, sampleUnavailableRepository]));
		expect(render(store)).toMatch(/class="text-button"[^>]*>Remove</);
	});
});

describe("groups in the sidebar", () => {
	test("loose repositories come first, then each group holding its repositories", async () => {
		const { store } = await startedStore();
		await store.createGroup("Work", TIMBER);
		await store.createGroup("Empty");
		const markup = render(store);
		const work = sectionOf(markup, "Group Work");
		expect(work).toContain('class="repository-group"');
		expect(work).toContain('aria-label="timber"');
		expect(work).not.toContain('aria-label="api-server"');
		expect(work).toMatch(/class="repository-group-header" aria-expanded="true"[^>]*>.*?Work/);
		expect(markup.indexOf('aria-label="api-server"')).toBeLessThan(markup.indexOf('aria-label="Group Work"'));
		// An empty group is shown too, with nothing under its header.
		expect(sectionOf(markup, "Group Empty")).toContain('class="repository-group-count">0<');
		expect(sectionOf(markup, "Group Empty")).not.toContain("repository-group-members");
		expect(markup).toContain('aria-label="More for group Work"');
	});

	test("a header click folds its group, which is remembered, and hides its repositories", async () => {
		const { store } = await startedStore();
		await store.createGroup("Work", TIMBER);
		const header = sidebarElements(store).elements.find(element => element.props.className === "repository-group-header")!;
		(header.props.onClick as () => void)();
		expect(store.getState().layout.collapsedGroups).toEqual(["group-1"]);
		const markup = render(store);
		expect(sectionOf(markup, "Group Work")).toContain('aria-expanded="false"');
		expect(markup).not.toContain('aria-label="timber"');
		expect(markup).toContain('aria-label="api-server"');
		// A native button: Enter and Space click it, so the keyboard folds it the same way.
		expect(header.type).toBe("button");
	});

	test("a folded group says when a repository in it needs a look", async () => {
		const { store } = await startedStore(createMockEngine([...sampleRepositories, sampleUnavailableRepository]));
		await store.createGroup("Old", sampleUnavailableRepository.path);
		store.toggleRepositoryGroup("group-1");
		const markup = sectionOf(render(store), "Group Old");
		expect(markup).toContain('title="A repository in this group needs a look."');
		expect(markup).toMatch(/class="group-flag repository-group-check"[^>]*>check</);
		// Open, the repository says it itself.
		store.toggleRepositoryGroup("group-1");
		expect(sectionOf(render(store), "Group Old")).not.toContain("repository-group-check");
	});

	test("a folded group sums up the agents of its repositories", async () => {
		const { store, engine } = await startedStore();
		store.select(featureId);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, agent: "Codex" });
		await settle();
		store.select(primaryId);
		await settle();
		engine.agentStatus(sessionsOf(store.getState(), featureId)[0]!.id, "state=blocked");
		await settle();
		await store.createGroup("Work", TIMBER);
		expect(sectionOf(render(store), "Group Work")).not.toContain("repository-group-status");
		store.toggleRepositoryGroup("group-1");
		const markup = sectionOf(render(store), "Group Work");
		expect(markup).toContain('<span class="group-status repository-group-status status-needs-you" aria-hidden="true">1 needs you</span>');
		expect(markup).toContain(">Agents: 1 needs you.</span>");
	});

	test("Alt+Down on a group header swaps it with the next group and gives it the keyboard back", async () => {
		const { store } = await startedStore();
		await store.createGroup("Work");
		await store.createGroup("Personal");
		const header = sidebarElements(store).elements.find(element => element.props.className === "repository-group-header" && String(element.props.title).startsWith("Work"))!;
		expect(header.props.title).toBe(`Work. ${MOVE_GROUP_HINT}`);
		const press = key("ArrowDown", { altKey: true });
		(header.props.onKeyDown as (event: unknown) => void)(press.event);
		expect(press.prevented()).toBe(true);
		await settle();
		expect(store.getState().repositoryGroups.groups.map(group => group.name)).toEqual(["Personal", "Work"]);
	});

	test("Alt+Down on a repository header moves it among its siblings only", async () => {
		const { store } = await startedStore();
		await store.createGroup("Work", TIMBER);
		const header = sidebarElements(store).elements.find(element => element.props.className === "group-header" && String(element.props.title).startsWith("timber"))!;
		(header.props.onKeyDown as (event: unknown) => void)(key("ArrowUp", { altKey: true }).event);
		await settle();
		// timber is the only one in Work, so there is nowhere to go, and it stays in Work.
		expect(store.getState().repositoryGroups.membership).toEqual({ [TIMBER]: "group-1" });
		expect(store.getState().repositories.map(repository => repository.path)).toEqual([API_SERVER, TIMBER]);
	});

	test("Shift+F10 on a repository header opens its menu instead of the browser's", async () => {
		const { store } = await startedStore();
		const header = sidebarElements(store).elements.find(element => element.props.className === "group-header" && String(element.props.title).startsWith("timber"))!;
		const press = key("F10", { shiftKey: true });
		(header.props.onKeyDown as (event: unknown) => void)(press.event);
		expect(press.prevented()).toBe(true);
		const plain = key("F10");
		(header.props.onKeyDown as (event: unknown) => void)(plain.event);
		expect(plain.prevented()).toBe(false);
	});
});

describe("subgroups in the sidebar", () => {
	/** Work holds timber and Client, which holds api-server. */
	async function nestedStore(engine = createMockEngine()) {
		const started = await startedStore(engine);
		await started.store.createGroup("Work", TIMBER);
		await started.store.createGroup("Client", API_SERVER, "group-1");
		return started;
	}

	test("a subgroup is drawn inside its group, after the group's own repositories, and the count takes in both", async () => {
		const { store } = await nestedStore();
		expect(store.getState().repositoryGroups.groups).toEqual([{ id: "group-1", name: "Work" }, { id: "group-2", name: "Client", parent: "group-1" }]);
		const markup = render(store);
		const work = sectionOf(markup, "Group Work");
		const client = sectionOf(markup, "Group Client");
		expect(work).toContain(client);
		expect(client).toContain('aria-label="api-server"');
		expect(client).not.toContain('aria-label="timber"');
		expect(work.indexOf('aria-label="timber"')).toBeLessThan(work.indexOf('aria-label="Group Client"'));
		expect(work).toMatch(/class="repository-group-count">2</);
		expect(client).toMatch(/class="repository-group-count">1</);
	});

	test("folding the parent hides its subgroups, and each subgroup is folded on its own", async () => {
		const { store } = await nestedStore();
		store.toggleRepositoryGroup("group-2");
		let markup = render(store);
		expect(sectionOf(markup, "Group Work")).toContain('aria-label="timber"');
		expect(sectionOf(markup, "Group Client")).not.toContain('aria-label="api-server"');
		store.toggleRepositoryGroup("group-1");
		markup = render(store);
		expect(markup).not.toContain('aria-label="Group Client"');
		expect(store.getState().layout.collapsedGroups).toEqual(["group-2", "group-1"]);
		// Opening the parent again shows the subgroup still folded.
		store.toggleRepositoryGroup("group-1");
		expect(sectionOf(render(store), "Group Client")).toContain('aria-expanded="false"');
	});

	test("a folded group says when a repository in one of its subgroups needs a look", async () => {
		const { store } = await startedStore(createMockEngine([...sampleRepositories, sampleUnavailableRepository]));
		await store.createGroup("Work");
		await store.createGroup("Old", sampleUnavailableRepository.path, "group-1");
		store.toggleRepositoryGroup("group-1");
		expect(sectionOf(render(store), "Group Work")).toMatch(/class="group-flag repository-group-check"[^>]*>check</);
	});

	test("Alt+Down on a subgroup's header moves it among the groups with the same parent only", async () => {
		const { store } = await nestedStore();
		await store.createGroup("Other", undefined, "group-1");
		await store.createGroup("Personal");
		const header = sidebarElements(store).elements.find(element => element.props.className === "repository-group-header" && String(element.props.title).startsWith("Client"))!;
		(header.props.onKeyDown as (event: unknown) => void)(key("ArrowDown", { altKey: true }).event);
		await settle();
		const inWork = () => store.getState().repositoryGroups.groups.filter(group => group.parent === "group-1").map(group => group.name);
		expect(inWork()).toEqual(["Other", "Client"]);
		expect(store.getState().repositoryGroups.groups.filter(group => group.parent === undefined).map(group => group.name)).toEqual(["Work", "Personal"]);
		(header.props.onKeyDown as (event: unknown) => void)(key("ArrowDown", { altKey: true }).event);
		await settle();
		// At the end of its siblings it stays, and never leaves Work.
		expect(inWork()).toEqual(["Other", "Client"]);
	});

	test("a move into itself, into its subgroup, past three levels, or beside its name is refused with a notice, and nothing is saved", async () => {
		const { store, engine } = await nestedStore();
		await store.createGroup("Deep", undefined, "group-2");
		await store.createGroup("Personal");
		const saved = structuredClone(store.getState().repositoryGroups);
		await store.moveGroup("group-1", "group-2", null);
		expect(store.getState().notice).toEqual({ kind: "group-refused", reason: "inside-itself" });
		await store.moveGroup("group-1", "group-1", null);
		expect(store.getState().notice).toEqual({ kind: "group-refused", reason: "inside-itself" });
		await store.moveGroup("group-4", "group-3", null);
		expect(store.getState().notice).toEqual({ kind: "group-refused", reason: "too-deep" });
		// A second Personal, inside Work, keeps the top-level one out of Work.
		await store.createGroup("personal", undefined, "group-1");
		await store.moveGroup("group-4", "group-1", null);
		expect(store.getState().notice).toEqual({ kind: "group-refused", reason: "name-taken", name: "personal" });
		expect(render(store)).toContain("There is already a group named personal there.");
		expect((await engine.listRepositoryGroups()).groups.filter(group => group.id !== "group-5")).toEqual(saved.groups);
		// A move that is allowed clears the notice and is saved.
		await store.moveGroup("group-3", null, null);
		expect(store.getState().notice).toBeNull();
		expect((await engine.listRepositoryGroups()).groups.find(group => group.id === "group-3")).toEqual({ id: "group-3", name: "Deep" });
	});

	test("deleting a group moves its repositories and subgroups up a level and keeps them in the list", async () => {
		const { store } = await nestedStore();
		await store.createGroup("Deep", undefined, "group-2");
		await store.deleteGroup("group-2");
		expect(store.getState().repositoryGroups).toEqual({ groups: [{ id: "group-1", name: "Work" }, { id: "group-3", name: "Deep", parent: "group-1" }], membership: { [TIMBER]: "group-1", [API_SERVER]: "group-1" } });
		await store.deleteGroup("group-1");
		expect(store.getState().repositoryGroups).toEqual({ groups: [{ id: "group-3", name: "Deep" }], membership: {} });
		expect(store.getState().repositories.map(repository => repository.path).sort()).toEqual([API_SERVER, TIMBER].sort());
	});
});

describe("arrangeSidebar", () => {
	const row = (path: string, matches: string[] = ["x"]) => ({ repository: { path }, matches });
	const groups = { groups: [{ id: "work", name: "Work" }, { id: "home", name: "Home" }], membership: { "/b": "work", "/c": "home" } };

	test("without a filter, a group is open unless folded", () => {
		const arranged = arrangeSidebar([row("/a"), row("/b"), row("/c")], groups, ["home"], "");
		expect(arranged.loose.map(item => item.repository.path)).toEqual(["/a"]);
		expect(arranged.grouped.map(({ group, open, items }) => ({ id: group.id, open, items: items.map(item => item.repository.path) }))).toEqual([
			{ id: "work", open: true, items: ["/b"] },
			{ id: "home", open: false, items: ["/c"] },
		]);
	});

	test("while a filter is typed, a folded group with a match opens, and a group with none is not shown", () => {
		const arranged = arrangeSidebar([row("/a"), row("/b", []), row("/c")], groups, ["home", "work"], "feat");
		expect(arranged.grouped.map(({ group, open }) => ({ id: group.id, open }))).toEqual([{ id: "home", open: true }]);
	});
});

describe("groupNeedsLook", () => {
	const repository = (path: string, change: object = {}) => ({ path, available: true, failure: null, ...change });

	test("is true for a removal, a failed listing, or a missing folder in the group", () => {
		const repositories = [repository("/a"), repository("/b", { failure: "Timber failed" }), repository("/c", { available: false })];
		expect(groupNeedsLook({ repositories, removals: [] }, ["/a"])).toBe(false);
		expect(groupNeedsLook({ repositories, removals: [] }, ["/b"])).toBe(true);
		expect(groupNeedsLook({ repositories, removals: [] }, ["/c"])).toBe(true);
		expect(groupNeedsLook({ repositories, removals: [{ repository: "/a" }] }, ["/a"])).toBe(true);
		expect(groupNeedsLook({ repositories, removals: [{ repository: "/a" }] }, [])).toBe(false);
	});
});

describe("the name field", () => {
	test("Enter saves, Escape cancels, and other keys type", () => {
		expect(groupNameKeyAction("Enter")).toBe("submit");
		expect(groupNameKeyAction("Escape")).toBe("cancel");
		expect(groupNameKeyAction("a")).toBeNull();
	});

	test("leaving it cancels when empty or unchanged, and saves otherwise", () => {
		expect(groupNameBlurAction("  ", "")).toBe("cancel");
		expect(groupNameBlurAction("Work", "Work")).toBe("cancel");
		expect(groupNameBlurAction("Work", "")).toBe("submit");
		expect(groupNameBlurAction("Job", "Work")).toBe("submit");
		// Enter or Escape already answered: the field is going, so leaving it does nothing more.
		expect(groupNameBlurAction("Job", "Work", true)).toBe("nothing");
		expect(groupNameBlurAction("", "", true, null)).toBe("nothing");
		// A refused name still shows its reason: leaving the field puts it away, so it is never left behind.
		expect(groupNameBlurAction("", "", true, "Type a name for the group.")).toBe("cancel");
		expect(groupNameBlurAction("work", "", true, "There is already a group named Work.")).toBe("cancel");
	});

	test("is labelled, limited to the longest name, and says a problem under it", () => {
		const fresh = renderToStaticMarkup(<RepositoryGroupNameView label="Name of the new group" value="" problem={null} idBase="n" />);
		expect(fresh).toContain('aria-label="Name of the new group"');
		expect(fresh).toContain('placeholder="Group name"');
		expect(fresh).toContain('maxLength="40"');
		expect(fresh).not.toContain('role="alert"');
		const refused = renderToStaticMarkup(<RepositoryGroupNameView label="New name for Work" value="" problem="Type a name for the group." idBase="n" />);
		expect(refused).toContain('aria-describedby="n-problem"');
		expect(refused).toContain('<p id="n-problem" class="repository-group-name-problem" role="alert">Type a name for the group.</p>');
	});

	test("New group shows the field as a group at the end", async () => {
		const { store } = await startedStore();
		const button = sidebarElements(store).labelled("New group")!;
		expect(button.props["aria-haspopup"]).toBeUndefined();
		expect(typeof button.props.onClick).toBe("function");
	});
});

describe("choosing from a repository's menu", () => {
	test("Add to puts it in the group, Take out makes it loose, and Remove takes it off the list", async () => {
		const { store } = await startedStore();
		await store.createGroup("Work");
		const naming: (string | undefined)[] = [];
		chooseFromRepositoryMenu(store, TIMBER, { kind: "place", group: "group-1" }, repository => naming.push(repository));
		await settle();
		expect(store.getState().repositoryGroups.membership).toEqual({ [TIMBER]: "group-1" });
		expect(sectionOf(render(store), "Group Work")).toContain('aria-label="timber"');
		chooseFromRepositoryMenu(store, TIMBER, { kind: "take-out" }, repository => naming.push(repository));
		await settle();
		expect(store.getState().repositoryGroups.membership).toEqual({});
		chooseFromRepositoryMenu(store, TIMBER, { kind: "new-group" }, repository => naming.push(repository));
		expect(naming).toEqual([TIMBER]);
		chooseFromRepositoryMenu(store, TIMBER, { kind: "remove" }, repository => naming.push(repository));
		await settle();
		expect(store.getState().repositories.map(repository => repository.path)).toEqual([API_SERVER]);
		// The group stays.
		expect(store.getState().repositoryGroups.groups.map(group => group.name)).toEqual(["Work"]);
	});

	test("its More button opens a menu", async () => {
		const { store } = await startedStore();
		const more = sidebarElements(store).labelled("More for timber")!;
		expect(more.props["aria-haspopup"]).toBe("menu");
	});
});

describe("dragging", () => {
	test("is on with two repositories, or with one and a group", () => {
		expect(canDragRepositories(1, 0)).toBe(false);
		expect(canDragRepositories(2, 0)).toBe(true);
		expect(canDragRepositories(1, 1)).toBe(true);
	});

	test("the places to drop are the sections and group headers shown, without the dragged one", () => {
		const arranged = {
			loose: [{ repository: { path: "/a" } }, { repository: { path: "/b" } }],
			grouped: [
				{ group: { id: "work", name: "Work" }, open: true, items: [{ repository: { path: "/c" } }], children: [] },
				{ group: { id: "home", name: "Home" }, open: false, items: [{ repository: { path: "/d" } }], children: [] },
			],
		};
		const boxes: Record<string, { top: number; height: number }> = {
			"/a": { top: 0, height: 20 }, "/b": { top: 20, height: 20 }, "group:work": { top: 40, height: 20 }, "/c": { top: 60, height: 20 }, "group:home": { top: 80, height: 20 },
		};
		expect(dropSlotsOf(arranged, "/b", name => boxes[name])).toEqual([
			{ kind: "repository", path: "/a", group: null, middle: 10 },
			{ kind: "group", id: "work", top: 40, bottom: 60, open: true },
			{ kind: "repository", path: "/c", group: "work", middle: 70 },
			{ kind: "group", id: "home", top: 80, bottom: 100, open: false },
		]);
	});
});

describe("the mark of a dragged repository's drop", () => {
	const row = (path: string) => ({ repository: { path } });
	const work = { id: "g-work", name: "Work" };
	const personal = { id: "g-personal", name: "Personal" };
	const arranged = {
		loose: [row("/a"), row("/b")],
		grouped: [{ group: work, items: [row("/c"), row("/d")], children: [] }, { group: personal, items: [], children: [] }],
	};

	test("is before the section it lands before, in the loose list or in a group", () => {
		expect(repositoryDropMark(arranged, "/b", { group: null, before: "/a" })).toEqual({ kind: "repository", path: "/a", side: "before" });
		expect(repositoryDropMark(arranged, "/a", { group: "g-work", before: "/d" })).toEqual({ kind: "repository", path: "/d", side: "before" });
	});

	test("is around the group it lands at the end of, an empty one too", () => {
		expect(repositoryDropMark(arranged, "/a", { group: "g-work", before: null })).toEqual({ kind: "into", group: "g-work" });
		expect(repositoryDropMark(arranged, "/c", { group: "g-personal", before: null })).toEqual({ kind: "into", group: "g-personal" });
	});

	test("is after the last other loose section at the end of the loose list", () => {
		expect(repositoryDropMark(arranged, "/a", { group: null, before: null })).toEqual({ kind: "repository", path: "/b", side: "after" });
		expect(repositoryDropMark(arranged, "/c", { group: null, before: null })).toEqual({ kind: "repository", path: "/b", side: "after" });
	});

	test("is above the first group when a grouped repository leaves and no loose one shows", () => {
		const onlyGroups = { loose: [], grouped: arranged.grouped };
		expect(repositoryDropMark(onlyGroups, "/c", { group: null, before: null })).toEqual({ kind: "above-group", group: "g-work" });
	});

	test("is nothing while it would land where it already is", () => {
		expect(repositoryDropMark(arranged, "/b", { group: null, before: null })).toBeNull();
		expect(repositoryDropMark(arranged, "/a", { group: null, before: "/b" })).toBeNull();
		expect(repositoryDropMark(arranged, "/d", { group: "g-work", before: null })).toBeNull();
		expect(repositoryDropMark(arranged, "/c", { group: "g-work", before: "/d" })).toBeNull();
	});

	test("is nothing with nowhere to show it", () => {
		expect(repositoryDropMark({ loose: [row("/a")], grouped: [] }, "/a", { group: null, before: null })).toBeNull();
	});

	test("finds a subgroup's repositories, and its end, at any depth", () => {
		const client = { id: "g-client", name: "Client", parent: "g-work" };
		const nested = { loose: [row("/a")], grouped: [{ group: work, items: [row("/c")], children: [{ group: client, items: [row("/e")], children: [] }] }] };
		expect(repositoryDropMark(nested, "/a", { group: "g-client", before: "/e" })).toEqual({ kind: "repository", path: "/e", side: "before" });
		expect(repositoryDropMark(nested, "/a", { group: "g-client", before: null })).toEqual({ kind: "into", group: "g-client" });
		expect(repositoryDropMark(nested, "/e", { group: "g-client", before: null })).toBeNull();
	});
});

describe("nested groups", () => {
	const row = (path: string, matches: string[] = ["x"]) => ({ repository: { path }, matches });
	// Work holds /b and Client, which holds /c and Deep, which holds /d. Home holds /e.
	const groups = {
		groups: [
			{ id: "work", name: "Work" },
			{ id: "home", name: "Home" },
			{ id: "client", name: "Client", parent: "work" },
			{ id: "deep", name: "Deep", parent: "client" },
		],
		membership: { "/b": "work", "/c": "client", "/d": "deep", "/e": "home" },
	};
	const rows = [row("/a"), row("/b"), row("/c"), row("/d"), row("/e")];
	const shape = (shown: readonly { group: { id: string }; open: boolean; items: readonly { repository: { path: string } }[]; children: readonly unknown[]; paths: readonly string[] }[]): unknown =>
		shown.map(({ group, open, items, children, paths }) => ({ id: group.id, open, items: items.map(item => item.repository.path), paths, children: shape(children as never) }));

	test("a group holds its repositories first, then its subgroups, each folded on its own", () => {
		const arranged = arrangeSidebar(rows, groups, ["client"], "");
		expect(arranged.loose.map(item => item.repository.path)).toEqual(["/a"]);
		expect(shape(arranged.grouped)).toEqual([
			{ id: "work", open: true, items: ["/b"], paths: ["/b", "/c", "/d"], children: [
				{ id: "client", open: false, items: ["/c"], paths: ["/c", "/d"], children: [
					{ id: "deep", open: true, items: ["/d"], paths: ["/d"], children: [] },
				] },
			] },
			{ id: "home", open: true, items: ["/e"], paths: ["/e"], children: [] },
		]);
	});

	test("while a filter is typed, a group opens when anything inside it matches, at any depth", () => {
		const filtered = [row("/a", []), row("/b", []), row("/c", []), row("/d"), row("/e", [])];
		const arranged = arrangeSidebar(filtered, groups, ["work", "client", "deep"], "feat");
		expect(shape(arranged.grouped)).toEqual([
			{ id: "work", open: true, items: ["/b"], paths: ["/b", "/c", "/d"], children: [
				{ id: "client", open: true, items: ["/c"], paths: ["/c", "/d"], children: [
					{ id: "deep", open: true, items: ["/d"], paths: ["/d"], children: [] },
				] },
			] },
		]);
	});

	test("the places to drop a repository walk into open subgroups only", () => {
		const arranged = arrangeSidebar(rows, groups, ["deep"], "");
		const boxes: Record<string, { top: number; height: number }> = {
			"/a": { top: 0, height: 20 }, "group:work": { top: 20, height: 20 }, "/b": { top: 40, height: 20 }, "group:client": { top: 60, height: 20 },
			"/c": { top: 80, height: 20 }, "group:deep": { top: 100, height: 20 }, "group:home": { top: 120, height: 20 }, "/e": { top: 140, height: 20 },
		};
		expect(dropSlotsOf(arranged, "/a", name => boxes[name]).map(slot => (slot.kind === "group" ? `group ${slot.id}` : `${slot.path} in ${slot.group}`))).toEqual([
			"group work", "/b in work", "group client", "/c in client", "group deep", "group home", "/e in home",
		]);
	});

	const headers: Record<string, { top: number; height: number }> = {
		"group:work": { top: 0, height: 40 }, "group:client": { top: 60, height: 40 }, "group:deep": { top: 120, height: 40 }, "group:home": { top: 180, height: 40 },
	};

	test("the places to drop a group are the headers drawn, the dragged one's own subgroups too", () => {
		expect(groupDropSlotsOf(arrangeSidebar(rows, groups, [], "").grouped, name => headers[name])).toEqual([
			{ id: "work", top: 0, bottom: 40, expanded: true },
			{ id: "client", top: 60, bottom: 100, expanded: true },
			{ id: "deep", top: 120, bottom: 160, expanded: true },
			{ id: "home", top: 180, bottom: 220, expanded: true },
		]);
		// Inside a folded group nothing is drawn.
		expect(groupDropSlotsOf(arrangeSidebar(rows, groups, ["work"], "").grouped, name => headers[name]).map(slot => [slot.id, slot.expanded])).toEqual([["work", false], ["home", true]]);
	});

	test("a drop asks for a parent and a sibling to go before", () => {
		expect(groupDropTarget(groups.groups, "home", { kind: "into", id: "work" })).toEqual({ parent: "work", before: null });
		expect(groupDropTarget(groups.groups, "home", { kind: "before", id: "client" })).toEqual({ parent: "work", before: "client" });
		expect(groupDropTarget(groups.groups, "work", { kind: "after", id: "home" })).toEqual({ parent: null, before: null });
		expect(groupDropTarget(groups.groups, "home", { kind: "after", id: "work" })).toEqual({ parent: null, before: null });
		expect(groupDropTarget(groups.groups, "deep", { kind: "end" })).toEqual({ parent: null, before: null });
		// On its own header it is no move.
		expect(groupDropTarget(groups.groups, "work", { kind: "into", id: "work" })).toBeNull();
	});

	test("the mark of a dragged group is a line, an outline, or a refusal", () => {
		expect(groupDropMark(groups.groups, "home", { kind: "before", id: "work" })).toEqual({ kind: "line", id: "work", side: "before" });
		expect(groupDropMark(groups.groups, "deep", { kind: "end" })).toEqual({ kind: "line", id: "home", side: "after" });
		expect(groupDropMark(groups.groups, "home", { kind: "into", id: "client" })).toEqual({ kind: "into", id: "client" });
		// Inside one of its own subgroups, or a fourth level, is refused where the pointer is.
		expect(groupDropMark(groups.groups, "work", { kind: "into", id: "deep" })).toEqual({ kind: "refused", id: "deep" });
		expect(groupDropMark(groups.groups, "work", { kind: "before", id: "deep" })).toEqual({ kind: "refused", id: "deep" });
		// Just beside its own direct subgroup, a few pixels under its own header, it stays where it is.
		expect(groupDropTarget(groups.groups, "work", { kind: "before", id: "client" })).toBeNull();
		expect(groupDropMark(groups.groups, "work", { kind: "before", id: "client" })).toBeNull();
		expect(groupDropMark(groups.groups, "work", { kind: "after", id: "client" })).toBeNull();
		expect(groupDropMark(groups.groups, "home", { kind: "into", id: "deep" })).toEqual({ kind: "refused", id: "deep" });
		// Where it already is: nothing.
		expect(groupDropMark(groups.groups, "home", { kind: "after", id: "work" })).toBeNull();
		expect(groupDropMark(groups.groups, "client", { kind: "into", id: "work" })).toBeNull();
	});

	test("a folded group's flag counts the repositories in its subgroups", () => {
		const repositories = [{ path: "/b", available: true, failure: null }, { path: "/d", available: false, failure: null }];
		const [work] = arrangeSidebar(rows, groups, ["work"], "").grouped;
		expect(groupNeedsLook({ repositories, removals: [] }, work!.paths)).toBe(true);
	});
});
