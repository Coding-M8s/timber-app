import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createChops } from "../src/bun/chops";
import { createSavedPreferences } from "../src/bun/preferences";
import { createSettingsHolder } from "../src/bun/settings";
import { App } from "../src/mainview/App";
import {
	type ChopForm, blankChopForm, chopEditBlockedReason, chopFormNotes, chopFormOf, chopTargetOf, chopsWithSaved, chopsWithout, describeChopDelete, describeFileChopView, panelChopScopeOptions,
} from "../src/mainview/chop-format";
import { chopRowMenuItems, chopsNewBlockedReason, chopsPanelModel, describeChopsPanelEmpty, describeChopsTabEmpty } from "../src/mainview/chops-panel-format";
import { ChopFormView, DeleteChopView, FileChopView } from "../src/mainview/components/ChopEditor";
import { ChopsSectionView } from "../src/mainview/components/settings/ChopsSection";
import { chopDraftsOf } from "../src/mainview/chop-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { CHOP_DESCRIPTION_LIMIT, CHOP_LIMIT, CHOP_TEXT_LIMIT, type ChopList, type PersonalChop } from "../src/shared/chops";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

const REPO = "/work/timber";
const every = (name: string, text = "bun test"): PersonalChop => ({ name, kind: "command", text, description: "", agent: null, repository: null, sound: null });
const here = (name: string, text = "bun test"): PersonalChop => ({ ...every(name, text), repository: REPO });
const form = (change: Partial<ChopForm> = {}): ChopForm => ({ ...blankChopForm("command", REPO), name: "Lint", text: "bun run lint", ...change });

describe("making, changing, and deleting chops from the panel", () => {
	test("a new chop goes at the end, for the repository chosen, cleaned as Settings cleans it", () => {
		const saved = [every("Test")];
		const check = chopsWithSaved(saved, null, form({ text: "a\r\nb", description: "  Lints  " }));
		expect(check).toEqual({ ok: true, chop: { ...here("Lint", "a\nb"), description: "Lints" }, chops: [every("Test"), { ...here("Lint", "a\nb"), description: "Lints" }] });
	});

	test("a prompt keeps its agent and a command drops it", () => {
		expect(chopsWithSaved([], null, form({ kind: "prompt", agent: "Codex" }))).toMatchObject({ ok: true, chop: { kind: "prompt", agent: "Codex" } });
		expect(chopsWithSaved([], null, form({ kind: "command", agent: "Codex" }))).toMatchObject({ ok: true, chop: { kind: "command", agent: null } });
	});

	test("an edit keeps the chop's place, and can rename it, change its case, or move it to every repository", () => {
		const saved = [every("Test"), here("Lint"), every("Build")];
		const target = { name: "lint", repository: REPO };
		expect(chopFormOf(saved, target)).toEqual(here("Lint"));
		const renamed = chopsWithSaved(saved, target, form({ name: "Check" }));
		expect(renamed.ok && renamed.chops.map(chop => chop.name)).toEqual(["Test", "Check", "Build"]);
		const recased = chopsWithSaved(saved, target, form({ name: "LINT" }));
		expect(recased.ok && recased.chops[1]!.name).toBe("LINT");
		const moved = chopsWithSaved(saved, target, form({ repository: null }));
		expect(moved.ok && moved.chops[1]).toEqual(every("Lint", "bun run lint"));
	});

	test("names are unique ignoring case within their group, and may repeat across groups", () => {
		const saved = [every("Test"), here("Lint")];
		expect(chopsWithSaved(saved, null, form({ name: "LINT" }))).toEqual({ ok: false, problem: 'Another chop is already called "LINT".' });
		expect(chopsWithSaved(saved, null, form({ name: "test", repository: null }))).toEqual({ ok: false, problem: 'Another chop is already called "test".' });
		expect(chopsWithSaved(saved, null, form({ name: "test" })).ok).toBe(true);
		expect(chopsWithSaved(saved, { name: "Test", repository: null }, form({ name: "Lint" })).ok).toBe(false);
	});

	test("the text and description limits, and control characters, are refused as in Settings", () => {
		expect(chopsWithSaved([], null, form({ name: "" }))).toEqual({ ok: false, problem: "Give the chop a name." });
		expect(chopsWithSaved([], null, form({ text: "   " }))).toEqual({ ok: false, problem: "Type the command." });
		expect(chopsWithSaved([], null, form({ kind: "prompt", text: "" }))).toEqual({ ok: false, problem: "Type the prompt." });
		expect(chopsWithSaved([], null, form({ text: "x".repeat(CHOP_TEXT_LIMIT + 1) }))).toMatchObject({ ok: false, problem: expect.stringContaining("longer than") });
		expect(chopsWithSaved([], null, form({ text: "x".repeat(CHOP_TEXT_LIMIT) })).ok).toBe(true);
		expect(chopsWithSaved([], null, form({ text: "echo \u001b[2J" }))).toMatchObject({ ok: false, problem: expect.stringContaining("control or invisible character") });
		expect(chopsWithSaved([], null, form({ text: "echo ‮" }))).toMatchObject({ ok: false, problem: expect.stringContaining("control or invisible character") });
		expect(chopsWithSaved([], null, form({ text: "a\rb" }))).toMatchObject({ ok: false, problem: expect.stringContaining("carriage return") });
		expect(chopsWithSaved([], null, form({ text: "one\n\ttwo" })).ok).toBe(true);
		expect(chopsWithSaved([], null, form({ description: "x".repeat(CHOP_DESCRIPTION_LIMIT + 1) }))).toMatchObject({ ok: false, problem: expect.stringContaining("description is longer") });
		expect(chopsWithSaved([], null, form({ description: "one\ntwo" }))).toMatchObject({ ok: false, problem: expect.stringContaining("one line") });
	});

	test("no more than the limit, and an edit of a chop that is gone is refused", () => {
		const full = Array.from({ length: CHOP_LIMIT }, (_, index) => every(`Chop ${index}`));
		expect(chopsWithSaved(full, null, form())).toMatchObject({ ok: false, problem: expect.stringContaining(`${CHOP_LIMIT} chops`) });
		expect(chopsWithSaved(full, { name: "Chop 3", repository: null }, form({ repository: null })).ok).toBe(true);
		expect(chopsWithSaved([], { name: "Gone", repository: null }, form())).toMatchObject({ ok: false, problem: expect.stringContaining("Gone is no longer saved") });
	});

	test("delete takes only the target, by group and name ignoring case", () => {
		const saved = [every("Test"), here("Test"), here("Lint")];
		expect(chopsWithout(saved, { name: "test", repository: REPO })).toEqual([every("Test"), here("Lint")]);
		expect(chopsWithout(saved, { name: "Test", repository: null })).toEqual([here("Test"), here("Lint")]);
		expect(chopsWithout(saved, { name: "Missing", repository: null })).toBeNull();
	});

	test("a chop from the repository file is never a target", () => {
		expect(chopTargetOf({ name: "Test", source: "repository-file" }, REPO)).toBeNull();
		expect(chopTargetOf({ name: "Test", source: "personal-repository" }, REPO)).toEqual({ name: "Test", repository: REPO });
		expect(chopTargetOf({ name: "Test", source: "personal-every" }, REPO)).toEqual({ name: "Test", repository: null });
		expect(chopRowMenuItems("repository-file", null).map(item => item.id)).toEqual(["view"]);
		expect(chopRowMenuItems("personal-every", null).map(item => [item.id, item.disabled])).toEqual([["edit", false], ["delete", false]]);
	});

	test("the form notes a chop of the same name that it takes the place of, without stopping the save", () => {
		const list: ChopList = {
			outcome: "listed", file: { state: "read" }, path: `${REPO}/.timber/chops.json`, overridden: [],
			chops: [{ ...every("Mine"), source: "personal-every", sound: null }, { name: "Test", kind: "command", text: "bun test", description: "", agent: null, source: "repository-file", sound: null }],
		};
		expect(chopFormNotes(form({ name: "test" }), list, REPO, null)).toEqual([`It takes the place of the chop called test in ${REPO}/.timber/chops.json here. That file is not changed.`]);
		expect(chopFormNotes(form({ name: "Mine" }), list, REPO, null)).toEqual(["It takes the place of your chop called Mine for every repository, here."]);
		// Its own row is not another chop.
		expect(chopFormNotes(form({ name: "Mine", repository: null }), list, REPO, { name: "Mine", repository: null })).toEqual([]);
		expect(chopFormNotes(form({ name: "Other" }), list, REPO, null)).toEqual([]);
	});

	test("changes are blocked while the saved settings could not be read, and New chop needs a listed repository", () => {
		const blocked = chopEditBlockedReason("Unexpected token");
		expect(blocked).toContain("could not be read");
		expect(chopEditBlockedReason(null)).toBeNull();
		expect(chopRowMenuItems("personal-every", blocked).every(item => item.disabled)).toBe(true);
		expect(chopsNewBlockedReason({ repository: REPO, failure: null, reading: false }, blocked)).toBe(blocked);
		expect(chopsNewBlockedReason({ repository: REPO, failure: null, reading: false }, null)).toBeNull();
		expect(chopsNewBlockedReason({ repository: null, failure: null, reading: true }, null)).toBe("The chops are being read.");
		expect(chopsNewBlockedReason({ repository: null, failure: null, reading: false }, null)).toContain("Select a worktree");
		expect(chopsNewBlockedReason({ repository: REPO, failure: "Gone", reading: false }, null)).toContain("could not be listed");
	});

	test("the words: delete, the empty states, the scope, and a file chop's view", () => {
		expect(describeChopDelete({ name: "Lint", repository: null }, "timber")).toBe("Delete Lint? It goes from your chops for every repository, here and in Settings.");
		expect(describeChopDelete({ name: "Lint", repository: REPO }, "timber")).toBe("Delete Lint? It goes from your chops for timber, here and in Settings.");
		expect(describeChopsPanelEmpty(true, 0)).toBe("Chops are saved commands and agent prompts to run in a worktree. None yet. Make one with New chop, or share some with everyone in .timber/chops.json.");
		expect(describeChopsTabEmpty("prompt", "")).toBe("No prompts yet. Make one with New chop.");
		expect(panelChopScopeOptions({ path: REPO, name: "timber" })).toEqual([{ value: REPO, label: "This repository (timber)" }, { value: "", label: "Every repository" }]);
		expect(describeFileChopView("/r/.timber/chops.json")).toContain("which the app only reads");
	});
});

describe("the panel's form, file chop view, and delete question as drawn", () => {
	const scope = panelChopScopeOptions({ path: REPO, name: "timber" });
	const props = { idBase: "f", scopeOptions: scope, agents: [{ name: "Codex", command: "codex" }], problem: null, tried: false, notes: [], failure: null, blocked: null, saving: false, soundProblem: null, customSoundPath: undefined, onChange: () => {}, onChooseSoundFile: () => {}, onPlaySound: () => {}, onSave: () => {}, onCancel: () => {} };

	test("a new command: kind, scope, name, text, description, Save and Cancel, no Delete or agent", () => {
		const markup = renderToStaticMarkup(<ChopFormView {...props} mode="new" form={blankChopForm("command", REPO)} problem="Give the chop a name." />);
		expect(markup).toContain("New command");
		expect(markup).toContain(">This repository (timber)</option>");
		expect(markup).toContain(">Command</label>");
		expect(markup).toContain(">Description (optional)</label>");
		expect(markup).not.toContain(">Agent</label>");
		expect(markup).not.toContain(">Delete<");
		// Nothing typed: it says what it needs, without an alert.
		expect(markup).toContain('<p class="field-hint">Type a name and a command.</p>');
		expect(markup).not.toContain('role="alert"');
	});

	test("editing a prompt: its agent, Delete, and a tried problem as an alert", () => {
		const markup = renderToStaticMarkup(<ChopFormView {...props} mode="edit" form={form({ kind: "prompt", agent: "Codex" })} problem='Another chop is already called "Lint".' tried onDelete={() => {}} />);
		expect(markup).toContain("Edit Lint");
		expect(markup).toContain(">Agent</label>");
		expect(markup).toContain('<option value="Codex" selected="">Codex</option>');
		expect(markup).toContain(">Delete</button>");
		expect(markup).toContain('role="alert">Another chop is already called &quot;Lint&quot;.</p>');
	});

	test("blocked or saving, Save says so and is off", () => {
		const markup = renderToStaticMarkup(<ChopFormView {...props} mode="new" form={form()} blocked="Blocked." saving />);
		expect(markup).toMatch(/type="submit" class="button primary" aria-disabled="true" title="Blocked.">Saving</);
	});

	test("a file chop is shown whole with only Close", () => {
		const chop = { name: "Dev", kind: "command" as const, text: "bun run dev", description: "Serve", agent: null, source: "repository-file" as const, sound: null };
		const markup = renderToStaticMarkup(<FileChopView idBase="v" chop={chop} path="/r/.timber/chops.json" saving={false} blocked={null} soundProblem={null} customSoundPath={undefined} onClose={() => {}} onPickSound={() => {}} onChooseSoundFile={() => {}} onPlaySound={() => {}} />);
		expect(markup).toContain("bun run dev");
		expect(markup).toContain("which the app only reads");
		expect(markup).toContain(">Close</button>");
		expect(markup).not.toContain("<input");
		expect(markup).not.toContain(">Save<");
	});

	test("the delete question has Cancel first, then Delete", () => {
		const markup = renderToStaticMarkup(<DeleteChopView idBase="d" question="Delete Lint?" failure={null} blocked={null} saving={false} onDelete={() => {}} onCancel={() => {}} />);
		expect(markup.indexOf(">Cancel<")).toBeLessThan(markup.indexOf(">Delete<"));
		expect(markup).toContain("Delete Lint?");
	});
});

describe("saving from the panel over the mock engine", () => {
	const FEATURE = sampleRepositories[0]!.worktrees[1]!;
	const settle = async () => {
		for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
	};

	async function startedStore() {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.select(FEATURE.id);
		await store.readChops(REPO);
		return { engine, store };
	}

	test("a chop made, changed, and deleted from the panel is the list Settings shows, and the list is read again", async () => {
		const { store } = await startedStore();
		const made = chopsWithSaved(store.getState().preferences.chops, null, form({ name: "Lint" }));
		expect(made.ok).toBe(true);
		if (!made.ok) return;
		expect(await store.savePreferences({ chops: made.chops })).toMatchObject({ outcome: "saved" });
		await store.readChops(REPO);
		expect(chopsPanelModel(store.getState(), "command", "").rows.map(row => [row.chop.name, row.source])).toContainEqual(["Lint", "this repository"]);
		// Settings draws its rows from the same saved list.
		const saved = store.getState().preferences.chops;
		const settings = renderToStaticMarkup(
			<ChopsSectionView
				drafts={chopDraftsOf(saved)} saved={saved} switches={{ useChops: true, playChopSounds: true }} canSave={false} repositories={store.getState().repositories} agents={[]} repository={null}
				save={{ state: "idle" }} onSwitch={() => {}} onAdd={() => {}} onEdit={() => {}} onRemove={() => {}} onSave={() => {}} onReadAgain={() => {}}
			/>,
		);
		expect(settings).toContain('value="Lint"');
		expect(settings).toContain(">bun run lint</textarea>");

		const changed = chopsWithSaved(store.getState().preferences.chops, { name: "Lint", repository: REPO }, form({ name: "Lint all", repository: null }));
		if (!changed.ok) throw new Error(changed.problem);
		await store.savePreferences({ chops: changed.chops });
		expect(store.getState().preferences.chops).toEqual([every("Lint all", "bun run lint")]);

		const gone = chopsWithout(store.getState().preferences.chops, { name: "lint all", repository: null })!;
		await store.savePreferences({ chops: gone });
		await store.readChops(REPO);
		expect(store.getState().preferences.chops).toEqual([]);
		// The repository file's chops are still listed: deleting yours never touches them.
		expect(chopsPanelModel(store.getState(), "command", "").rows.map(row => row.chop.name)).toEqual(["Test", "Dev server"]);
	});

	test("the panel draws New chop, each row's actions, and the empty state's button", async () => {
		const { engine, store } = await startedStore();
		store.toggleChopsPanel();
		let panel = renderToStaticMarkup(<App store={store} />).split('id="chops-panel"')[1]!;
		expect(panel).toMatch(/aria-label="New chop" aria-disabled="false"/);
		expect(panel).toContain('aria-label="Actions for Dev server" aria-haspopup="menu"');
		await store.savePreferences({ chops: [] });
		// With no file and none of your own, the empty state shows with its button.
		engine.setChopsFile(REPO, null);
		await store.readChops(REPO);
		panel = renderToStaticMarkup(<App store={store} />).split('id="chops-panel"')[1]!;
		expect(panel).toContain("Chops are saved commands and agent prompts to run in a worktree. None yet. Make one with New chop");
		expect(panel).toContain('class="button quiet chops-panel-empty-new">New chop</button>');
	});

	test("with the saved settings unread, New chop is off and says why", async () => {
		const { store } = await startedStore();
		(store.getState() as { preferencesProblem: string | null }).preferencesProblem = "Unexpected token";
		store.toggleChopsPanel();
		const panel = renderToStaticMarkup(<App store={store} />).split('id="chops-panel"')[1]!;
		expect(panel).toMatch(/aria-label="New chop" aria-disabled="true" title="The saved settings could not be read/);
	});
});

// The file and its folder are part of what is tested.
describe.skipIf(windows)("saving chops leaves a real repository's file as it is", () => {
	let root: string;
	let primary: string;
	let lone: string;
	const fileText = `${JSON.stringify({ version: 1, chops: [{ name: "Test", kind: "command", text: "bun test" }] }, null, "\t")}\n`;
	const repository = (path: string): Repository => ({ path, name: "sample", available: true, failure: null, setup: "repository", worktrees: [] });

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-chops-edit-")));
		primary = join(root, "sample");
		lone = join(root, "lone");
		git(root, "init", "--initial-branch=main", primary);
		mkdirSync(join(primary, ".timber"));
		writeFileSync(join(primary, ".timber", "chops.json"), fileText);
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Share chops");
		git(root, "init", "--initial-branch=main", lone);
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("a chop that takes the place of the file's, changed and deleted, leaves the file's bytes, time, and the repository unchanged", async () => {
		const path = join(primary, ".timber", "chops.json");
		const bytes = readFileSync(path);
		const { mtimeMs } = statSync(path);
		const before = fingerprint(primary);
		const preferences = createSavedPreferences(createSettingsHolder(join(root, "settings.json"), () => {}));
		const chops = createChops({
			findRepository: async folder => folder === primary || folder === lone ? repository(folder) : null,
			personal: async () => (await preferences.load()).chops,
		});

		const made = chopsWithSaved((await preferences.load()).chops, null, { ...blankChopForm("command", primary), name: "test", text: "bun test --watch" });
		if (!made.ok) throw new Error(made.problem);
		expect(await preferences.save({ chops: made.chops })).toMatchObject({ outcome: "saved" });
		const listed = await chops.list({ repository: primary });
		expect(listed).toMatchObject({ outcome: "listed", overridden: [{ name: "Test", by: "personal-repository" }] });
		expect(listed.outcome === "listed" && listed.chops.map(chop => [chop.name, chop.source])).toEqual([["test", "personal-repository"]]);

		const changed = chopsWithSaved((await preferences.load()).chops, { name: "test", repository: primary }, { ...blankChopForm("command", null), name: "test", text: "bun test --bail" });
		if (!changed.ok) throw new Error(changed.problem);
		await preferences.save({ chops: changed.chops });
		await preferences.save({ chops: chopsWithout((await preferences.load()).chops, { name: "TEST", repository: null })! });
		expect((await preferences.load()).chops).toEqual([]);

		expect(readFileSync(path).equals(bytes)).toBe(true);
		expect(statSync(path).mtimeMs).toBe(mtimeMs);
		expect(fingerprint(primary)).toBe(before);
	});

	test("a chop saved for a repository with no file creates no .timber folder", async () => {
		const preferences = createSavedPreferences(createSettingsHolder(join(root, "settings-lone.json"), () => {}));
		const made = chopsWithSaved([], null, { ...blankChopForm("command", lone), name: "Mine", text: "make" });
		if (!made.ok) throw new Error(made.problem);
		await preferences.save({ chops: made.chops });
		const listed = await createChops({ findRepository: async folder => folder === lone ? repository(lone) : null, personal: async () => (await preferences.load()).chops }).list({ repository: lone });
		expect(listed).toMatchObject({ outcome: "listed", file: { state: "missing" } });
		expect(existsSync(join(lone, ".timber"))).toBe(false);
	});
});
