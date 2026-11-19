import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RestartPromptView, type RestartPromptViewProps } from "../src/mainview/components/settings/RestartPrompt";
import { SettingsSection, needsRestart } from "../src/mainview/components/settings/SettingsSection";
import { createMockEngine } from "../src/mainview/engine/mock";
import { RESTART_CONFIRM, RESTART_OFFER, RESTARTING, restartStepAfterPlan, restartStepOf } from "../src/mainview/restart-format";
import { describeRendering, restartChangesRendering } from "../src/mainview/rendering-format";
import { StoreProvider } from "../src/mainview/store/react";
import { createAppStore } from "../src/mainview/store/store";
import { defaultPreferences } from "../src/shared/preferences";

const nothing = () => {};

function view(change: Partial<RestartPromptViewProps> = {}): string {
	return renderToStaticMarkup(
		<RestartPromptView step={{ kind: "offer" }} liveTerminals={0} onRestart={nothing} onLater={nothing} onConfirm={nothing} onCancel={nothing} {...change} />,
	);
}

async function until(check: () => boolean): Promise<void> {
	for (let tries = 0; tries < 100 && !check(); tries++) await Bun.sleep(5);
	expect(check()).toBe(true);
}

describe("offering a restart after a save", () => {
	test("a save offers it only when it changed a preference read at start away from what this run started with", () => {
		const atStart = defaultPreferences();
		expect(needsRestart(atStart, { ...atStart, dmabuf: "off" }, { dmabuf: "off" })).toBe(true);
		// Saved back to what the app started with: nothing to restart for.
		expect(needsRestart(atStart, atStart, { dmabuf: "auto" })).toBe(false);
		// A setting that applies at once: no offer.
		expect(needsRestart(atStart, { ...atStart, zoom: 1.25 }, { zoom: 1.25 })).toBe(false);
		// Another section's waiting change is that section's to offer.
		expect(needsRestart(atStart, { ...atStart, dmabuf: "off", zoom: 1.25 }, { zoom: 1.25 })).toBe(false);
		// Before the first read answered, the start is unknown.
		expect(needsRestart(null, { ...atStart, dmabuf: "off" }, { dmabuf: "off" })).toBe(false);
	});

	test("the offer has Restart now and Later", () => {
		const html = view();
		expect(html).toContain(RESTART_OFFER);
		expect(html).toContain(">Later</button>");
		expect(html).toContain(">Restart now</button>");
	});

	test("Later shows nothing more, and the Rendering hint still asks for a restart", () => {
		expect(view({ step: { kind: "later" } })).toBe("");
		const status = { applies: true, dmabuf: true, decidedBy: "auto", choice: "auto" } as const;
		expect(describeRendering(status, "off")).toBe("Now: on, Auto kept WebKitGTK's default. Restart the app to use the saved choice.");
	});

	test("while terminals run, Restart now asks first, with focus on Cancel", () => {
		expect(restartStepAfterPlan({ available: true }, 0)).toBe("restart");
		expect(restartStepAfterPlan({ available: true }, 2)).toEqual({ kind: "confirm" });
		const html = view({ step: { kind: "confirm" }, liveTerminals: 2 });
		expect(html).toContain(`${RESTART_CONFIRM} 2 terminals are running and will be ended.`);
		expect(html).toMatch(/<button type="button" class="button quiet" autofocus="">Cancel<\/button>/);
		expect(html).toContain('class="button danger">Restart</button>');
	});

	test("a copy that cannot restart says why instead", () => {
		const step = restartStepAfterPlan({ available: false, reason: "Runs from source." }, 3);
		expect(step).toEqual({ kind: "unavailable", reason: "Runs from source." });
		expect(view({ step: step as never })).toContain("Runs from source.");
		expect(view({ step: step as never })).not.toContain("Restart now");
	});

	test("each answer is shown: restarting, unavailable, or a failure with the offer again", () => {
		expect(restartStepOf({ outcome: "restarting" })).toEqual({ kind: "restarting" });
		expect(restartStepOf({ outcome: "unavailable", message: "No." })).toEqual({ kind: "unavailable", reason: "No." });
		expect(restartStepOf({ outcome: "failed", message: "Kept open." })).toEqual({ kind: "failed", message: "Kept open." });
		expect(view({ step: { kind: "restarting" } })).toContain(RESTARTING);
		const failed = view({ step: { kind: "failed", message: "Kept open." } });
		expect(failed).toContain("Could not restart");
		expect(failed).toContain("Kept open.");
		expect(failed).toContain(">Restart now</button>");
	});

	test("any section that saved such a change shows the offer, and no other save does", () => {
		const store = createAppStore(createMockEngine());
		const section = (save: Parameters<typeof SettingsSection>[0]["save"]) => renderToStaticMarkup(
			<StoreProvider store={store}>
				<SettingsSection title="Any" description="Any section." save={save} canSave={false} onSave={nothing}>
					<span />
				</SettingsSection>
			</StoreProvider>,
		);
		expect(section({ state: "saved", restart: true })).toContain(RESTART_OFFER);
		expect(section({ state: "saved", restart: false })).not.toContain(RESTART_OFFER);
		expect(section({ state: "idle" })).not.toContain(RESTART_OFFER);
		const optedOut = renderToStaticMarkup(
			<StoreProvider store={store}>
				<SettingsSection title="Any" description="Any section." save={{ state: "saved", restart: true }} canSave={false} onSave={nothing} offerRestart={false}>
					<span />
				</SettingsSection>
			</StoreProvider>,
		);
		expect(optedOut).not.toContain(RESTART_OFFER);
	});

	test("Rendering offers no restart where one would change nothing", () => {
		expect(restartChangesRendering({ applies: true, dmabuf: true, decidedBy: "auto", choice: "auto" })).toBe(true);
		expect(restartChangesRendering({ applies: true, dmabuf: false, decidedBy: "choice", choice: "off" })).toBe(true);
		// The variable wins, and a restart keeps the same environment.
		expect(restartChangesRendering({ applies: true, dmabuf: false, decidedBy: "variable", choice: "on" })).toBe(false);
		// Not Linux: WebKitGTK is not used.
		expect(restartChangesRendering({ applies: false })).toBe(false);
	});
});

describe("restarting through the store and the mock engine", () => {
	test("the store keeps the preferences this run started with, also after a save", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		expect(store.getState().preferencesAtStart).toBeNull();
		const stop = store.start();
		await until(() => store.getState().preferencesAtStart !== null);
		const atStart = store.getState().preferencesAtStart;
		expect(atStart?.dmabuf).toBe("auto");
		const saved = await store.savePreferences({ dmabuf: "off" });
		expect(saved.outcome).toBe("saved");
		expect(store.getState().preferences.dmabuf).toBe("off");
		expect(store.getState().preferencesAtStart).toEqual(atStart);
		expect(needsRestart(store.getState().preferencesAtStart, store.getState().preferences, { dmabuf: "off" })).toBe(true);
		stop();
	});

	test("the mock can restart, acts it out without quitting, and acts out each other ending", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		expect(await store.restartPlan()).toEqual({ available: true });
		expect(await store.restart()).toEqual({ outcome: "restarting" });
		expect(engine.restartCount()).toBe(1);
		engine.endRestarts("fails");
		expect(await store.restart()).toMatchObject({ outcome: "failed" });
		engine.endRestarts("unavailable");
		expect(await store.restartPlan()).toMatchObject({ available: false, reason: expect.stringContaining("cannot restart itself") });
		expect(await store.restart()).toMatchObject({ outcome: "unavailable" });
		expect(engine.restartCount()).toBe(1);
		expect(() => engine.endRestarts("explodes" as never)).toThrow("Unknown ending: explodes");
	});

	test("an engine that does not answer is a reason, or a failure that says what to do, since a window that sees it is still open", async () => {
		const engine = {
			...createMockEngine(),
			restartPlan: () => Promise.reject(new Error("no answer")),
			restart: () => Promise.reject(new Error("timed out")),
		};
		const store = createAppStore(engine);
		expect(await store.restartPlan()).toEqual({ available: false, reason: "Could not check whether the app can restart itself: no answer" });
		expect(await store.restart()).toEqual({ outcome: "failed", message: "No answer came back from the restart: timed out. If the app is still open, quit it and start it again." });
	});
});
