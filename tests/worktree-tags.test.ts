import { describe, expect, test } from "bun:test";
import { defaultPreferences, readPreferences } from "../src/shared/preferences";
import { readGroups } from "../src/shared/repository-groups";
import { parseSettings, serializeSettings } from "../src/shared/settings";
import {
	DEFAULT_TAGS,
	MAX_TAGS,
	REVIEW_TAG_ID,
	WORK_TAG_ID,
	cleanTagName,
	describeTag,
	emptySidebarTags,
	headerColor,
	newTagId,
	nextTagColor,
	readTags,
	readWorktreeTags,
	reviewTagId,
	salvageTags,
	tagNameProblem,
	tagOf,
	withWorktreeTag,
	worktreeTagId,
} from "../src/shared/worktree-tags";

const one = { path: "/work/timber", commonDir: "/work/timber/.git" };

describe("the tags", () => {
	test("are Work and Review by default, in the first and second tag colors", () => {
		expect(defaultPreferences().tags).toEqual([{ id: "work", name: "Work", color: 1 }, { id: "review", name: "Review", color: 2 }]);
		expect(readPreferences({}).tags).toEqual(defaultPreferences().tags);
	});

	test("read a whole list with Work first, each tag once by id and by name", () => {
		expect(readTags([{ id: "review", name: "Review", color: 2 }, { id: "work", name: "Work", color: 4 }])).toEqual([{ id: "work", name: "Work", color: 4 }, { id: "review", name: "Review", color: 2 }]);
		expect(readTags([{ id: "work", name: "  My   work ", color: 1 }])).toEqual([{ id: "work", name: "My work", color: 1 }]);
		// Work cannot be left out.
		expect(readTags([{ id: "review", name: "Review", color: 2 }])).toBeUndefined();
		for (const bad of [
			[{ id: "work", name: "Work", color: 6 }],
			[{ id: "work", name: "Work", color: 1 }, { id: "work", name: "Other", color: 2 }],
			[{ id: "work", name: "Work", color: 1 }, { id: "x", name: "work", color: 2 }],
			[{ id: "work", name: "", color: 1 }],
			[{ id: "Work!", name: "Work", color: 1 }],
			"Work",
		]) expect(readTags(bad)).toBeUndefined();
		expect(readTags(Array.from({ length: MAX_TAGS + 1 }, (_, index) => ({ id: index === 0 ? "work" : `tag-${index}`, name: `T${index}`, color: 1 })))).toBeUndefined();
	});

	test("salvage keeps each tag that reads, and puts Work back first", () => {
		expect(salvageTags([{ id: "review", name: "Review", color: 2 }, { id: "bad", name: "", color: 1 }])).toEqual([{ id: "work", name: "Work", color: 1 }, { id: "review", name: "Review", color: 2 }]);
		expect(readPreferences({ tags: [{ id: "tag-1", name: "Bots", color: 5 }, 7] }).tags).toEqual([{ id: "work", name: "Work", color: 1 }, { id: "tag-1", name: "Bots", color: 5 }]);
		// Work's own name taken by another tag: nothing can be kept, so the defaults come back.
		expect(salvageTags([{ id: "tag-1", name: "Work", color: 5 }, 7])).toBeUndefined();
		expect(readPreferences({ tags: [{ id: "tag-1", name: "Work", color: 5 }, 7] }).tags).toEqual(defaultPreferences().tags);
	});

	test("names are one line, at most 40 characters, and told apart ignoring case", () => {
		expect(cleanTagName(" Review  builds ")).toBe("Review builds");
		expect(cleanTagName("a".repeat(41))).toBeNull();
		expect(cleanTagName("two\nlines")).toBe("two lines");
		expect(tagNameProblem(DEFAULT_TAGS, "")).toBe("Give the tag a name.");
		expect(tagNameProblem(DEFAULT_TAGS, "review")).toBe("There is a tag named Review already.");
		expect(tagNameProblem(DEFAULT_TAGS, "REVIEW", REVIEW_TAG_ID)).toBeNull();
		expect(tagNameProblem(DEFAULT_TAGS, "Bots")).toBeNull();
	});

	test("a new tag takes a free id and the color fewest tags have", () => {
		expect(newTagId(DEFAULT_TAGS)).toBe("tag-1");
		expect(newTagId([...DEFAULT_TAGS, { id: "tag-1", name: "A", color: 3 }])).toBe("tag-2");
		expect(nextTagColor(DEFAULT_TAGS)).toBe(3);
		expect(nextTagColor([1, 2, 3, 4, 5].map(color => ({ id: `t${color}`, name: `${color}`, color: color as 1 })))).toBe(1);
	});

	test("an unknown tag is Work, and Check out PR starts on Review only while it exists", () => {
		expect(tagOf(DEFAULT_TAGS, "gone").id).toBe(WORK_TAG_ID);
		expect(tagOf(DEFAULT_TAGS, undefined).name).toBe("Work");
		expect(tagOf(DEFAULT_TAGS, REVIEW_TAG_ID).name).toBe("Review");
		expect(reviewTagId(DEFAULT_TAGS)).toBe(REVIEW_TAG_ID);
		expect(reviewTagId([DEFAULT_TAGS[0]!])).toBe(WORK_TAG_ID);
		expect(describeTag({ name: "Review" })).toBe("Tag: Review");
	});
});

describe("a worktree's tag and a header's color", () => {
	test("a worktree not named is Work, safely for any path", () => {
		const tags = { ...emptySidebarTags(), worktrees: { "/work/timber": { "/work/timber-worktrees/a": "review" } } };
		expect(worktreeTagId(tags, "/work/timber", "/work/timber-worktrees/a")).toBe("review");
		expect(worktreeTagId(tags, "/work/timber", "/work/timber-worktrees/b")).toBe(WORK_TAG_ID);
		expect(worktreeTagId(tags, "__proto__", "constructor")).toBe(WORK_TAG_ID);
		expect(headerColor({ ...emptySidebarTags(), groups: { g: 3 } }, { kind: "group", id: "g" })).toBe(3);
		expect(headerColor(emptySidebarTags(), { kind: "repository", path: "toString" })).toBeNull();
	});

	test("Work takes the entry away, and what cannot be read is dropped", () => {
		expect(withWorktreeTag({ "/a": "review" }, "/a", WORK_TAG_ID)).toEqual({});
		expect(withWorktreeTag(undefined, "/a", "review")).toEqual({ "/a": "review" });
		expect(readWorktreeTags({ "/a": "review", relative: "review", "/b": 3, "/c": "work", "/d": "Bad Id" })).toEqual({ "/a": "review" });
		expect(readWorktreeTags([])).toEqual({});
	});

	test("are kept beside the saved repository and group, and an older file stays as it was", () => {
		const settings = {
			repositories: [{ ...one, worktreeTags: { "/work/timber-worktrees/a": "review" }, color: 3 as const }],
			groups: [{ id: "g-1", name: "Clients", color: 2 as const }],
		};
		const text = serializeSettings(settings);
		expect(JSON.parse(text)).toEqual({ version: 1, ...settings });
		expect(parseSettings(text)).toEqual(settings);
		expect(JSON.parse(serializeSettings({ repositories: [one] }))).toEqual({ version: 1, repositories: [one] });
		// A tag or color that cannot be read costs only itself.
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [{ ...one, worktreeTags: "x", color: 9 }], groups: [{ id: "g-1", name: "Clients", color: "red" }] }))).toEqual({ repositories: [one], groups: [{ id: "g-1", name: "Clients" }] });
	});

	test("a group's color stays when the group moves to the top level", () => {
		expect(readGroups([{ id: "g-1", name: "Clients", color: 4, parent: "missing" }])).toEqual([{ id: "g-1", name: "Clients", color: 4 }]);
	});
});

describe("the stripe in the stylesheet", () => {
	test("is a solid bar in the tag color, and the worktree on screen trades it for a border all around", async () => {
		const css = await Bun.file(new URL("../src/mainview/styles.css", import.meta.url)).text();
		const rule = (selector: string) => new RegExp(`${selector.replace(/[.[\]:]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
		expect(rule(".row-item[data-tag]::before")).toContain("background: var(--tag);");
		expect(rule(".row-item[data-tag]::before")).not.toContain("opacity");
		expect(rule(".row-item.selected[data-tag]")).toContain("box-shadow: inset 0 0 0 2px var(--tag);");
		expect(rule(".row-item.selected[data-tag]::before")).toContain("display: none;");
	});
});
