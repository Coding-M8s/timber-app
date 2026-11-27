import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { handleWaitingKey } from "../src/mainview/components/WaitingShortcut";
import { ShortcutsSectionView, fixedKeys, listedShortcuts } from "../src/mainview/components/settings/ShortcutsSection";
import { changesButtonHint, takesChangesPanelKey } from "../src/mainview/changes-panel-format";
import { chopsButtonHint, takesChopsPanelKey } from "../src/mainview/chops-panel-format";
import { createMockEngine } from "../src/mainview/engine/mock";
import { filesButtonHint, takesFilesPanelKey } from "../src/mainview/files-panel-format";
import { paletteHint, takesPaletteKey } from "../src/mainview/palette";
import { SETTINGS_NAV_GROUPS, SETTINGS_SECTION_LABELS } from "../src/mainview/shell";
import { createAppStore } from "../src/mainview/store/store";
import { terminalLeavesToApp } from "../src/mainview/terminal-app-keys";
import { sessionKey } from "../src/mainview/terminal-format";
import { waitingHint } from "../src/mainview/waiting";
import { DEFAULT_SHORTCUTS, SHORTCUT_IDS, type ShortcutSettings, shortcutLetter } from "../src/shared/shortcuts";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const chord = (key: string) => ({ type: "keydown", key, ctrlKey: true, shiftKey: true, metaKey: false, altKey: false });

async function startedStore() {
	const engine = createMockEngine();
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

const view = (shortcuts: ShortcutSettings, more: { useChops?: boolean; mac?: boolean; canSave?: boolean } = {}) => renderToStaticMarkup(
	<ShortcutsSectionView
		mac={more.mac ?? false} shortcuts={shortcuts} useChops={more.useChops ?? true} canSave={more.canSave ?? false} save={{ state: "idle" }} onChange={() => {}} onSave={() => {}}
	/>,
);

describe("Settings, Shortcuts", () => {
	test("is listed under Workflow, after Chops", () => {
		expect(SETTINGS_SECTION_LABELS.shortcuts).toBe("Shortcuts");
		expect(SETTINGS_NAV_GROUPS.find(group => group.label === "Workflow")?.sections).toEqual(["editor", "agents", "chops", "shortcuts"]);
	});

	test("lists every app shortcut with its key as set, and Reset only for one that is not its default", () => {
		const markup = view({ palette: "Ctrl+Shift+O", "run-chop": "Ctrl+Shift+R" });
		for (const label of ["Open the command palette", "Show the next session that needs you", "Go to the session chips from a terminal", "Show or hide the files", "Show or hide the changes", "Show or hide the chops panel", "Search and run a chop"]) {
			expect(markup).toContain(label);
		}
		for (const keys of ["Ctrl+Shift+O", "Ctrl+Shift+J", "Ctrl+Shift+S", "Ctrl+Shift+E", "Ctrl+Shift+G", "Ctrl+Shift+K", "Ctrl+Shift+R"]) expect(markup).toContain(`value="${keys}"`);
		expect(markup).toContain("Reset Open the command palette to Ctrl+Shift+P");
		expect(markup).toContain("Reset Search and run a chop to Ctrl+Shift+T");
		expect(markup).toContain("The default is Ctrl+Shift+P.");
		expect(markup).not.toContain("Reset Show or hide the files");
		expect(markup.match(/>Reset</g)?.length).toBe(2);
	});

	test("names the keys with Cmd on macOS", () => {
		const markup = view({}, { mac: true });
		expect(markup).toContain('value="Cmd+Shift+P"');
		expect(markup).toContain("each Cmd+Shift and a letter");
		expect(markup).toContain("Cmd+C and Cmd+V");
	});

	test("does not list the chop shortcuts while Use chops is off, and says where they went", () => {
		expect(listedShortcuts(true)).toEqual([...SHORTCUT_IDS]);
		expect(listedShortcuts(false)).toEqual(["palette", "next-waiting", "session-chips", "files-panel", "changes-panel"]);
		const markup = view({}, { useChops: false });
		expect(markup).not.toContain("Search and run a chop");
		expect(markup).not.toContain("Show or hide the chops panel");
		expect(markup).toContain("Open the command palette");
		expect(markup).toContain("The chop shortcuts are listed here while Use chops is on, in Settings, Chops.");
	});

	test("lists the keys that stay as they are, for this platform", () => {
		expect(fixedKeys(false).map(entry => entry.keys)).toEqual(["Ctrl+PageUp and Ctrl+PageDown", "Ctrl+Shift+C and Ctrl+Shift+V", "Ctrl+=, Ctrl+-, and Ctrl+0"]);
		expect(view({})).toContain("Keys that stay as they are");
	});
});

describe("the shortcuts as set, over the mock engine", () => {
	test("are saved through the engine, read back on the next start, and a clash is refused", async () => {
		const { engine, store } = await startedStore();
		const moved = { palette: "Ctrl+Shift+O", "files-panel": "Ctrl+Shift+P" };
		expect(await store.savePreferences({ shortcuts: moved })).toMatchObject({ outcome: "saved" });
		expect((await engine.loadPreferences()).shortcuts).toEqual(moved);
		// A key another has, or a terminal's copy, is refused and nothing changes.
		expect(await store.savePreferences({ shortcuts: { ...moved, "changes-panel": "Ctrl+Shift+O" } })).toMatchObject({ outcome: "failed" });
		expect(await store.savePreferences({ shortcuts: { "session-chips": "Ctrl+Shift+C" } })).toMatchObject({ outcome: "failed" });
		expect(store.getState().preferences.shortcuts).toEqual(moved);
		// A store started again on the same engine is what a restarted window has.
		const again = createAppStore(engine, () => () => {});
		again.start();
		await settle();
		expect(again.getState().preferences.shortcuts).toEqual(moved);
	});

	test("every tooltip names the key as set, and the window takes it and leaves the default it set aside", async () => {
		const { store } = await startedStore();
		const moved = { palette: "Ctrl+Shift+O", "next-waiting": "Ctrl+Shift+N", "files-panel": "Ctrl+Shift+X", "changes-panel": "Ctrl+Shift+P", "chops-panel": "Ctrl+Shift+L" };
		expect(await store.savePreferences({ shortcuts: moved })).toMatchObject({ outcome: "saved" });
		const state = store.getState();
		const markup = renderToStaticMarkup(<App store={store} />);
		for (const hint of [paletteHint(false, "O"), filesButtonHint(false, false, "X"), changesButtonHint(false, false, "P"), chopsButtonHint(false, false, "L")]) {
			expect(markup).toContain(hint);
		}
		expect(markup).not.toContain("(Ctrl+Shift+E)");
		expect(markup).not.toContain("(Ctrl+Shift+G)");
		// The next session's item shows only with a session to visit; its tooltip is drawn from the same key.
		expect(waitingHint(false, "N")).toBe("Show next session that needs you or is done (Ctrl+Shift+N)");
		expect(takesPaletteKey(chord("O"), state)).toBe(true);
		expect(takesPaletteKey(chord("P"), state)).toBe(false);
		expect(takesChangesPanelKey(chord("P"), state)).toBe(true);
		expect(takesChangesPanelKey(chord("G"), state)).toBe(false);
		expect(takesFilesPanelKey(chord("X"), state)).toBe(true);
		expect(takesFilesPanelKey(chord("E"), state)).toBe(false);
		expect(takesChopsPanelKey(chord("L"), state)).toBe(true);
		expect(takesChopsPanelKey(chord("K"), state)).toBe(false);
	});

	test("the next session's key follows the one set, and the old one reaches the page", () => {
		let jumps = 0;
		const press = (key: string) => {
			let prevented = false;
			const taken = handleWaitingKey({ ...chord(key), repeat: false, preventDefault: () => { prevented = true; } }, () => (jumps += 1, true), "N");
			return { taken, prevented };
		};
		expect(press("N")).toEqual({ taken: true, prevented: true });
		expect(press("J")).toEqual({ taken: false, prevented: false });
		expect(jumps).toBe(1);
	});
});

describe("a focused terminal and the shortcuts as set", () => {
	test("leaves each key as set to the app, and sends each default set aside to the program", async () => {
		const { store } = await startedStore();
		// Each moved to a letter no default has, so every default is set aside at once.
		const moved: ShortcutSettings = { palette: "Ctrl+Shift+O", "next-waiting": "Ctrl+Shift+N", "session-chips": "Ctrl+Shift+A", "files-panel": "Ctrl+Shift+X", "changes-panel": "Ctrl+Shift+D", "chops-panel": "Ctrl+Shift+L", "run-chop": "Ctrl+Shift+Y" };
		expect(Object.keys(moved).sort()).toEqual([...SHORTCUT_IDS].sort());
		const before = store.getState();
		for (const id of SHORTCUT_IDS.filter(id => id !== "session-chips")) expect(terminalLeavesToApp(chord(DEFAULT_SHORTCUTS[id]), before)).toBe(true);
		expect(await store.savePreferences({ shortcuts: moved })).toMatchObject({ outcome: "saved" });
		const state = store.getState();
		for (const id of SHORTCUT_IDS) {
			const letter = shortcutLetter(state.preferences.shortcuts, id);
			if (id === "session-chips") {
				expect(sessionKey(chord(letter), false, letter)).toBe("chips");
				expect(sessionKey(chord(DEFAULT_SHORTCUTS[id]), false, letter)).toBeNull();
				continue;
			}
			expect(terminalLeavesToApp(chord(letter), state)).toBe(true);
			expect(terminalLeavesToApp(chord(DEFAULT_SHORTCUTS[id]), state)).toBe(false);
		}
	});
});
