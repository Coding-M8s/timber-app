import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorktreeRow } from "../src/mainview/components/WorktreeRow";
import { browserSampleRepositories } from "../src/mainview/engine/mock";
import { describeRowMarkers } from "../src/mainview/format";
import type { Worktree } from "../src/shared/model";

const clean: Worktree = {
	id: "/work/app/.git\0verified\0/work/app-worktrees/feat-x",
	path: "/work/app-worktrees/feat-x",
	canonicalPath: "/work/app-worktrees/feat-x",
	branch: "feat/x",
	head: "1234567890abcdef1234567890abcdef12345678",
	primary: false,
	detached: false,
	locked: false,
	prunable: false,
	pathExists: true,
	changes: { kind: "known", modified: [], untracked: [] },
	base: null,
	issue: null,
	sync: { kind: "tracking", upstream: "origin/feat/x", ahead: 0, behind: 0 },
};
const busy: Worktree = {
	...clean,
	locked: true,
	changes: { kind: "known", modified: ["a.ts", "b.ts", "c.ts"], untracked: ["new.ts"] },
	base: null,
	issue: null,
	sync: { kind: "tracking", upstream: "origin/feat/x", ahead: 2, behind: 14 },
};

const render = (worktree: Worktree, selected = false) => renderToStaticMarkup(<WorktreeRow worktree={worktree} selected={selected} onSelect={() => {}} />);

/** Every marker in the markup: its class, tooltip, and text, with any drawing left out. */
function markersIn(markup: string): { className: string; title: string; text: string }[] {
	return [...markup.matchAll(/<span class="([^"]*)" title="([^"]*)" aria-hidden="true">(.*?)<\/span>/g)]
		.map(match => ({ className: match[1]!, title: match[2]!, text: match[3]!.replace(/<svg.*?<\/svg>/g, "") }));
}

/** The text the row's `aria-describedby` points at, or null when it has none. */
function descriptionOf(markup: string): string | null {
	const id = /<button[^>]* aria-describedby="([^"]+)"/.exec(markup)?.[1];
	if (id === undefined) return null;
	return new RegExp(`<span id="${id}" class="row-description" hidden="">([^<]*)</span>`).exec(markup)?.[1] ?? null;
}

/** What is left for the accessible name: the row's text without hidden parts. */
function nameOf(markup: string): string {
	return markup
		.replace(/<span [^>]*aria-hidden="true">.*?<\/span>/g, "")
		.replace(/<span [^>]*hidden="">.*?<\/span>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

describe("WorktreeRow", () => {
	test("a clean worktree that is level with its upstream shows its name and kind, and nothing else", () => {
		const markup = render(clean);
		expect(markersIn(markup)).toEqual([]);
		expect(markup).not.toContain("aria-describedby");
		expect(markup).not.toContain("row-description");
		expect(markup).not.toContain("row-flags");
		expect(nameOf(markup)).toBe("feat/x Worktree");
		expect(markup).toContain('title="/work/app-worktrees/feat-x"');
	});

	test("the tooltip adds the saved base to the path, and nothing when Timber reported none", () => {
		expect(render({ ...clean, base: { kind: "assigned", ref: "refs/remotes/origin/main" } })).toContain('title="/work/app-worktrees/feat-x (Base origin/main)"');
		expect(render({ ...clean, base: { kind: "unassigned" } })).toContain('title="/work/app-worktrees/feat-x (No saved base)"');
		expect(render({ ...clean, base: null })).toContain('title="/work/app-worktrees/feat-x"');
	});

	test("saved base metadata Timber cannot use is a marker on the row, and in what the row tells assistive technology", () => {
		const markup = render({ ...clean, base: { kind: "invalid", reason: "unreadable" } });
		expect(markup).toContain('title="/work/app-worktrees/feat-x (Base unknown)"');
		expect(markersIn(markup)).toEqual([
			{ className: "row-flag", title: "Timber found a saved base for this worktree but cannot use it: it could not be read. The base is not known, and the app does not guess one.", text: "base unknown" },
		]);
		expect(markup).toContain("does not guess one.</span>");
	});

	test("every marker shows its short text and carries its sentence as a tooltip", () => {
		const markup = render(busy);
		expect(markersIn(markup)).toEqual([
			{ className: "sync behind", title: "14 commits to pull from origin/feat/x, as of the last fetch.", text: "14" },
			{ className: "sync ahead", title: "2 commits to push to origin/feat/x, as of the last fetch.", text: "2" },
			{ className: "row-flag", title: "Locked: Git will not prune, move, or remove this worktree until it is unlocked.", text: "locked" },
			{ className: "count modified", title: "3 files with uncommitted changes: modified, added, deleted, or renamed.", text: "3M" },
			{ className: "count untracked", title: "1 untracked file: new, and not added to Git.", text: "1U" },
		]);
	});

	test("assistive technology gets the name from the branch and every marker's sentence as the description", () => {
		const markup = render(busy);
		expect(nameOf(markup)).toBe("feat/x Worktree");
		expect(descriptionOf(markup)).toBe([
			"14 commits to pull from origin/feat/x, as of the last fetch.",
			"2 commits to push to origin/feat/x, as of the last fetch.",
			"Locked: Git will not prune, move, or remove this worktree until it is unlocked.",
			"3 files with uncommitted changes: modified, added, deleted, or renamed.",
			"1 untracked file: new, and not added to Git.",
		].join(" "));
	});

	test("the row stays one button with nothing interactive inside it", () => {
		const markup = render(busy, true);
		expect(markup).toStartWith('<button type="button" class="row selected" aria-current="true"');
		expect(markup).toEndWith("</button>");
		expect(markup.match(/<button/g)?.length).toBe(1);
		expect(markup).not.toMatch(/<a |<input|<select|tabindex|role=/);
	});

	test("commits to pull and to push differ by the arrow drawn, not by color alone", () => {
		const markup = render(busy);
		const down = "M4.5 1.5v7M1.5 5.5l3 3 3-3";
		const up = "M4.5 8.5v-7M1.5 4.5l3-3 3 3";
		expect(markup).toMatch(new RegExp(`class="sync behind"[^>]*><svg aria-hidden="true"[^>]*><path d="${down}"></path></svg>14<`));
		expect(markup).toMatch(new RegExp(`class="sync ahead"[^>]*><svg aria-hidden="true"[^>]*><path d="${up}"></path></svg>2<`));
	});

	test("sync states that are words are shown as words beside the branch", () => {
		const shown = (worktree: Worktree) => markersIn(render(worktree)).map(marker => `${marker.className}: ${marker.text}`);
		expect(shown({ ...clean, sync: { kind: "unpublished" } })).toEqual(["sync-note: local only"]);
		expect(shown({ ...clean, sync: { kind: "gone", upstream: "origin/feat/x" } })).toEqual(["sync-note: upstream gone"]);
		expect(shown({ ...clean, sync: null })).toEqual(["sync-note: sync unknown"]);
	});

	test("a branch whose upstream state is unknown says so in the row and in its description", () => {
		const markup = render({ ...clean, sync: null });
		expect(descriptionOf(markup)).toBe("Git could not say how this branch stands against its upstream. It may have commits to push or to pull.");
	});

	test("a detached HEAD, a locked, and a prunable worktree are marked in words", () => {
		const markup = render({ ...clean, branch: null, detached: true, sync: null, locked: true, prunable: true });
		expect(markersIn(markup).map(marker => marker.text)).toEqual(["detached HEAD", "locked", "prunable"]);
		expect(nameOf(markup)).toBe("detached at 1234567 Worktree");
		expect(descriptionOf(markup)).toStartWith("No branch is checked out here. The folder is at commit 1234567. Locked:");
	});

	test("an unknown status is said, with Timber's reason, and no change count stands in for it", () => {
		const unread: Worktree = { ...clean, canonicalPath: null, changes: { kind: "unknown", reason: "Cannot inspect worktree; check directory access" } };
		const markup = render(unread);
		expect(markersIn(markup)).toEqual([{
			className: "row-flag",
			title: "Timber could not read this worktree, so it may hold changes. Timber says: Cannot inspect worktree; check directory access.",
			text: "status unknown",
		}]);
		expect(markup).not.toContain('class="count');

		const missing = render({ ...unread, pathExists: false, prunable: true, changes: { kind: "unknown", reason: "Worktree path is missing" } });
		expect(markersIn(missing).map(marker => marker.text)).toEqual(["folder missing"]);
		expect(descriptionOf(missing)).toBe("The folder is missing: /work/app-worktrees/feat-x. Its status is unknown.");
	});

	test("every sample row draws exactly its markers, each with a tooltip, and describes them all", () => {
		for (const worktree of browserSampleRepositories.flatMap(repository => repository.worktrees)) {
			const markers = describeRowMarkers(worktree);
			const markup = render(worktree);
			expect(markersIn(markup).map(marker => marker.text)).toEqual(markers.map(marker => marker.text));
			expect(markersIn(markup).every(marker => marker.title.length > 0)).toBe(true);
			expect(descriptionOf(markup)).toBe(markers.length > 0 ? markers.map(marker => marker.tooltip).join(" ") : null);
		}
	});
});
