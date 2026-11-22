import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChops } from "../src/bun/chops";
import { blankChopForm, chopDraftsOf, chopOf, chopsDraftModel, chopsSectionChange, chopsWithSaved, editChopDraft, panelChopScopeOptions } from "../src/mainview/chop-format";
import { chopsPanelModel } from "../src/mainview/chops-panel-format";
import { CHOP_SOUND_HINT, ChopFormView, FileChopView } from "../src/mainview/components/ChopEditor";
import { ChopsSectionView } from "../src/mainview/components/settings/ChopsSection";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { MAX_SOUND_MILLISECONDS, type SoundProcess, createSoundPlayer } from "../src/bun/sounds";
import {
	FILE_CHOP_SOUND_LIMIT, FILE_CHOP_SOUND_REPOSITORY_LIMIT, type FileChopSound, type FileChopSounds, chopSoundToPlay, fileChopSoundOf, readFileChopSounds, salvageFileChopSounds, sameFileChopSounds,
	withFileChopSound, writeFileChopSounds,
} from "../src/shared/chop-sounds";
import {
	type Chop, type PersonalChop, chopDigestInput, mergeChops, parseChopsFile, readPersonalChops, salvagePersonalChops, samePersonalChops, writePersonalChops,
} from "../src/shared/chops";
import { defaultPreferences, readPreferences, writePreferences } from "../src/shared/preferences";
import type { SoundChoice } from "../src/shared/sound-setting";
import type { Repository } from "../src/shared/model";
import type { OpenTerminalResult, TerminalSession } from "../src/shared/terminal";
import { windows } from "./support/runtime";

const CHIME: SoundChoice = { kind: "bundled", name: "chime" };
const PING: SoundChoice = { kind: "bundled", name: "ping" };
const KNOCK: SoundChoice = { kind: "bundled", name: "knock" };
const REPO = "/work/timber";

const mine = (name: string, sound: SoundChoice | null = null, more: Partial<PersonalChop> = {}): PersonalChop => ({ name, kind: "command", text: `run ${name}`, description: "", agent: null, repository: null, sound, ...more });
const fileChop = (name: string): Chop => ({ name, kind: "command", text: `run ${name}`, description: "", agent: null });

describe("a personal chop's sound, saved with the chop", () => {
	test("is written only when it has one, and reads back the same", () => {
		const chops = [mine("Quiet"), mine("Loud", PING), mine("Own", { kind: "custom", path: "/home/me/bell.ogg" }, { repository: REPO })];
		const written = writePersonalChops(chops);
		expect(written[0]).not.toHaveProperty("sound");
		expect(written[1]).toEqual({ name: "Loud", kind: "command", text: "run Loud", sound: { kind: "bundled", name: "ping" } });
		expect(readPersonalChops(JSON.parse(JSON.stringify(written)))).toEqual(chops);
		expect(readPreferences(writePreferences({ ...defaultPreferences(), chops })).chops).toEqual(chops);
	});

	test("a missing or null sound is none, so the list the window holds reads as it is", () => {
		expect(readPersonalChops([{ name: "A", kind: "command", text: "a" }])).toEqual([mine("A", null, { text: "a" })]);
		expect(readPersonalChops([{ name: "A", kind: "command", text: "a", sound: null }])).toEqual([mine("A", null, { text: "a" })]);
	});

	test("a sound that cannot be read refuses a save, and plays the chime when the settings file is salvaged", () => {
		const bad = [{ name: "A", kind: "command", text: "a", sound: { kind: "custom", path: "relative.wav" } }];
		expect(readPersonalChops(bad)).toBeUndefined();
		expect(salvagePersonalChops(bad)).toEqual([mine("A", CHIME, { text: "a" })]);
		expect(readPreferences({ chops: bad }).chops).toEqual([mine("A", CHIME, { text: "a" })]);
	});

	test("a changed sound is a change to save", () => {
		expect(samePersonalChops([mine("A", PING)], [mine("A", PING)])).toBe(true);
		expect(samePersonalChops([mine("A", PING)], [mine("A", KNOCK)])).toBe(false);
		expect(samePersonalChops([mine("A", PING)], [mine("A")])).toBe(false);
	});
});

describe("the repository file never sets a sound", () => {
	test("a sound in .timber/chops.json is passed over, and the approval digest is the same with or without one", () => {
		const reading = parseChopsFile(JSON.stringify({ version: 1, chops: [{ name: "Test", kind: "command", text: "bun test", sound: { kind: "bundled", name: "knock" } }] }));
		expect(reading).toEqual({ ok: true, chops: [{ name: "Test", kind: "command", text: "bun test", description: "", agent: null }] });
		expect(chopDigestInput({ ...mine("Test", PING), text: "bun test" })).toBe(chopDigestInput({ kind: "command", text: "bun test" }));
	});
});

describe("merging gives each listed chop its sound", () => {
	test("a personal chop has its own, a file chop the one kept for it, by name ignoring case, and one taken over keeps its own", () => {
		const merged = mergeChops([mine("Lint", KNOCK)], REPO, [fileChop("Test"), fileChop("Dev"), fileChop("Lint")], [{ name: "test", sound: PING }, { name: "Lint", sound: CHIME }]);
		expect(merged.chops.map(chop => [chop.name, chop.sound])).toEqual([["Lint", KNOCK], ["Test", PING], ["Dev", null]]);
		expect(merged.overridden.map(chop => [chop.name, chop.sound])).toEqual([["Lint", CHIME]]);
	});
});

describe("file chop sounds, kept in the app's settings", () => {
	test("none until one is set; setting None takes the entry away, and the repository with its last one", () => {
		expect(defaultPreferences().fileChopSounds).toEqual({});
		const one = withFileChopSound({}, REPO, "Test", PING);
		expect(one).toEqual({ [REPO]: [{ name: "Test", sound: PING }] });
		expect(fileChopSoundOf(one, REPO, "TEST")).toEqual(PING);
		expect(fileChopSoundOf(one, "/elsewhere", "Test")).toBeNull();
		const changed = withFileChopSound(one, REPO, "test", KNOCK);
		expect(changed).toEqual({ [REPO]: [{ name: "test", sound: KNOCK }] });
		expect(withFileChopSound(changed, REPO, "Test", null)).toEqual({});
	});

	test("round-trip through the settings file, and compare by name and sound", () => {
		const sounds: Record<string, FileChopSound[]> = { [REPO]: [{ name: "Test", sound: PING }, { name: "Dev", sound: { kind: "system" } }] };
		expect(readFileChopSounds(JSON.parse(JSON.stringify(writeFileChopSounds(sounds))))).toEqual(sounds);
		expect(readPreferences(writePreferences({ ...defaultPreferences(), fileChopSounds: sounds })).fileChopSounds).toEqual(sounds);
		expect(sameFileChopSounds(sounds, structuredClone(sounds))).toBe(true);
		expect(sameFileChopSounds(sounds, withFileChopSound(sounds, REPO, "Test", KNOCK))).toBe(false);
	});

	test("a save with anything that cannot be read is refused whole", () => {
		expect(readFileChopSounds({ [REPO]: [{ name: "Test", sound: null }] })).toBeUndefined();
		expect(readFileChopSounds({ [REPO]: [{ name: "Test", sound: PING }, { name: "test", sound: PING }] })).toBeUndefined();
		expect(readFileChopSounds({ [REPO]: [{ name: " Test", sound: PING }] })).toBeUndefined();
		expect(readFileChopSounds({ "": [] })).toBeUndefined();
		expect(readFileChopSounds([])).toBeUndefined();
	});

	test("a repository key such as __proto__ is an entry like any other", () => {
		const saved = JSON.parse(`{"__proto__": [{ "name": "Test", "sound": { "kind": "bundled", "name": "ping" } }]}`);
		expect(Object.hasOwn(readFileChopSounds(saved)!, "__proto__")).toBe(true);
		expect(fileChopSoundOf(readFileChopSounds(saved)!, "__proto__", "Test")).toEqual(PING);
		expect(fileChopSoundOf(salvageFileChopSounds(saved)!, "__proto__", "Test")).toEqual(PING);
	});

	test("a hand-edited settings file keeps what it can: a bad name goes, a bad sound plays the chime", () => {
		const saved = { [REPO]: [{ name: "Test", sound: { kind: "bundled", name: "gong" } }, { name: 3, sound: PING }, { name: "Dev", sound: PING }, { name: "dev", sound: KNOCK }] };
		expect(salvageFileChopSounds(saved)).toEqual({ [REPO]: [{ name: "Test", sound: CHIME }, { name: "Dev", sound: PING }] });
		expect(readPreferences({ fileChopSounds: saved }).fileChopSounds).toEqual({ [REPO]: [{ name: "Test", sound: CHIME }, { name: "Dev", sound: PING }] });
	});

	test("past the limits the ones changed longest ago are dropped, so a save never becomes unreadable", () => {
		let sounds: FileChopSounds = {};
		for (let index = 0; index <= FILE_CHOP_SOUND_LIMIT; index += 1) sounds = withFileChopSound(sounds, REPO, `Chop ${index}`, PING);
		expect(sounds[REPO]).toHaveLength(FILE_CHOP_SOUND_LIMIT);
		expect(fileChopSoundOf(sounds, REPO, "Chop 0")).toBeNull();
		expect(fileChopSoundOf(sounds, REPO, `Chop ${FILE_CHOP_SOUND_LIMIT}`)).toEqual(PING);
		expect(readFileChopSounds(sounds)).toEqual(sounds as Record<string, never>);
		let many: FileChopSounds = {};
		for (let index = 0; index <= FILE_CHOP_SOUND_REPOSITORY_LIMIT; index += 1) many = withFileChopSound(many, `/work/${index}`, "Test", PING);
		expect(Object.keys(many)).toHaveLength(FILE_CHOP_SOUND_REPOSITORY_LIMIT);
		expect(Object.hasOwn(many, "/work/0")).toBe(false);
		expect(readFileChopSounds(many)).toBeDefined();
	});
});

describe("when a chop's sound plays", () => {
	test("its own sound, unless Play each chop's sound is off, which is on by default", () => {
		expect(defaultPreferences().playChopSounds).toBe(true);
		expect(chopSoundToPlay({ sound: PING }, true)).toEqual(PING);
		expect(chopSoundToPlay({ sound: PING }, false)).toBeNull();
		expect(chopSoundToPlay({ sound: null }, true)).toBeNull();
	});
});

// The main process's chops, with a real repository folder and pretend terminals.
describe.skipIf(windows)("a chop's sound plays as it starts, in the main process", () => {
	let root: string;
	let checkout: string;
	let bin: string;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-chop-sounds-")));
		checkout = join(root, "sample");
		mkdirSync(checkout);
		mkdirSync(join(checkout, ".timber"));
		writeFileSync(join(checkout, ".timber", "chops.json"), JSON.stringify({ version: 1, chops: [{ name: "Shared", kind: "command", text: "make" }] }));
		bin = join(root, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "pw-play"), "#!/bin/sh\nexit 0\n");
		chmodSync(join(bin, "pw-play"), 0o755);
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const listed = (): Repository => ({
		path: checkout, name: "sample", available: true, failure: null, setup: "repository",
		worktrees: [{
			id: checkout, path: checkout, canonicalPath: checkout, branch: "main", head: null, primary: true, detached: false, locked: false, prunable: false,
			pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
		}],
	});

	interface Saved {
		personal: PersonalChop[];
		play: boolean;
		file: FileChopSounds;
		/** What the terminal answers when a chop opens one. */
		opens: "opened" | "failed";
		/** Reading the sounds throws, as a damaged settings read would. */
		unreadable?: boolean;
	}

	function setUp(saved: Saved, playSound: (choice: SoundChoice) => void) {
		const warnings: string[] = [];
		const session: TerminalSession = { id: "s1", kind: "terminal", name: "x", repository: checkout, worktree: checkout, path: checkout, shell: "/bin/sh", command: "/bin/sh", state: { kind: "running" }, status: null, children: [] };
		const runner = createChops({
			findRepository: async path => path === checkout ? listed() : null,
			personal: async () => saved.personal,
			openTerminal: async (): Promise<OpenTerminalResult> => saved.opens === "opened" ? { outcome: "opened", session } : { outcome: "failed", message: "not started" },
			sendPrompt: id => id === "gone" ? { outcome: "gone", message: "The session has ended." } : { outcome: "pasted" },
			session: () => session,
			agents: async () => [{ name: "Codex", command: "codex" }],
			locate: () => ({ state: "found", path: "/usr/bin/codex" }),
			chopSounds: async () => {
				if (saved.unreadable) throw new Error("unreadable");
				return { play: saved.play, file: saved.file };
			},
			playSound,
			warn: message => warnings.push(message),
		});
		return { runner, warnings };
	}

	const request = () => ({ repository: checkout, worktree: checkout, cols: 80, rows: 24 });

	test("a command chop's own sound plays once it opened, and a chop without one plays nothing", async () => {
		const played: SoundChoice[] = [];
		const saved: Saved = { personal: [mine("Loud", PING), mine("Quiet")], play: true, file: {}, opens: "opened" };
		const { runner } = setUp(saved, choice => played.push(choice));
		expect((await runner.run({ ...request(), chop: "loud" })).outcome).toBe("opened");
		expect((await runner.run({ ...request(), chop: "Quiet" })).outcome).toBe("opened");
		expect(played).toEqual([PING]);
	});

	test("a prompt's sound plays when it starts an agent or goes to a running one, not when it could not go", async () => {
		const played: SoundChoice[] = [];
		const saved: Saved = { personal: [mine("Ask", KNOCK, { kind: "prompt", agent: "Codex" })], play: true, file: {}, opens: "opened" };
		const { runner } = setUp(saved, choice => played.push(choice));
		expect((await runner.run({ ...request(), chop: "Ask" })).outcome).toBe("opened");
		expect((await runner.run({ ...request(), chop: "Ask", session: "s1" })).outcome).toBe("sent");
		expect((await runner.run({ ...request(), chop: "Ask", session: "gone" })).outcome).toBe("gone");
		expect(played).toEqual([KNOCK, KNOCK]);
	});

	test("nothing plays while a chop waits for approval or fails to start, and an approved run plays once", async () => {
		const played: SoundChoice[] = [];
		const saved: Saved = { personal: [], play: true, file: withFileChopSound({}, checkout, "Shared", CHIME), opens: "failed" };
		const { runner } = setUp(saved, choice => played.push(choice));
		const listedNow = await runner.list({ repository: checkout });
		expect(listedNow.outcome === "listed" && listedNow.chops.map(chop => [chop.name, chop.sound])).toEqual([["Shared", CHIME]]);
		expect((await runner.run({ ...request(), chop: "Shared" })).outcome).toBe("needs-approval");
		expect((await runner.run({ ...request(), chop: "Shared", approve: "make" })).outcome).toBe("failed");
		expect(played).toEqual([]);
		saved.opens = "opened";
		expect((await runner.run({ ...request(), chop: "Shared", approve: "make" })).outcome).toBe("opened");
		expect(played).toEqual([CHIME]);
	});

	test("with Play each chop's sound off, no chop plays one, and each keeps its sound", async () => {
		const played: SoundChoice[] = [];
		const saved: Saved = { personal: [mine("Loud", PING)], play: false, file: {}, opens: "opened" };
		const { runner } = setUp(saved, choice => played.push(choice));
		expect((await runner.run({ ...request(), chop: "Loud" })).outcome).toBe("opened");
		expect(played).toEqual([]);
		const listedNow = await runner.list({ repository: checkout });
		expect(listedNow.outcome === "listed" && listedNow.chops[0]!.sound).toEqual(PING);
	});

	test("sounds that cannot be read never stop a chop: it runs, silent, with a warning", async () => {
		const played: SoundChoice[] = [];
		const saved: Saved = { personal: [mine("Loud", PING)], play: true, file: {}, opens: "opened", unreadable: true };
		const { runner, warnings } = setUp(saved, choice => played.push(choice));
		expect((await runner.run({ ...request(), chop: "Loud" })).outcome).toBe("opened");
		expect(played).toEqual([]);
		expect(warnings.some(warning => warning.includes("chop sounds"))).toBe(true);
	});

	test("through the alerts' player: one sound at a time, and none longer than 4 seconds", async () => {
		const started: { argv: string[]; end: (code: number | null) => void; killed: boolean }[] = [];
		const timers = new Map<number, () => void>();
		let nextTimer = 0;
		const player = createSoundPlayer({
			path: bin,
			cacheFolder: join(root, "cache"),
			platform: "linux",
			spawn: (argv): SoundProcess => {
				let end: (code: number | null) => void = () => {};
				const exited = new Promise<number | null>(resolve => {
					end = resolve;
				});
				const entry = { argv, end, killed: false };
				started.push(entry);
				return { exited, kill: () => {
					entry.killed = true;
					end(null);
				} };
			},
			isRegularFile: () => true,
			writeFile: () => {},
			setTimer: run => {
				nextTimer += 1;
				timers.set(nextTimer, run);
				return nextTimer;
			},
			clearTimer: timer => void timers.delete(timer as number),
		});
		const outcomes: Promise<{ outcome: string }>[] = [];
		const saved: Saved = { personal: [mine("One", PING), mine("Two", KNOCK)], play: true, file: {}, opens: "opened" };
		const { runner } = setUp(saved, choice => outcomes.push(player.play(choice, { fallBackToChime: true })));
		await runner.run({ ...request(), chop: "One" });
		await runner.run({ ...request(), chop: "Two" });
		// The second chop started while the first's sound played: its sound is skipped, and the chop ran.
		expect(started).toHaveLength(1);
		expect(await outcomes[1]).toEqual({ outcome: "busy" });
		// Still playing at the limit: it is stopped.
		expect(MAX_SOUND_MILLISECONDS).toBe(4000);
		for (const [id, run] of [...timers]) {
			timers.delete(id);
			run();
		}
		expect(started[0]!.killed).toBe(true);
		expect(await outcomes[0]).toEqual({ outcome: "played" });
		await runner.run({ ...request(), chop: "Two" });
		expect(started).toHaveLength(2);
		expect(started[1]!.argv.at(-1)).toEndWith("knock.wav");
	});
});

describe("chop sounds in the app (mock engine)", () => {
	const settle = async () => {
		for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
	};
	const TIMBER = sampleRepositories[0]!.path;
	const FEATURE = sampleRepositories[0]!.worktrees[1]!;
	const size = { cols: 80, rows: 24 };
	async function started() {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.select(FEATURE.id);
		return { engine, store };
	}

	test("a chop made with a sound plays it as it runs; Play each chop's sound off silences it and keeps it", async () => {
		const { engine, store } = await started();
		expect(await store.savePreferences({ chops: [mine("Hello", PING, { text: "pwd" })] })).toMatchObject({ outcome: "saved" });
		await store.readChops(TIMBER);
		expect(chopsPanelModel(store.getState(), "command", "").rows.find(row => row.chop.name === "Hello")).toMatchObject({ sound: "Ping", soundTitle: "Plays Ping when it starts" });
		await store.runChop(TIMBER, FEATURE.id, "Hello", size);
		await settle();
		expect(engine.chopSounds()).toEqual([{ chop: "Hello", sound: PING }]);
		expect(await store.savePreferences({ playChopSounds: false })).toMatchObject({ outcome: "saved" });
		expect(chopsPanelModel(store.getState(), "command", "").rows.find(row => row.chop.name === "Hello")?.soundTitle).toBe("Sound: Ping. Chop sounds are off in Settings, Chops.");
		const before = store.getState().terminals.length;
		await store.runChop(TIMBER, FEATURE.id, "Hello", size);
		await settle();
		// It ran, silent.
		expect(store.getState().terminals).toHaveLength(before + 1);
		expect(engine.chopSounds()).toHaveLength(1);
		expect(store.getState().preferences.chops[0]!.sound).toEqual(PING);
	});

	test("a .timber chop's sound is kept in the app's settings and plays once its run is approved, never while it asks", async () => {
		const { engine, store } = await started();
		expect(await store.savePreferences({ fileChopSounds: withFileChopSound({}, TIMBER, "test", KNOCK) })).toMatchObject({ outcome: "saved" });
		await store.readChops(TIMBER);
		expect(chopsPanelModel(store.getState(), "command", "").rows.find(row => row.chop.name === "Test")?.sound).toBe("Knock");
		await store.runChop(TIMBER, FEATURE.id, "Test", size);
		expect(store.getState().dialog).toMatchObject({ kind: "approve-chop" });
		expect(engine.chopSounds()).toEqual([]);
		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Test", size, { approve: "bun test" });
		await settle();
		expect(engine.chopSounds()).toEqual([{ chop: "Test", sound: KNOCK }]);
	});
});

describe("choosing a chop's sound", () => {
	test("the panel's form has a Sound field with Play, whose buttons never submit the form, and saving keeps the sound", () => {
		const props = {
			idBase: "f", scopeOptions: panelChopScopeOptions({ path: REPO, name: "timber" }), agents: [], problem: null, tried: false, notes: [], failure: null, blocked: null, saving: false,
			soundProblem: "The sound file is not there any more. Choose it again.", customSoundPath: "/home/me/bell.ogg", onChange: () => {}, onChooseSoundFile: () => {}, onPlaySound: () => {}, onSave: () => {}, onCancel: () => {},
		};
		const form = { ...blankChopForm("command", REPO), name: "Lint", text: "bun run lint", sound: { kind: "custom" as const, path: "/home/me/bell.ogg" } };
		const markup = renderToStaticMarkup(<ChopFormView {...props} mode="new" form={form} />);
		expect(markup).toContain('for="f-sound">Sound</label>');
		expect(markup).toContain('<option value="custom" selected="">Your own file: bell.ogg</option>');
		expect(markup).toContain('<button type="button" class="button quiet" aria-label="Play sound: Lint">Play</button>');
		expect(markup).toContain('aria-label="Choose file: Lint">Choose file</button>');
		expect(markup).toContain(CHOP_SOUND_HINT.replace("'", "&#x27;"));
		expect(markup).toContain('role="alert">The sound file is not there any more. Choose it again.</p>');
		expect(blankChopForm("prompt", null).sound).toBeNull();
		expect(chopOf(form).sound).toEqual(form.sound);
		const check = chopsWithSaved([], null, form);
		expect(check.ok && check.chop.sound).toEqual(form.sound);
	});

	test("a .timber chop's view offers only its sound, which says where it is kept, and none while settings cannot be changed", () => {
		const chop = { name: "Dev", kind: "command" as const, text: "bun run dev", description: "", agent: null, source: "repository-file" as const, sound: PING };
		const props = { idBase: "v", chop, path: "/r/.timber/chops.json", saving: false, blocked: null, soundProblem: null, customSoundPath: undefined, onClose: () => {}, onPickSound: () => {}, onChooseSoundFile: () => {}, onPlaySound: () => {} };
		const markup = renderToStaticMarkup(<FileChopView {...props} />);
		expect(markup).toContain('<option value="bundled:ping" selected="">Ping</option>');
		expect(markup).toContain("Kept in the app&#x27;s settings, never in the file.");
		expect(markup).not.toContain("<input");
		expect(markup).not.toContain("<textarea");
		const blocked = renderToStaticMarkup(<FileChopView {...props} blocked="Blocked." />);
		expect(blocked).toMatch(/<select[^>]*disabled=""/);
		expect(renderToStaticMarkup(<FileChopView {...props} saving />)).toContain("Saving the sound");
	});

	test("Settings, Chops keeps each chop's sound when its rows are saved, and has the Play each chop's sound switch", () => {
		const saved = [mine("Loud", PING), mine("Quiet")];
		const drafts = chopDraftsOf(saved);
		const model = chopsDraftModel(drafts, saved);
		expect(model.chops).toEqual(saved);
		expect(model.canSave).toBe(false);
		const renamed = editChopDraft(drafts, drafts[0]!.key, { name: "Louder" });
		expect(chopsDraftModel(renamed, saved).chops[0]).toEqual(mine("Louder", PING, { text: "run Loud" }));
		const on = { useChops: true, playChopSounds: true };
		expect(chopsSectionChange(model, saved, { ...on, playChopSounds: false }, on)).toEqual({ playChopSounds: false });
		expect(chopsSectionChange(model, saved, { useChops: false, playChopSounds: false }, on)).toEqual({ useChops: false, playChopSounds: false });
		expect(chopsSectionChange(model, saved, on, on)).toBeNull();
		const markup = renderToStaticMarkup(
			<ChopsSectionView
				drafts={drafts} saved={saved} switches={{ useChops: true, playChopSounds: false }} canSave={false} repositories={[]} agents={[]} repository={null}
				save={{ state: "idle" }} onSwitch={() => {}} onAdd={() => {}} onEdit={() => {}} onRemove={() => {}} onSave={() => {}} onReadAgain={() => {}}
			/>,
		);
		expect(markup).toContain("Play each chop&#x27;s sound");
		expect(markup).toMatch(/<input type="checkbox" role="switch"[^>]*><span class="check-text">Play each chop/);
		expect(markup).not.toMatch(/<input type="checkbox" role="switch" checked=""[^>]*><span class="check-text">Play each chop/);
	});
});
