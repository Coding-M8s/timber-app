import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { WorktreeMenuView } from "../src/mainview/components/WorktreeMenu";
import { repositoryMenuEntries } from "../src/mainview/components/RepositoryMenu";
import { SetTagDialogView, TagField } from "../src/mainview/components/TagField";
import { CheckOutDialogView } from "../src/mainview/components/CheckOutPullRequestDialog";
import { TagsSectionView } from "../src/mainview/components/settings/TagsSection";
import { browserSampleRepositories, browserSampleTags, createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { paletteEntries } from "../src/mainview/palette";
import { groupMenuItems, repositoryMenuItems } from "../src/mainview/repository-menu-format";
import { chooseFromRepositoryMenu } from "../src/mainview/sidebar-groups";
import { createAppStore } from "../src/mainview/store/store";
import { addTagDraft, editTagDraft, removeTagDraft, tagDraftsOf, tagsDraftModel } from "../src/mainview/tags-settings-format";
import { tagMenuItems, tagOfMenuItem, worktreeMenuItems, worktreeMenuKeyAction } from "../src/mainview/worktree-menu-format";
import { createWorktreeDialogController } from "../src/mainview/components/worktree-modes/dialog-controller";
import { DEFAULT_TAGS, type Tag, emptySidebarTags, worktreeTagId } from "../src/shared/worktree-tags";

const settle = async () => {
	for (let round = 0; round < 8; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const API_SERVER = sampleRepositories[1]!.path;
const LOOKUP = "/work/timber-worktrees/feat-github-issue-lookup";
const BOTS: Tag[] = [...DEFAULT_TAGS, { id: "tag-1", name: "Bots", color: 5 }];

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const rowOf = (markup: string, path: string) => {
	const start = markup.indexOf(`data-worktree-path="${path}"`);
	expect(start).toBeGreaterThan(-1);
	return markup.slice(markup.lastIndexOf("<div", start), markup.indexOf("</div></div>", start));
};

describe("tags in the sidebar", () => {
	test("every worktree is Work until it has another tag, and a header has no color until one is picked", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(rowOf(markup, LOOKUP)).toContain('data-tag="work" style="--tag:var(--tag-1)"');
		expect(markup).not.toContain("group-head colored");
		expect(store.getState().sidebarTags).toEqual(emptySidebarTags());
	});

	test("a tag set from the row's menu shows at once, and survives a new store over the same engine, as after a restart", async () => {
		const { store, engine } = await startedStore();
		expect(await store.setWorktreeTag(TIMBER, LOOKUP, "review")).toMatchObject({ outcome: "saved" });
		expect(rowOf(render(store), LOOKUP)).toContain('data-tag="review" style="--tag:var(--tag-2)"');
		expect(rowOf(render(store), LOOKUP)).toContain("Tag: Review");
		const again = await startedStore(engine);
		expect(worktreeTagId(again.store.getState().sidebarTags, TIMBER, LOOKUP)).toBe("review");
	});

	test("a tag or color that is not saved is a toast, and changes nothing shown", async () => {
		const { store } = await startedStore();
		expect(await store.setWorktreeTag(TIMBER, LOOKUP, "tag-9")).toEqual({ outcome: "unknown" });
		expect(store.getState().toasts.at(-1)).toMatchObject({ text: "Could not set the tag: the repository, group, or tag is no longer there.", problem: true });
		expect(store.getState().sidebarTags).toEqual(emptySidebarTags());
	});

	test("Color on a repository's or group's menu colors only that header", async () => {
		const { store } = await startedStore();
		expect(await store.createGroup("Clients", API_SERVER)).toBe(true);
		const group = store.getState().repositoryGroups.groups[0]!.id;
		chooseFromRepositoryMenu(store, TIMBER, { kind: "color", color: 3 }, () => {});
		await store.setHeaderColor({ kind: "group", id: group }, 2);
		await settle();
		const markup = render(store);
		expect(markup).toContain('class="group-head colored" style="--tag:var(--tag-3)"');
		expect(markup).toContain('class="repository-group-head colored" style="--tag:var(--tag-2)"');
		// The worktrees keep their own tag.
		expect(rowOf(markup, LOOKUP)).toContain('data-tag="work"');
		await store.setHeaderColor({ kind: "repository", path: TIMBER }, null);
		expect(render(store)).not.toContain('class="group-head colored"');
	});

	test("a worktree removed with Done loses its tag, so one made later at its path is Work", async () => {
		const { store, engine } = await startedStore();
		await store.setWorktreeTag(TIMBER, LOOKUP, "review");
		const preview = await engine.previewDone({ repository: TIMBER, path: LOOKUP, options: { keepBranch: false, keepIgnored: false, base: null } });
		if (preview.outcome !== "previewed") throw new Error("no preview");
		expect((await store.applyDone({ repository: TIMBER, path: LOOKUP, preview: preview.id })).outcome).toBe("removed");
		expect((await engine.listSidebarTags()).worktrees).toEqual({});
	});

	test("removing a tag in Settings moves its worktrees back to Work", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ tags: BOTS });
		await store.setWorktreeTag(TIMBER, LOOKUP, "tag-1");
		expect(rowOf(render(store), LOOKUP)).toContain('data-tag="tag-1"');
		await store.savePreferences({ tags: [...DEFAULT_TAGS] });
		await settle();
		expect(rowOf(render(store), LOOKUP)).toContain('data-tag="work"');
		expect(store.getState().sidebarTags.worktrees).toEqual({});
	});

	test("the browser build's sample has worktrees of every tag and colored headers", async () => {
		const { store } = await startedStore(createMockEngine(browserSampleRepositories, undefined, { sidebar: browserSampleTags }));
		const markup = render(store);
		for (const tag of browserSampleTags.tags.filter(tag => tag.id !== "work")) expect(markup).toContain(`data-tag="${tag.id}"`);
		expect(markup).toContain('class="group-head colored" style="--tag:var(--tag-3)"');
		expect(markup).toContain('class="repository-group-head colored" style="--tag:var(--tag-2)"');
	});
});

describe("the menus", () => {
	const worktree = sampleRepositories[0]!.worktrees[1]!;

	test("a row's menu offers Tag before Done, opening the tags with their colors and the current one checked", () => {
		const items = worktreeMenuItems(worktree, false, undefined, { tags: BOTS, current: "review" });
		expect(items.map(item => item.label).slice(-2)).toEqual(["Tag", "Done"]);
		const tag = items.at(-2)!;
		expect(tag.submenu?.items.map(item => [item.label, item.swatch, item.checked])).toEqual([["Work", 1, false], ["Review", 2, true], ["Bots", 5, false]]);
		expect(tagOfMenuItem("tag:review")).toBe("review");
		expect(tagOfMenuItem("done")).toBeNull();
		// Without the tags, as in a menu drawn on its own, there is no Tag.
		expect(worktreeMenuItems(worktree).map(item => item.label)).not.toContain("Tag");
		// A tag that is gone shows its worktree as Work.
		expect(tagMenuItems(BOTS, "gone").find(item => item.checked)?.label).toBe("Work");
	});

	test("the Tag entry says it opens a menu, and its menu draws radio items with the color in words too", () => {
		const items = worktreeMenuItems(worktree, false, undefined, { tags: DEFAULT_TAGS, current: "work" });
		const index = items.findIndex(item => item.id === "tag");
		const markup = renderToStaticMarkup(
			<WorktreeMenuView label="Actions" items={items} at={{ left: 0, top: 0 }} idBase="m" open={{ index, menu: <WorktreeMenuView label="Tag of x" items={items[index]!.submenu!.items} at={{ left: 0, top: 0 }} idBase="s" inner /> }} />,
		);
		expect(markup).toContain('aria-haspopup="menu" aria-expanded="true"');
		expect(markup).toContain('class="worktree-menu worktree-submenu" role="menu" aria-label="Tag of x"');
		expect(markup).toContain('role="menuitemradio"');
		expect(markup).toMatch(/role="menuitemradio"[^>]*aria-checked="true"[^>]*><span class="tag-swatch" style="background:var\(--tag-1\)" aria-hidden="true"><\/span><span class="session-menu-label">Work<\/span>/);
	});

	test("Right opens an entry's menu, and Left or Escape in there goes back to it", () => {
		expect(worktreeMenuKeyAction(3, 1, "ArrowRight", { opens: true })).toEqual({ kind: "open" });
		expect(worktreeMenuKeyAction(3, 1, "ArrowRight")).toBeNull();
		expect(worktreeMenuKeyAction(3, 1, "ArrowLeft", { inner: true })).toEqual({ kind: "back" });
		expect(worktreeMenuKeyAction(3, 1, "Escape", { inner: true })).toEqual({ kind: "back" });
		expect(worktreeMenuKeyAction(3, 1, "Escape")).toEqual({ kind: "close", preventDefault: true });
		expect(worktreeMenuKeyAction(3, 2, "ArrowDown", { inner: true })).toEqual({ kind: "move", index: 0 });
	});

	test("a repository's and a group's menus offer Color: the five tag colors and No color, none checked until one is picked", () => {
		const groups = { groups: [{ id: "g", name: "Clients" }], membership: {} };
		const color = repositoryMenuItems(groups, TIMBER, undefined, { name: "timber", current: null }).find(item => item.id === "color")!;
		expect(color.submenu!.items.map(item => [item.label, item.swatch, item.checked])).toEqual([
			["Color 1", 1, false], ["Color 2", 2, false], ["Color 3", 3, false], ["Color 4", 4, false], ["Color 5", 5, false], ["No color", "none", true],
		]);
		const entries = repositoryMenuEntries(repositoryMenuItems(groups, TIMBER, undefined, { name: "timber", current: 4 }));
		expect(entries.find(entry => entry.id === "color")!.submenu!.items.find(entry => entry.checked)?.label).toBe("Color 4");
		const group = groupMenuItems(groups.groups, "g", 2).find(item => item.id === "color")!;
		expect(group.submenu!.items.find(item => item.checked)?.choice).toEqual({ kind: "color", color: 2 });
		expect(group.description).toBe("Choose the color of the header of Clients. It is color 2 now.");
	});
});

describe("the palette", () => {
	test("offers Set tag... for the selected worktree, saying its tag, and opening the dialog", async () => {
		const { store } = await startedStore();
		const lookup = store.getState().repositories[0]!.worktrees.find(worktree => worktree.path === LOOKUP)!;
		store.select(lookup.id);
		await store.setWorktreeTag(TIMBER, LOOKUP, "review");
		const entry = paletteEntries(store.getState()).find(candidate => candidate.id === "action:set-tag")!;
		expect(entry).toMatchObject({ label: "Set tag...", disabledReason: null, action: { kind: "dialog", request: { kind: "set-tag", repository: TIMBER, worktree: lookup.id } } });
		expect(entry.hint).toBe("Chooses the tag of feat/github-issue-lookup. It is Review now.");
		expect(entry.keywords).toContain("color");
	});

	test("the dialog draws each tag with its color and name, the current one pressed", () => {
		const markup = renderToStaticMarkup(<SetTagDialogView name="feat/x" tags={BOTS} current="tag-1" onPick={() => {}} onClose={() => {}} />);
		expect(markup).toContain("Tag of feat/x");
		expect(markup).toContain("Tag: Bots now.");
		expect(markup).toMatch(/aria-pressed="true"[^>]*><span class="tag-swatch" style="background:var\(--tag-5\)" aria-hidden="true"><\/span><span>Bots<\/span>/);
	});
});

describe("choosing the tag when creating", () => {
	test("the Tag field shows each tag with its color, and starts on Work in the worktree dialog", async () => {
		const { store } = await startedStore();
		const controller = createWorktreeDialogController(store, TIMBER, { getState: () => ({ running: false, failure: null }), submit: async () => true, clearFailure: () => {} });
		expect(controller.getState().tag).toBe("work");
		controller.pickTag("review");
		controller.select(1);
		// The choice stays when another mode shows.
		expect(controller.getState().tag).toBe("review");
		const markup = renderToStaticMarkup(<TagField tags={DEFAULT_TAGS} chosen="work" disabled={false} onPick={() => {}} />);
		expect(markup).toMatch(/<legend class="field-label">Tag<\/legend>/);
		expect(markup).toMatch(/<input type="radio"[^>]*checked="" value="work"\/><span class="tag-swatch" style="background:var\(--tag-1\)" aria-hidden="true"><\/span><span>Work<\/span>/);
	});

	test("Check out PR starts on Review", () => {
		const choice = { options: [{ pullRequest: { number: 7, url: "https://github.com/acme/timber/pull/7", title: "Fix", state: "open", branch: "fix", headRepository: "acme/timber", isDraft: false }, refused: null }] } as never;
		const markup = renderToStaticMarkup(<CheckOutDialogView repository={TIMBER} keyLabel="#41" choice={choice} picked={0} onPick={() => {}} submission={{ running: false, failure: null }} tag={{ tags: DEFAULT_TAGS, chosen: "review", onPick: () => {} }} onSubmit={() => {}} onClose={() => {}} />);
		expect(markup).toMatch(/checked="" value="review"/);
	});

	test("a new worktree takes the tag chosen, and one that was there already keeps its own", async () => {
		const { store } = await startedStore();
		const made = await store.newWorktree({ repository: TIMBER, name: "feat/tagged", base: null }, "review");
		expect(made.outcome).toBe("succeeded");
		const path = made.outcome === "succeeded" ? made.worktree.path : "";
		expect(worktreeTagId(store.getState().sidebarTags, TIMBER, path)).toBe("review");
		expect(rowOf(render(store), path)).toContain('data-tag="review"');
		// Opened again, it was there: the tag asked for now is not given.
		const opened = await store.openWorktree({ repository: TIMBER, selector: path }, "tag-9");
		expect(opened.outcome === "succeeded" && opened.created).toBe(false);
		expect(worktreeTagId(store.getState().sidebarTags, TIMBER, path)).toBe("review");
		// Work gives nothing to save.
		const plain = await store.newWorktree({ repository: TIMBER, name: "feat/plain", base: null }, "work");
		expect(plain.outcome).toBe("succeeded");
		expect(Object.keys(store.getState().sidebarTags.worktrees[TIMBER]!)).toEqual([path]);
	});

	test("a run that created the worktree and then failed still gives it the tag", async () => {
		const { store, engine } = await startedStore();
		engine.endCommands("stops-after-create");
		const made = await store.newWorktree({ repository: TIMBER, name: "feat/half", base: null }, "review");
		expect(made.outcome).toBe("failed");
		expect(made.outcome === "failed" && made.created && made.worktree !== null).toBe(true);
		expect(worktreeTagId(store.getState().sidebarTags, TIMBER, made.outcome === "failed" ? made.worktree!.path : "")).toBe("review");
	});

	test("every attempt of an arena takes the tag", async () => {
		const { store } = await startedStore();
		const result = await store.newArena({ repository: TIMBER, name: "demo", task: "Do it", base: null, groups: [{ kind: "tool", tool: "manual", model: null, effort: null, runs: 2 }] }, "review");
		expect(result.outcome).toBe("created");
		const paths = result.outcome === "created" ? result.arena.attempts.map(attempt => attempt.path) : [];
		expect(paths).toHaveLength(2);
		for (const path of paths) expect(worktreeTagId(store.getState().sidebarTags, TIMBER, path)).toBe("review");
	});
});

describe("Settings, Tags", () => {
	test("adds, renames, recolors, and removes tags; Work cannot be removed", () => {
		let drafts = tagDraftsOf(DEFAULT_TAGS);
		drafts = addTagDraft(drafts)!;
		expect(drafts.at(-1)).toEqual({ id: "tag-1", name: "", color: 3 });
		expect(tagsDraftModel(drafts, DEFAULT_TAGS)).toMatchObject({ canSave: false, problems: { "tag-1": "Give the tag a name." } });
		drafts = editTagDraft(drafts, "tag-1", { name: "Bots", color: 5 });
		drafts = editTagDraft(drafts, "work", { name: "Mine", color: 4 });
		expect(tagsDraftModel(drafts, DEFAULT_TAGS)).toEqual({ problems: {}, canSave: true, removed: [], tags: [{ id: "work", name: "Mine", color: 4 }, { id: "review", name: "Review", color: 2 }, { id: "tag-1", name: "Bots", color: 5 }] });
		expect(removeTagDraft(drafts, "work")).toHaveLength(3);
		const removed = removeTagDraft(drafts, "review");
		expect(tagsDraftModel(removed, DEFAULT_TAGS).removed).toEqual(["Review"]);
		expect(tagsDraftModel(editTagDraft(drafts, "tag-1", { name: "mine" }), DEFAULT_TAGS).problems).toEqual({ "tag-1": "There is a tag named Mine already." });
		expect(tagsDraftModel(tagDraftsOf(DEFAULT_TAGS), DEFAULT_TAGS).canSave).toBe(false);
	});

	test("a tag added after one was removed never takes its id, so the removed tag's worktrees go to Work", () => {
		const added = addTagDraft(removeTagDraft(tagDraftsOf(BOTS), "tag-1"), BOTS)!;
		expect(added.at(-1)!.id).toBe("tag-2");
		const model = tagsDraftModel(editTagDraft(added, "tag-2", { name: "Later" }), BOTS);
		expect(model.removed).toEqual(["Bots"]);
		expect(model.tags!.map(tag => tag.id)).toEqual(["work", "review", "tag-2"]);
	});

	test("draws each tag with its five colors in words, its name, and Remove, with Work marked as the default", () => {
		const markup = renderToStaticMarkup(<TagsSectionView drafts={tagDraftsOf(BOTS)} saved={BOTS} save={{ state: "idle" }} onChange={() => {}} onSave={() => {}} />);
		expect(markup).toContain('aria-label="Color of Work"');
		expect(markup).toContain('aria-label="Color 5"');
		expect(markup).toContain('aria-label="Name of the default tag"');
		expect(markup).toContain('aria-label="Remove Bots"');
		expect(markup).not.toContain('aria-label="Remove Work"');
		expect(markup).toContain(">Add tag</button>");
	});

	test("saves through the preferences, and the next start reads them", async () => {
		const { store, engine } = await startedStore();
		expect((await store.savePreferences({ tags: BOTS })).outcome).toBe("saved");
		expect((await engine.loadPreferences()).tags).toEqual(BOTS);
	});
});
