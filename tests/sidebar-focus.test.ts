import { describe, expect, test } from "bun:test";
import { type FocusRoot, focusFirstWorktree, focusLost } from "../src/mainview/sidebar-focus";

/** A sidebar with groups, each with its header and rows, recording which one took the keyboard. */
function sidebar(groups: { repository: string; rows: string[] }[]) {
	const focused: string[] = [];
	const target = (name: string) => ({ focus: () => void focused.push(name) });
	const root: FocusRoot = {
		querySelectorAll: () => groups.map(group => ({
			dataset: { repository: group.repository },
			// Each group's Issues row comes first, as in the sidebar. It is a row, and not a worktree's.
			querySelector: (selectors: string) => {
				const rows = ["Issues", ...group.rows];
				if (selectors === ".row") return target(rows[0]!);
				if (selectors === ".row:not(.issues-row)") return group.rows[0] === undefined ? null : target(group.rows[0]);
				return selectors === ".group-header" ? target(`${group.repository} header`) : null;
			},
		})),
	};
	return { root, focused };
}

describe("where the keyboard goes after the Done dialog closes", () => {
	test("the first worktree row of the repository's group", () => {
		const { root, focused } = sidebar([{ repository: "/work/api", rows: ["api main"] }, { repository: "/work/timber", rows: ["timber main", "feat/x"] }]);
		expect(focusFirstWorktree("/work/timber", root)).toBe(true);
		expect(focused).toEqual(["timber main"]);
	});

	test("the group's header while it shows no rows, as when it is collapsed", () => {
		const { root, focused } = sidebar([{ repository: "/work/timber", rows: [] }]);
		expect(focusFirstWorktree("/work/timber", root)).toBe(true);
		expect(focused).toEqual(["/work/timber header"]);
	});

	test("nowhere when the repository has no group", () => {
		const { root, focused } = sidebar([{ repository: "/work/api", rows: ["api main"] }]);
		expect(focusFirstWorktree("/work/timber", root)).toBe(false);
		expect(focused).toEqual([]);
	});

	test("the header of the folded repository group that holds the repository, which is not drawn", () => {
		const focused: string[] = [];
		const root: FocusRoot = {
			querySelectorAll: (selectors: string) => selectors === "[data-group]"
				? [
					{ dataset: { group: "g-personal" }, querySelector: () => ({ focus: () => void focused.push("Personal header") }) },
					{ dataset: { group: "g-work" }, querySelector: (inner: string) => inner === ":scope > .repository-group-head > .repository-group-header" ? { focus: () => void focused.push("Work header") } : null },
				]
				: [{ dataset: { repository: "/work/api" }, querySelector: () => ({ focus: () => void focused.push("api") }) }],
		};
		expect(focusFirstWorktree("/work/timber", root, ["g-work"])).toBe(true);
		expect(focused).toEqual(["Work header"]);
	});

	test("the nearest drawn header around it when its own group sits inside a folded one, and only a group's own header", () => {
		const focused: string[] = [];
		const header = (name: string) => (inner: string) => inner === ":scope > .repository-group-head > .repository-group-header" ? { focus: () => void focused.push(name) } : null;
		// Client, inside Work, is not drawn while Work is folded; Deep, inside Client, neither.
		const root: FocusRoot = {
			querySelectorAll: (selectors: string) => selectors === "[data-group]" ? [{ dataset: { group: "g-work" }, querySelector: header("Work header") }] : [],
		};
		expect(focusFirstWorktree("/work/timber", root, ["g-deep", "g-client", "g-work"])).toBe(true);
		expect(focused).toEqual(["Work header"]);
	});

	test("nowhere when the repository is not drawn and is in no group", () => {
		const focused: string[] = [];
		const root: FocusRoot = { querySelectorAll: () => [{ dataset: { group: "g-work" }, querySelector: () => ({ focus: () => void focused.push("Work header") }) }] };
		expect(focusFirstWorktree("/work/timber", root)).toBe(false);
		expect(focused).toEqual([]);
	});

	test("only when the keyboard is nowhere", () => {
		const body = {} as Element;
		expect(focusLost(null, body)).toBe(true);
		expect(focusLost(body, body)).toBe(true);
		expect(focusLost({} as Element, body)).toBe(false);
	});
});
