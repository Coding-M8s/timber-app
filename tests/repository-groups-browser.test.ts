import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Repository groups in a real browser, over the mock engine: where the
 * keyboard is, what typing does, and pointer drags. Everything else about
 * groups is tested without a window. Skipped where no browser is installed.
 */

/** The sidebar as drawn: loose repositories as `R name`, groups as `G name:members`. */
const TREE = `[...document.querySelectorAll(".groups > *")].map(element => element.classList.contains("repository-group")
	? "G " + (element.querySelector(".repository-group-name")?.textContent ?? "(field)") + ":" + [...element.querySelectorAll(".group-name")].map(name => name.textContent).join(",")
	: "R " + element.querySelector(".group-name")?.textContent).join(" | ")`;

/** What has the keyboard: its label, or for a header its kind and name. */
const ACTIVE = `(() => {
	const active = document.activeElement;
	if (!active || active === document.body) return "nothing";
	if (active.classList.contains("repository-group-header")) return "group header " + active.querySelector(".repository-group-name").textContent;
	if (active.classList.contains("group-header")) return "repository header " + active.querySelector(".group-name").textContent;
	return active.getAttribute("aria-label") ?? active.textContent.trim();
})()`;

/** The groups as drawn, nested: `Name[members](subgroups)`, top-level ones joined by " | ". */
const NESTED = `(() => {
	const draw = section => {
		const members = section.querySelector(":scope > .repository-group-members");
		const repositories = members ? [...members.querySelectorAll(":scope > section.group .group-name")].map(name => name.textContent) : [];
		const groups = members ? [...members.querySelectorAll(":scope > section.repository-group:not(.pending)")].map(draw) : [];
		return section.querySelector(".repository-group-name").textContent + "[" + repositories.join(",") + "]" + (groups.length > 0 ? "(" + groups.join(",") + ")" : "");
	};
	return [...document.querySelectorAll(".groups > section.repository-group:not(.pending)")].map(draw).join(" | ");
})()`;

const MENU_OPEN = `document.querySelector('[role="menu"]') !== null`;
const FIELD = `document.querySelector(".repository-group-name-input")`;
const PROBLEM = `document.querySelector(".repository-group-name-problem")?.textContent ?? null`;
const more = (name: string) => `[aria-label="More for ${name}"]`;
const repositoryHeader = (name: string) => `section.group[aria-label="${name}"] .group-header`;
const groupHeader = (name: string) => `section[aria-label="Group ${name}"] .repository-group-header`;
const expanded = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-expanded")`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("repository groups in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	// Each test starts from the app as it opens, with every repository folded so the list fits the window.
	beforeEach(async () => {
		await page.reload();
		await page.evaluate(`(() => {
			const store = window.timberTestStore;
			for (const repository of store.getState().repositories) {
				if (!store.getState().layout.collapsed.includes(repository.path)) store.toggleGroup(repository.path);
			}
		})()`);
		await page.until(`document.querySelectorAll('.group-header[aria-expanded="true"]').length === 0`, "every repository folded");
	});

	const tree = () => page.evaluate<string>(TREE);
	const active = () => page.evaluate<string>(ACTIVE);

	async function makeGroup(name: string) {
		await page.click('[aria-label="New group"]');
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		await page.type(name);
		await page.press("Enter");
		await page.until(`document.querySelector(${JSON.stringify(groupHeader(name))})`, `the group ${name} showed`);
	}

	test("a new group is named in place, and the keyboard follows", async () => {
		await page.click('[aria-label="New group"]');
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		expect(await active()).toBe("Name of the new group");

		// An empty name is refused, with the reason, and the field stays.
		await page.press("Enter");
		await page.until(`${PROBLEM} !== null`, "the reason showed");
		expect(await page.evaluate<string>(PROBLEM)).toBe("Type a name for the group.");

		await page.type("Work");
		expect(await page.evaluate<string | null>(PROBLEM)).toBeNull();
		await page.press("Enter");
		await page.until(`document.querySelector(${JSON.stringify(groupHeader("Work"))}) === document.activeElement`, "the new group's header took the keyboard");
		expect(await tree()).toEndWith("G Work:");

		// A name that is taken, whatever its case, is refused. Escape puts the field away and gives the keyboard back.
		await page.click('[aria-label="New group"]');
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		await page.type("work");
		await page.press("Enter");
		await page.until(`${PROBLEM} !== null`, "the reason showed");
		expect(await page.evaluate<string>(PROBLEM)).toBe("There is already a group named Work.");
		await page.press("Escape");
		await page.until(`${FIELD} === null`, "the field went away");
		await page.until(`${JSON.stringify("New group")} === ${ACTIVE}`, "the New group button took the keyboard");
		expect((await tree()).split("G ").length - 1).toBe(1);
	}, 30_000);

	test("leaving the name field saves a name, and puts away an empty or refused one", async () => {
		await page.click('[aria-label="New group"]');
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		await page.type("Side");
		await page.click(".filter");
		await page.until(`document.querySelector(${JSON.stringify(groupHeader("Side"))})`, "the group was made");

		await page.click('[aria-label="New group"]');
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		await page.click(".filter");
		await page.until(`${FIELD} === null`, "the empty field went away");

		// Refused, then left: the field must not be left behind.
		await page.click('[aria-label="New group"]');
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		await page.press("Enter");
		await page.until(`${PROBLEM} !== null`, "the reason showed");
		await page.click(".filter");
		await page.until(`${FIELD} === null`, "the refused field went away");
		expect((await tree()).split("G ").length - 1).toBe(1);
	}, 30_000);

	test("a repository's menu is moved through with the keys, and a choice keeps the keyboard on its header", async () => {
		await makeGroup("Work");
		await page.click(more("timber"));
		await page.until(MENU_OPEN, "the menu opened");
		await page.until(`${ACTIVE} === "Clean up merged"`, "the first entry took the keyboard");
		await page.press("ArrowDown");
		await page.until(`${ACTIVE} === "Add to Work"`, "the entry below took the keyboard");
		await page.press("ArrowDown");
		expect(await active()).toBe("New group...");
		await page.press("End");
		expect(await active()).toBe("Remove from the list");
		await page.press("Home");
		expect(await active()).toBe("Clean up merged");
		await page.press("ArrowUp");
		expect(await active()).toBe("Remove from the list");

		await page.press("Escape");
		await page.until(`!(${MENU_OPEN})`, "the menu closed");
		expect(await active()).toBe("repository header timber");

		// Shift+F10 opens it from the header; Enter chooses.
		await page.press("F10", "shift");
		await page.until(MENU_OPEN, "the menu opened from the keyboard");
		await page.until(`${ACTIVE} === "Clean up merged"`, "the first entry took the keyboard");
		await page.press("ArrowDown");
		await page.until(`${ACTIVE} === "Add to Work"`, "the entry below took the keyboard");
		await page.press("Enter");
		await page.until(`${TREE}.endsWith("G Work:timber")`, "timber went into Work");
		await page.until(`${ACTIVE} === "repository header timber"`, "its header kept the keyboard");

		await page.press("F10", "shift");
		await page.until(MENU_OPEN, "the menu opened again");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)`))
			.toEqual(["Clean up merged", "New group...", "Take out of Work", "Icon...", "Color\u203a", "Remove from the list"]);
	}, 30_000);

	test("a group is renamed from its menu with the old name selected", async () => {
		await makeGroup("Work");
		await page.until(`${ACTIVE} === "group header Work"`, "the new group's header took the keyboard");
		await page.press("F10", "shift");
		await page.until(MENU_OPEN, "the group's menu opened");
		await page.until(`${ACTIVE} === "Rename"`, "Rename took the keyboard");
		await page.press("Enter");
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		expect(await active()).toBe("New name for Work");
		expect(await page.evaluate<string>(`(() => { const field = ${FIELD}; return field.value.slice(field.selectionStart, field.selectionEnd); })()`)).toBe("Work");
		await page.type("Job");
		await page.press("Enter");
		await page.until(`document.querySelector(${JSON.stringify(groupHeader("Job"))}) === document.activeElement`, "the renamed header took the keyboard");
		expect(await tree()).toEndWith("G Job:");
	}, 30_000);

	test("a group header folds with a click, Enter, and Space", async () => {
		await makeGroup("Work");
		const header = groupHeader("Work");
		await page.click(header);
		await page.until(`${expanded(header)} === "false"`, "the click folded it");
		await page.press("Enter");
		await page.until(`${expanded(header)} === "true"`, "Enter unfolded it");
		await page.press(" ");
		await page.until(`${expanded(header)} === "false"`, "Space folded it");
		expect(await page.evaluate<number>(`window.timberTestStore.getState().layout.collapsedGroups.length`)).toBe(1);
	}, 30_000);

	test("a repository is dragged into a group and out, and the next click is not lost", async () => {
		await makeGroup("Work");
		const timber = await page.middle(repositoryHeader("timber"));
		const work = await page.middle(groupHeader("Work"));
		await page.dragTo(timber, work);
		// While it is held over the group, the group is outlined and the dragged section is marked.
		expect(await page.evaluate<boolean>(`document.querySelector('section[aria-label="Group Work"]').classList.contains("drop-into")`)).toBe(true);
		expect(await page.evaluate<boolean>(`document.querySelector('section.group[aria-label="timber"]').classList.contains("dragging")`)).toBe(true);
		await page.release();
		await page.until(`${TREE}.endsWith("G Work:timber")`, "timber went into Work");
		expect(await page.evaluate<string>(expanded(repositoryHeader("timber")))).toBe("false");

		// The header was drawn anew in the group, so its own click never came: the next click must still count.
		await page.click(groupHeader("Work"));
		await page.until(`${expanded(groupHeader("Work"))} === "false"`, "the first click after the drag folded the group");

		// Dropped on a folded group, it goes to the end of it.
		const api = await page.middle(repositoryHeader("api-server"));
		await page.dragTo(api, await page.middle(groupHeader("Work")));
		await page.release();
		await page.click(groupHeader("Work"));
		await page.until(`${TREE}.endsWith("G Work:timber,api-server")`, "api-server went to the end of the folded group");

		// Out again: above the first group, with no loose repository left, is the end of the loose list.
		const group = await page.middle(groupHeader("Work"));
		const dragged = await page.middle(repositoryHeader("timber"));
		await page.dragTo(dragged, { x: group.x, y: group.top - 3 });
		await page.release();
		await page.until(`${TREE} === "R timber | G Work:api-server"`, "timber is loose again, and api-server stays");
	}, 30_000);

	test("a drag within the loose list reorders without folding or unfolding what was dragged", async () => {
		const names = await page.evaluate<string[]>(`[...document.querySelectorAll(".groups > section.group")].map(section => section.getAttribute("aria-label"))`);
		const [first, second] = names as [string, string];
		const from = await page.middle(repositoryHeader(first));
		const below = await page.middle(repositoryHeader(second));
		await page.dragTo(from, { x: below.x, y: below.bottom + 3 });
		await page.release();
		await page.until(`${TREE}.startsWith(${JSON.stringify(`R ${second} | R ${first}`)})`, "the two changed places");
		expect(await page.evaluate<string>(expanded(repositoryHeader(first)))).toBe("false");
		// And the click after that one still folds and unfolds.
		await page.click(repositoryHeader(second));
		await page.until(`${expanded(repositoryHeader(second))} === "true"`, "the next click unfolded a repository");
	}, 30_000);

	test("groups are reordered with Alt+Down and by dragging a header, and the keyboard stays on the header", async () => {
		await makeGroup("Work");
		await makeGroup("Personal");
		const order = `[...document.querySelectorAll(".repository-group-name")].map(name => name.textContent).join(",")`;
		expect(await page.evaluate<string>(order)).toBe("Work,Personal");

		await page.evaluate(`document.querySelector(${JSON.stringify(groupHeader("Work"))}).focus()`);
		await page.press("ArrowDown", "alt");
		await page.until(`${order} === "Personal,Work"`, "Alt+Down moved Work down");
		await page.until(`${ACTIVE} === "group header Work"`, "the moved header kept the keyboard");

		const work = await page.middle(groupHeader("Work"));
		const personal = await page.middle(groupHeader("Personal"));
		await page.dragTo(work, { x: personal.x, y: personal.top - 2 });
		expect(await page.evaluate<boolean>(`document.querySelector('section[aria-label="Group Work"]').classList.contains("dragging")`)).toBe(true);
		await page.release();
		await page.until(`${order} === "Work,Personal"`, "the drag moved Work back up");
	}, 30_000);

	test("Alt+Down moves a repository among its siblings only, and it keeps the keyboard", async () => {
		await makeGroup("Work");
		for (const name of ["timber", "api-server"]) {
			await page.click(more(name));
			// Enter is for the entry, so wait until it has the keyboard.
			await page.until(`${ACTIVE} === "Clean up merged"`, "the first entry took the keyboard");
			await page.press("ArrowDown");
			await page.until(`${ACTIVE} === "Add to Work"`, "the entry below took the keyboard");
			await page.press("Enter");
			await page.until(`!(${MENU_OPEN})`, "the menu closed");
			await page.until(`${ACTIVE} === ${JSON.stringify(`repository header ${name}`)}`, "its header took the keyboard back");
		}
		await page.until(`${TREE}.endsWith("G Work:timber,api-server")`, "both are in Work");
		await page.evaluate(`document.querySelector(${JSON.stringify(repositoryHeader("timber"))}).focus()`);
		await page.press("ArrowDown", "alt");
		await page.until(`${TREE}.endsWith("G Work:api-server,timber")`, "timber moved below api-server");
		await page.until(`${ACTIVE} === "repository header timber"`, "it kept the keyboard");
		// At the end of its group it goes no further, and never into the loose list.
		await page.press("ArrowDown", "alt");
		await Bun.sleep(100);
		expect(await tree()).toBe("G Work:api-server,timber");
		// And back up, where it stops at the top of its group.
		await page.press("ArrowUp", "alt");
		await page.until(`${TREE} === "G Work:timber,api-server"`, "timber moved back above api-server");
		await page.press("ArrowUp", "alt");
		await Bun.sleep(100);
		expect(await tree()).toBe("G Work:timber,api-server");
	}, 30_000);

	/** Choose an entry of a group's menu by its words, from its More button. */
	async function chooseFromGroupMenu(group: string, entry: string) {
		await page.click(more(`group ${group}`));
		await page.until(MENU_OPEN, "the group's menu opened");
		await page.until(`${ACTIVE} === "Rename"`, "the first entry took the keyboard");
		for (let step = 0; step < 12 && await active() !== entry; step++) await page.press("ArrowDown");
		expect(await active()).toBe(entry);
		await page.press("Enter");
		await page.until(`!(${MENU_OPEN})`, "the menu closed");
	}

	test("a subgroup is made from a group's menu, moved out to the top level, and moved back in", async () => {
		await makeGroup("Work");
		await chooseFromGroupMenu("Work", "New subgroup...");
		await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
		expect(await active()).toBe("Name of the new group in Work");
		await page.type("Client");
		await page.press("Enter");
		await page.until(`${ACTIVE} === "group header Client"`, "the new subgroup's header took the keyboard");
		expect(await page.evaluate<string>(NESTED)).toBe("Work[](Client[])");

		await chooseFromGroupMenu("Client", "Move to the top level");
		await page.until(`${NESTED} === "Work[] | Client[]"`, "Client went to the top level");
		await page.until(`${ACTIVE} === "group header Client"`, "its header kept the keyboard");

		await chooseFromGroupMenu("Client", "Move into Work");
		await page.until(`${NESTED} === "Work[](Client[])"`, "Client went back into Work");
	}, 30_000);

	test("a group dragged onto a header goes inside it, between groups it is reordered, and into its own subgroup it is refused", async () => {
		await makeGroup("Work");
		await makeGroup("Personal");
		await makeGroup("Home");
		// Home onto the middle of Work's header: inside Work.
		await page.dragTo(await page.middle(groupHeader("Home")), await page.middle(groupHeader("Work")));
		expect(await page.evaluate<boolean>(`document.querySelector('section[aria-label="Group Work"]').classList.contains("drop-into")`)).toBe(true);
		await page.release();
		await page.until(`${NESTED} === "Work[](Home[]) | Personal[]"`, "Home went inside Work");

		// Personal just above Home's header: beside Home, inside Work.
		const home = await page.middle(groupHeader("Home"));
		await page.dragTo(await page.middle(groupHeader("Personal")), { x: home.x, y: home.top + 1 });
		await page.release();
		await page.until(`${NESTED} === "Work[](Personal[],Home[])"`, "Personal went before Home, inside Work");

		// Work onto its own subgroup's header: refused, said, and nothing moves.
		await page.dragTo(await page.middle(groupHeader("Work")), await page.middle(groupHeader("Home")));
		expect(await page.evaluate<boolean>(`document.querySelector('section[aria-label="Group Home"]').classList.contains("drop-refused")`)).toBe(true);
		await page.release();
		await page.until(`document.querySelector(".sidebar-error")?.textContent.includes("A group can't go inside itself or one of its own subgroups.") === true`, "the refusal was said");
		expect(await page.evaluate<string>(NESTED)).toBe("Work[](Personal[],Home[])");

		// Home dragged below every header: the end of the top level. The drag starts within the header, so it holds the pointer.
		const last = await page.middle(groupHeader("Home"));
		await page.dragTo(last, { x: last.x, y: last.y + 8 });
		await page.moveTo({ x: last.x, y: last.bottom + 200 });
		await page.release();
		await page.until(`${NESTED} === "Work[](Personal[]) | Home[]"`, "Home went to the end of the top level");
	}, 30_000);

	test("the keyboard reaches and folds a subgroup, and Alt+Down moves it among its siblings", async () => {
		await makeGroup("Work");
		for (const name of ["Client", "Other"]) {
			await chooseFromGroupMenu("Work", "New subgroup...");
			await page.until(`${FIELD} === document.activeElement`, "the name field took the keyboard");
			await page.type(name);
			await page.press("Enter");
			await page.until(`${ACTIVE} === ${JSON.stringify(`group header ${name}`)}`, "the new subgroup's header took the keyboard");
		}
		await page.evaluate(`document.querySelector(${JSON.stringify(groupHeader("Work"))}).focus()`);
		for (let step = 0; step < 6 && await active() !== "group header Client"; step++) await page.press("Tab");
		expect(await active()).toBe("group header Client");
		await page.press("Enter");
		await page.until(`${expanded(groupHeader("Client"))} === "false"`, "Enter folded the subgroup");
		expect(await page.evaluate<string>(expanded(groupHeader("Work")))).toBe("true");

		await page.press("ArrowDown", "alt");
		await page.until(`${NESTED} === "Work[](Other[],Client[])"`, "Alt+Down moved Client below Other");
		await page.until(`${ACTIVE} === "group header Client"`, "the moved header kept the keyboard");
		// Folding Work hides both; opening it again shows Client still folded.
		await page.click(groupHeader("Work"));
		await page.until(`document.querySelector(${JSON.stringify(groupHeader("Client"))}) === null`, "folding Work hid its subgroups");
		await page.click(groupHeader("Work"));
		await page.until(`${expanded(groupHeader("Client"))} === "false"`, "Client stayed folded on its own");
	}, 30_000);
});
