import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { FetchSectionView, type FetchSectionViewProps } from "../src/mainview/components/settings/FetchSection";
import { WorktreeRow } from "../src/mainview/components/WorktreeRow";
import { createMockEngine } from "../src/mainview/engine/mock";
import { describeAgo, describeFetchAction, describeFetchMarker, fetchDraftModel, fetchDraftOf } from "../src/mainview/fetch-format";
import { describeRowMarkers, describeSync } from "../src/mainview/format";
import { createAppStore } from "../src/mainview/store/store";
import type { RepositoryFetch } from "../src/shared/git-fetch";
import type { Worktree } from "../src/shared/model";

const settle = async () => {
	for (let round = 0; round < 5; round++) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const API_SERVER = "/work/api-server";

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

const MINUTE = 60_000;
const NOW = 10 * 24 * 60 * MINUTE;

describe("fetch words", () => {
	test("say how long ago, in a few words", () => {
		expect(describeAgo(NOW, NOW)).toBe("just now");
		expect(describeAgo(NOW - 59_000, NOW)).toBe("just now");
		expect(describeAgo(NOW - MINUTE, NOW)).toBe("1 minute ago");
		expect(describeAgo(NOW - 59 * MINUTE, NOW)).toBe("59 minutes ago");
		expect(describeAgo(NOW - 60 * MINUTE, NOW)).toBe("1 hour ago");
		expect(describeAgo(NOW - 5 * 60 * MINUTE, NOW)).toBe("5 hours ago");
		expect(describeAgo(NOW - 24 * 60 * MINUTE, NOW)).toBe("1 day ago");
		expect(describeAgo(NOW - 3 * 24 * 60 * MINUTE, NOW)).toBe("3 days ago");
		// A clock that went back says "just now", never a negative time.
		expect(describeAgo(NOW + MINUTE, NOW)).toBe("just now");
	});

	test("mark a failed fetch quietly with a word, and say why in the tooltip", () => {
		const failed = (kind: "offline" | "authentication" | "failed", lastFetched: number | null = null): RepositoryFetch =>
			({ repository: TIMBER, fetching: false, lastFetched, failure: { kind, message: "fatal: nope", at: NOW - 2 * MINUTE } });
		expect(describeFetchMarker(undefined, NOW)).toBeNull();
		expect(describeFetchMarker({ repository: TIMBER, fetching: false, lastFetched: NOW, failure: null }, NOW)).toBeNull();
		expect(describeFetchMarker({ ...failed("offline"), fetching: true }, NOW)).toBeNull();
		expect(describeFetchMarker(failed("offline"), NOW)!.text).toBe("offline");
		expect(describeFetchMarker(failed("authentication"), NOW)!.text).toBe("sign-in needed");
		expect(describeFetchMarker(failed("authentication"), NOW)!.tooltip).toContain("never asks in the background");
		const marker = describeFetchMarker(failed("failed", NOW - 90 * MINUTE), NOW)!;
		expect(marker.text).toBe("fetch failed");
		expect(marker.tooltip).toBe("The last fetch failed. The last fetch that worked was 1 hour ago. It failed 2 minutes ago: fatal: nope");
	});

	test("say what Fetch now does and when the repository was last fetched", () => {
		expect(describeFetchAction("timber", undefined, NOW)).toBe("Fetch timber now. Not fetched since the app started. Only remote-tracking branches change.");
		expect(describeFetchAction("timber", { repository: TIMBER, fetching: false, lastFetched: NOW - 3 * MINUTE, failure: null }, NOW))
			.toBe("Fetch timber now. Last fetched 3 minutes ago. Only remote-tracking branches change.");
		expect(describeFetchAction("timber", { repository: TIMBER, fetching: true, lastFetched: null, failure: null }, NOW)).toBe("Fetching timber");
	});
});

describe("the force-pushed marker", () => {
	const row = (sync: Worktree["sync"]): Worktree => ({
		id: "id", path: "/work/timber-worktrees/feat", canonicalPath: "/work/timber-worktrees/feat", branch: "feat", head: "a".repeat(40), primary: false,
		detached: false, locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync, baseCounts: null,
	});
	const rewritten = { kind: "tracking", upstream: "origin/feat", ahead: 1, behind: 2, forcePushed: { at: 5 } } as const;

	test("comes first beside the branch, in words, with the counts after it", () => {
		const markers = describeRowMarkers(row(rewritten));
		expect(markers.map(marker => [marker.kind, marker.text, marker.place])).toEqual([
			["force-pushed", "force-pushed", "branch"],
			["behind", "2", "branch"],
			["ahead", "1", "branch"],
		]);
		expect(markers[0]!.tooltip).toContain("origin/feat was rewritten");
		expect(describeSync(rewritten)).toBe("origin/feat was rewritten: 1 ahead, 2 behind");
		const { forcePushed: _mark, ...plain } = rewritten;
		expect(describeRowMarkers(row(plain)).map(marker => marker.kind)).toEqual(["behind", "ahead"]);
	});

	test("is drawn in the color of rewritten state, never by color alone", () => {
		const markup = renderToStaticMarkup(<WorktreeRow worktree={row(rewritten)} selected={false} onSelect={() => {}} />);
		expect(markup).toContain('<span class="sync-note rewritten" title="The upstream branch origin/feat was rewritten');
		expect(markup).toContain(">force-pushed</span>");
	});
});

describe("the store, when fetching", () => {
	test("reads where fetching stands on start, and follows every report", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		expect(store.getState().fetches[TIMBER]).toEqual({ repository: TIMBER, fetching: false, lastFetched: null, failure: null });
		// Long enough to still be fetching after settle(): on Windows a timer can take about 16 milliseconds.
		engine.setFetchDelay(100);
		const fetching = store.fetchNow(TIMBER);
		await settle();
		expect(store.getState().fetches[TIMBER]!.fetching).toBe(true);
		await fetching;
		expect(store.getState().fetches[TIMBER]!.fetching).toBe(false);
	});

	test("Fetch now that works says so in a toast, and one at a time", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		engine.setFetchDelay(5);
		const first = store.fetchNow(TIMBER);
		expect(await store.fetchNow(TIMBER)).toBeNull();
		expect((await first)?.outcome).toBe("fetched");
		expect(store.getState().toasts.map(toast => toast.text)).toEqual(["Fetched timber"]);
		expect(store.getState().fetches[TIMBER]!.lastFetched).not.toBeNull();
	});

	test("Fetch now that fails leaves a quiet marker and no toast, and never opens a dialog", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		engine.endFetches("offline");
		expect((await store.fetchNow(TIMBER))?.outcome).toBe("failed");
		expect(store.getState().toasts).toEqual([]);
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().fetches[TIMBER]!.failure?.kind).toBe("offline");
		const markup = render(store);
		expect(markup).toContain('<span class="group-flag fetch-failed" title="The last fetch could not reach the remote.');
		expect(markup).toContain(">offline</span>");
		// The marker goes with the next fetch that works.
		engine.endFetches("fetches");
		await store.fetchNow(TIMBER);
		expect(render(store)).not.toContain("fetch-failed");
	});

	test("an engine that does not answer is a quiet failure too", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		engine.fetchNow = async () => {
			throw new Error("bridge closed");
		};
		expect(await store.fetchNow(TIMBER)).toMatchObject({ outcome: "not-listed" });
		expect(store.getState().fetches[TIMBER]!.failure).toMatchObject({ kind: "failed", message: "The app did not hear how the fetch ended: bridge closed" });
		expect(store.getState().toasts).toEqual([]);
	});

	test("each available repository has a Fetch now control that names it, and an unavailable one has none", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).toContain('aria-label="Fetch timber now. Not fetched since the app started. Only remote-tracking branches change."');
		expect(markup).toContain('aria-label="Fetch api-server now.');
		expect(markup.match(/class="icon-button group-fetch"/g)?.length).toBe(2);
	});
});

describe("a branch marked force-pushed", () => {
	const FEATURE = "feat/github-issue-lookup";

	async function marked() {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		const at = engine.forcePush(TIMBER, FEATURE)!;
		await settle();
		const worktree = store.getState().repositories[0]!.worktrees.find(candidate => candidate.branch === FEATURE)!;
		return { engine, store, at, worktree };
	}

	test("shows in its row once the repository is read again", async () => {
		const { store, worktree } = await marked();
		expect(worktree.sync).toMatchObject({ kind: "tracking", forcePushed: {} });
		expect(render(store)).toContain(">force-pushed</span>");
	});

	test("is seen once its worktree was selected in a shown, focused window and the selection moved on", async () => {
		const { engine, store, at, worktree } = await marked();
		const other = store.getState().repositories[0]!.worktrees[0]!;
		store.select(worktree.id);
		expect(engine.seenForcePushes()).toEqual([]);
		store.select(other.id);
		expect(engine.seenForcePushes()).toEqual([{ repository: TIMBER, branch: FEATURE, at }]);
		await settle();
		expect(render(store)).not.toContain(">force-pushed</span>");
	});

	test("seeing an older mark leaves a newer one, and tells the interface nothing", async () => {
		const { engine, at } = await marked();
		const heard: string[] = [];
		engine.onRepositoryChanged(path => heard.push(path));
		engine.forcePushSeen({ repository: TIMBER, branch: FEATURE, at: at - 1 });
		expect(heard).toEqual([]);
		engine.forcePushSeen({ repository: TIMBER, branch: FEATURE, at });
		expect(heard).toEqual([TIMBER]);
	});

	test("is not seen while the window is hidden or has no focus", async () => {
		const { engine, store, worktree } = await marked();
		const other = store.getState().repositories[0]!.worktrees[0]!;
		store.windowChanged({ visible: true, focused: false });
		store.select(worktree.id);
		store.select(other.id);
		store.windowChanged({ visible: false, focused: false });
		store.select(worktree.id);
		store.select(other.id);
		expect(engine.seenForcePushes()).toEqual([]);
	});

	test("that arrives on the selected worktree stays until the selection moves on", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		const worktree = store.getState().repositories[0]!.worktrees.find(candidate => candidate.branch === FEATURE)!;
		store.select(worktree.id);
		const at = engine.forcePush(TIMBER, FEATURE)!;
		await settle();
		expect(render(store)).toContain(">force-pushed</span>");
		expect(engine.seenForcePushes()).toEqual([]);
		store.select(store.getState().repositories[1]!.worktrees[0]!.id);
		expect(engine.seenForcePushes()).toEqual([{ repository: TIMBER, branch: FEATURE, at }]);
		expect(API_SERVER).toBe(store.getState().selection!.repository);
	});
});

describe("the Fetching section of Settings", () => {
	const saved = { background: true, intervalMinutes: 5 };

	test("saves only a whole number of minutes within the limits that differs from what is saved", () => {
		expect(fetchDraftModel(fetchDraftOf(saved), saved)).toEqual({ setting: saved, error: null, canSave: false });
		expect(fetchDraftModel({ background: false, interval: "5" }, saved)).toEqual({ setting: { background: false, intervalMinutes: 5 }, error: null, canSave: true });
		expect(fetchDraftModel({ background: true, interval: " 30 " }, saved).setting).toEqual({ background: true, intervalMinutes: 30 });
		expect(fetchDraftModel({ background: true, interval: "" }, saved)).toEqual({ setting: null, error: "Enter how many minutes to wait between fetches.", canSave: false });
		for (const interval of ["0", "1441", "2.5", "-3", "ten", "1e3"]) {
			expect(fetchDraftModel({ background: true, interval }, saved)).toEqual({ setting: null, error: "Enter a whole number of minutes from 1 to 1440.", canSave: false });
		}
	});

	const view = (props: Partial<FetchSectionViewProps>) => renderToStaticMarkup(
		<FetchSectionView draft={fetchDraftOf(saved)} saved={saved} save={{ state: "idle" }} onEdit={() => {}} onSave={() => {}} {...props} />,
	);

	test("draws the switch, the interval, and why an interval cannot be saved", () => {
		const markup = view({});
		expect(markup).toContain("Fetch in the background");
		expect(markup).toContain('value="5"');
		expect(markup).toContain("never pulls, merges, rebases, or changes a local branch or a working tree");
		expect(markup).toContain('aria-disabled="true">Save</button>');
		const wrong = view({ draft: { background: true, interval: "0" } });
		expect(wrong).toContain('aria-invalid="true"');
		expect(wrong).toContain("Enter a whole number of minutes from 1 to 1440.");
	});

	test("is a section of the dialog, and saving it changes the preferences the engine holds", async () => {
		const { store, engine } = await startedStore();
		store.openDialog({ kind: "settings", section: "fetch" });
		expect(render(store)).toContain(">Fetching</button>");
		expect(await store.savePreferences({ fetch: { background: false, intervalMinutes: 15 } })).toMatchObject({ outcome: "saved" });
		expect((await engine.loadPreferences()).fetch).toEqual({ background: false, intervalMinutes: 15 });
		expect(store.getState().preferences.fetch).toEqual({ background: false, intervalMinutes: 15 });
	});
});
