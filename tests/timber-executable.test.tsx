import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TimberExecutableSectionView } from "../src/mainview/components/settings/TimberExecutableSection";
import { MOCK_BUNDLED_TIMBER, createMockEngine, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { SETTINGS_SECTION_LABELS, TIMBER_SETTINGS_SECTIONS } from "../src/mainview/shell";
import { createAppStore } from "../src/mainview/store/store";
import { describeTimberInUse, timberDraftModel, timberDraftOf } from "../src/mainview/timber-choice-format";
import type { TimberChoice } from "../src/shared/timber-choice";
import { TIMBER_PIN } from "../src/shared/timber-pin";

const bundled: TimberChoice = { kind: "bundled" };

describe("the Executable draft", () => {
	test("starts from what is saved, and can save only a change", () => {
		expect(timberDraftOf(bundled)).toEqual({ kind: "bundled", path: "" });
		expect(timberDraftOf({ kind: "file", path: "/opt/timber" })).toEqual({ kind: "file", path: "/opt/timber" });
		expect(timberDraftModel({ kind: "bundled", path: "" }, bundled)).toEqual({ choice: bundled, canSave: false, error: null });
		expect(timberDraftModel({ kind: "path", path: "/kept" }, bundled)).toEqual({ choice: { kind: "path" }, canSave: true, error: null });
	});

	test("a file needs a full path, and spaces around it are dropped", () => {
		expect(timberDraftModel({ kind: "file", path: "" }, bundled)).toEqual({ choice: null, canSave: false, error: null });
		expect(timberDraftModel({ kind: "file", path: "timber" }, bundled).error).toContain("full path");
		expect(timberDraftModel({ kind: "file", path: " /opt/timber " }, bundled)).toEqual({ choice: { kind: "file", path: "/opt/timber" }, canSave: true, error: null });
		expect(timberDraftModel({ kind: "file", path: "/opt/timber" }, { kind: "file", path: "/opt/timber" }).canSave).toBe(false);
	});

	test("says which Timber is in use and where it came from", () => {
		expect(describeTimberInUse({ known: true, status: { state: "ready", source: "bundled", path: "/app/timber", version: "0.1.4" } }))
			.toBe("In use: Timber 0.1.4. Bundled with the app: /app/timber");
		expect(describeTimberInUse({ known: true, status: { state: "too-old", source: "setting", path: "/opt/timber", found: "0.1.3", required: "0.1.4" } }))
			.toBe("Not usable: Timber 0.1.3 is older than the required 0.1.4. Chosen in Settings: /opt/timber");
		expect(describeTimberInUse({ known: true, status: { state: "not-found", source: "path", path: null } })).toBe("Not usable: there is no timber on PATH.");
		expect(describeTimberInUse(null)).toBe("Looking for Timber.");
	});
});

describe("the Executable section", () => {
	const view = (draft: { kind: TimberChoice["kind"]; path: string }) => renderToStaticMarkup(
		<TimberExecutableSectionView draft={draft} saved={bundled} timber={{ known: true, status: sampleTimberStatuses.ready }} save={{ state: "idle" }} onChange={() => {}} onSave={() => {}} />,
	);

	test("offers the three choices, naming the bundled version, and a path field only for a file", () => {
		const markup = view({ kind: "bundled", path: "" });
		expect(markup).toContain("The Timber that comes with the app");
		expect(markup).toContain(`Timber ${TIMBER_PIN.version}, the release this version of the app was tested with.`);
		expect(markup).toContain("The timber on PATH");
		expect(markup).toContain("A Timber of my own");
		expect(markup).not.toContain(">Path</label>");
		expect(view({ kind: "file", path: "relative" })).toContain(">Path</label>");
		expect(view({ kind: "file", path: "relative" })).toContain("This path cannot be used");
	});

	test("is the first section under Timber", () => {
		expect(TIMBER_SETTINGS_SECTIONS[0]).toBe("executable");
		expect(SETTINGS_SECTION_LABELS.executable).toBe("Executable");
	});
});

describe("choosing another Timber", () => {
	test("the store hears it at once and shows the newly chosen Timber", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		const stop = store.start();
		const settle = () => new Promise(resolve => setTimeout(resolve, 0));
		await settle();
		const status = () => { const timber = store.getState().timber; return timber?.known ? timber.status : null; };
		expect(status()).toEqual({ state: "ready", source: "bundled", path: MOCK_BUNDLED_TIMBER, version: TIMBER_PIN.version });

		expect((await store.savePreferences({ timber: { kind: "file", path: "/opt/timber/bin/timber" } })).outcome).toBe("saved");
		await settle();
		expect(status()).toMatchObject({ state: "ready", source: "setting", path: "/opt/timber/bin/timber" });

		await store.savePreferences({ timber: { kind: "path" } });
		await settle();
		expect(status()).toEqual(sampleTimberStatuses.ready);
		stop();
	});
});
