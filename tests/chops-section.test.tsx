import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { addChopDraft, chopDraftsOf } from "../src/mainview/chop-format";
import { type ChopsRepository, ChopsSectionView } from "../src/mainview/components/settings/ChopsSection";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { AGENT_PRESETS } from "../src/shared/agent";
import type { PersonalChop } from "../src/shared/chops";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FIX = "/work/timber-worktrees/fix-macos-portability";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const idOf = (path: string) => sampleRepositories[0]!.worktrees.find(worktree => worktree.path === path)!.id;

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

const noop = () => {};
const view = (drafts: ReturnType<typeof chopDraftsOf>, repository: ChopsRepository | null, saved: readonly PersonalChop[] = []) =>
	renderToStaticMarkup(
		<ChopsSectionView
			drafts={drafts}
			saved={saved}
			repositories={[{ path: TIMBER, name: "timber" }]}
			agents={AGENT_PRESETS}
			repository={repository}
			save={{ state: "idle" }}
			onAdd={noop}
			onEdit={noop}
			onRemove={noop}
			onSave={noop}
			onReadAgain={noop}
		/>,
	);

describe("Settings, Chops as drawn", () => {
	test("shows each personal chop's fields, and the agent only for a prompt", () => {
		const markup = view(chopDraftsOf([
			{ name: "Test", kind: "command", text: "bun test", description: "Every test", agent: null, repository: null },
			{ name: "Review", kind: "prompt", text: "Review it", description: "", agent: "Codex", repository: TIMBER },
		]), null);
		expect(markup).toContain('value="Test"');
		expect(markup).toContain(">bun test</textarea>");
		expect(markup).toContain('value="Every test"');
		expect(markup.match(/>Agent<\/label>/g)).toHaveLength(1);
		expect(markup).toContain('<option value="Codex" selected="">Codex</option>');
		expect(markup).toContain('<option value="/work/timber" selected="">timber</option>');
		expect(markup).toContain("Select a worktree to see the chops its repository shares.");
	});

	test("a new row says what it needs without an alert", () => {
		const markup = view(addChopDraft([]), null);
		expect(markup).toContain("Type a name and a command, or remove this row.");
		expect(markup).not.toContain('role="alert"');
	});

	test("lists the repository's chops read-only, with where they come from and the ones overridden", () => {
		const markup = view([], {
			repositoryName: "timber",
			list: {
				outcome: "listed",
				file: { state: "read" },
				path: "/work/timber/.timber/chops.json",
				chops: [
					{ name: "Mine", kind: "command", text: "make", description: "", agent: null, source: "personal-every" },
					{ name: "Dev server", kind: "command", text: "bun run dev:web", description: "The interface", agent: null, source: "repository-file" },
				],
				overridden: [{ name: "Test", kind: "command", text: "bun test", description: "", agent: null, source: "repository-file", by: "personal-every" }],
			},
		});
		expect(markup).toContain("timber: /work/timber/.timber/chops.json");
		expect(markup).toContain("from the repository&#x27;s main checkout, for every worktree");
		expect(markup).not.toContain(", branch ");
		expect(markup).toContain("Dev server");
		expect(markup).toContain("Command, From the repository");
		expect(markup).toContain(">bun run dev:web</pre>");
		expect(markup).toContain("Overridden by your chop for every repository");
		// Personal chops are edited above, not listed again with the repository's.
		expect(markup).not.toContain(">make</pre>");
	});

	test("a damaged file shows its reason quietly, and a missing one only a hint", () => {
		const worktree = (file: { state: "missing" } | { state: "damaged"; message: string }): ChopsRepository => ({
			repositoryName: "timber", list: { outcome: "listed", file, path: "/w/.timber/chops.json", chops: [], overridden: [] },
		});
		const damaged = view([], worktree({ state: "damaged", message: "It is not JSON." }));
		expect(damaged).toContain(`<p class="field-error">The app could not use /w/.timber/chops.json: It is not JSON. Your own chops still work.</p>`);
		expect(damaged).not.toContain('role="alert"');
		const missing = view([], worktree({ state: "missing" }));
		expect(missing).toContain("Its main checkout has none.");
		expect(missing).not.toContain("field-error");
	});
});

describe("chops in the app", () => {
	test("reads the repository's chops, merged with the saved ones, and again after a save", async () => {
		const { store } = await startedStore();
		await store.readChops(TIMBER);
		const first = store.getState().chops?.list;
		expect(first?.outcome === "listed" && first.chops.map(chop => chop.name)).toEqual(["Test", "Dev server", "Review the diff"]);

		expect(await store.savePreferences({ chops: [{ name: "test", kind: "command", text: "bun test --watch", description: "", agent: null, repository: null }] })).toMatchObject({ outcome: "saved" });
		await store.readChops(TIMBER);
		const second = store.getState().chops?.list;
		expect(second?.outcome === "listed" && second.chops.map(chop => [chop.name, chop.source])).toEqual([["test", "personal-every"], ["Dev server", "repository-file"], ["Review the diff", "repository-file"]]);
		expect(second?.outcome === "listed" && second.overridden.map(chop => chop.name)).toEqual(["Test"]);
	});

	test("every worktree of a repository shows the same chops", async () => {
		const { store } = await startedStore();
		store.select(idOf(FEATURE));
		await store.readChops(TIMBER);
		const fromFeature = store.getState().chops;
		store.select(idOf(FIX));
		await store.readChops(TIMBER);
		expect(store.getState().chops).toEqual(fromFeature);
		expect(fromFeature).toMatchObject({ repository: TIMBER, list: { outcome: "listed", path: `${TIMBER}/.timber/chops.json` } });
	});

	test("a change to the main checkout's file shows without a read being asked for, through the watch", async () => {
		const { engine, store } = await startedStore();
		await store.readChops(TIMBER);
		engine.setChopsFile(TIMBER, JSON.stringify({ version: 1, chops: [{ name: "Lint", kind: "command", text: "bun run lint" }] }));
		await settle();
		expect(store.getState().chops?.list).toMatchObject({ outcome: "listed", file: { state: "read" }, chops: [{ name: "Lint" }] });
	});

	test("a change to another repository's file reads nothing", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		await store.readChops(TIMBER);
		let reads = 0;
		const listChops = engine.listChops.bind(engine);
		engine.listChops = async request => {
			reads += 1;
			return listChops(request);
		};
		const other = sampleRepositories.find(repository => repository.path !== TIMBER)!.path;
		engine.setChopsFile(other, null);
		engine.announceChange(other);
		await settle();
		expect(reads).toBe(0);
	});

	test("a reload of the repository reads its chops again", async () => {
		const { engine, store } = await startedStore();
		await store.readChops(TIMBER);
		let reads = 0;
		const listChops = engine.listChops.bind(engine);
		engine.listChops = async request => {
			reads += 1;
			return listChops(request);
		};
		engine.announceChange(TIMBER);
		await settle();
		expect(reads).toBe(1);
	});

	test("the sample repository with a damaged file says why", async () => {
		const { store } = await startedStore();
		await store.readChops("/work/api-server");
		expect(store.getState().chops?.list).toMatchObject({ outcome: "listed", file: { state: "damaged", message: expect.stringContaining("Chop 1 (\"Lint\")") } });
	});

	test("the latest read wins", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		const listChops = engine.listChops.bind(engine);
		let release!: () => void;
		const held = new Promise<void>(resolve => (release = resolve));
		engine.listChops = async request => {
			if (request.repository === "/work/api-server") await held;
			return listChops(request);
		};
		const slow = store.readChops("/work/api-server");
		await store.readChops(TIMBER);
		release();
		await slow;
		expect(store.getState().chops?.repository).toBe(TIMBER);
	});

	test("Settings has a Chops section beside Agents, with the selected worktree's repository's chops", async () => {
		const { store } = await startedStore();
		store.select(idOf(TIMBER));
		store.openDialog({ kind: "settings", section: "chops" });
		await store.readChops(TIMBER);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toMatch(/>Agents<\/button><button[^>]*><svg class="settings-nav-icon"[^]*?<\/svg>Chops<\/button>/);
		expect(markup).toMatch(/class="settings-nav-item selected" aria-current="page"[^>]*><svg class="settings-nav-icon"[^]*?<\/svg>Chops</);
		expect(markup).toContain(">Review the diff</span>");
	});
});
