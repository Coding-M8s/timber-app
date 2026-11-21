import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { UPDATE_RESTARTING, appUpdateBannerText, appUpdateStatus, canCheckForUpdate, installStepOf, updateConfirmText } from "../src/mainview/app-update-format";
import { AppUpdatePanelView, InstallControlsView, type InstallControlsViewProps } from "../src/mainview/components/AppUpdate";
import { MOCK_APP_UPDATE_VERSION, createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { UPDATES_FROM_SOURCE } from "../src/shared/app-update";

const nothing = () => {};
const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const at = () => "14:05";

function controls(change: Partial<InstallControlsViewProps> = {}): string {
	return renderToStaticMarkup(<InstallControlsView step={{ kind: "offer" }} onRestart={nothing} onConfirm={nothing} onCancel={nothing} {...change} />);
}

describe("what the window says about updating the app", () => {
	test("only a downloaded update shows the banner, and Later hides it for that version", () => {
		expect(appUpdateBannerText({ kind: "ready", version: "0.2.0" }, null)).toBe("Timber app 0.2.0 is downloaded. Restart the app to install it.");
		expect(appUpdateBannerText({ kind: "ready", version: "0.2.0" }, "0.2.0")).toBeNull();
		// A newer one than the one put off shows again.
		expect(appUpdateBannerText({ kind: "ready", version: "0.3.0" }, "0.2.0")).not.toBeNull();
		expect(appUpdateBannerText({ kind: "downloading", version: "0.2.0" }, null)).toBeNull();
		expect(appUpdateBannerText({ kind: "up-to-date", checkedAt: 1 }, null)).toBeNull();
	});

	test("a failed look, offline for one, never shows a banner or an alert", () => {
		const failed = { kind: "failed", stage: "check", message: "Unable to connect." } as const;
		expect(appUpdateBannerText(failed, null)).toBeNull();
		const html = renderToStaticMarkup(<AppUpdatePanelView state={failed} onCheck={nothing} at={at} />);
		expect(html).toContain("Could not look for an update");
		expect(html).toContain("Unable to connect. The installed app is unchanged.");
		expect(html).not.toContain('role="alert"');
		expect(html).toContain(">Check for updates</button>");
	});

	test("About says where updating stands", () => {
		expect(appUpdateStatus({ kind: "up-to-date", checkedAt: 0 }, at)).toEqual({ text: "Up to date", note: "Last looked at 14:05." });
		expect(appUpdateStatus({ kind: "unavailable", reason: UPDATES_FROM_SOURCE }, at)).toEqual({ text: "Updates are off for this copy", note: UPDATES_FROM_SOURCE });
		expect(appUpdateStatus({ kind: "downloading", version: "0.2.0" }, at).text).toBe("Downloading 0.2.0");
		expect(appUpdateStatus({ kind: "failed", stage: "download", message: "HTTP 503." }, at).text).toBe("Could not download the update");
	});

	test("Check for updates waits while a look or a download runs, and is not offered to a copy that cannot update", () => {
		expect(canCheckForUpdate({ kind: "checking" })).toBe(false);
		expect(canCheckForUpdate({ kind: "downloading", version: "0.2.0" })).toBe(false);
		expect(canCheckForUpdate({ kind: "idle" })).toBe(true);
		expect(renderToStaticMarkup(<AppUpdatePanelView state={{ kind: "checking" }} onCheck={nothing} at={at} />)).toContain('disabled="">Looking</button>');
		const source = renderToStaticMarkup(<AppUpdatePanelView state={{ kind: "unavailable", reason: UPDATES_FROM_SOURCE }} onCheck={nothing} at={at} />);
		expect(source).not.toContain("Check for updates");
	});

	test("Restart to update asks first while sessions run, with focus on Cancel", () => {
		expect(updateConfirmText(2)).toBe("Restart to install the update now? 2 terminals are running and will be ended. They open again when the app starts.");
		expect(updateConfirmText(0)).toBe("Restart to install the update now?");
		const html = controls({ step: { kind: "confirm", live: 2 } });
		expect(html).toMatch(/<button type="button" class="button quiet" autofocus="">Cancel<\/button>/);
		expect(html).toContain('class="button danger">Restart</button>');
		expect(controls({ later: nothing })).toContain(">Later</button>");
		expect(controls()).not.toContain("Later");
		expect(controls({ step: { kind: "restarting" } })).toContain(UPDATE_RESTARTING);
		expect(controls({ step: { kind: "failed", message: "Something kept the app open." } })).toContain("Could not install the update");
	});

	test("the engine's answer leads to the next step", () => {
		expect(installStepOf({ outcome: "restarting" })).toEqual({ kind: "restarting" });
		expect(installStepOf({ outcome: "sessions-running", live: 3 })).toEqual({ kind: "confirm", live: 3 });
		expect(installStepOf({ outcome: "failed", message: "x" })).toEqual({ kind: "failed", message: "x" });
	});
});

describe("updating through the store and the mock engine", () => {
	test("a look that finds a release downloads it and shows the banner, which Later hides", async () => {
		const engine = createMockEngine();
		engine.endAppUpdateChecks("update");
		const store = createAppStore(engine, () => () => {});
		const stop = store.start();
		await settle();
		expect(store.getState().appUpdate).toEqual({ kind: "idle" });
		await store.checkForAppUpdate();
		await settle();
		expect(store.getState().appUpdate).toEqual({ kind: "ready", version: MOCK_APP_UPDATE_VERSION });
		expect(renderToStaticMarkup(<App store={store} />)).toContain(`Timber app ${MOCK_APP_UPDATE_VERSION} is downloaded.`);
		store.appUpdateLater();
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("is downloaded.");
		stop();
	});

	test("offline, the look fails quietly and no banner shows", async () => {
		const engine = createMockEngine();
		engine.endAppUpdateChecks("offline");
		const store = createAppStore(engine, () => () => {});
		const stop = store.start();
		await store.checkForAppUpdate();
		await settle();
		expect(store.getState().appUpdate.kind).toBe("failed");
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("update-banner");
		stop();
	});

	test("while sessions run, installing does nothing until the person agrees", async () => {
		const engine = createMockEngine();
		engine.endAppUpdateChecks("update");
		const store = createAppStore(engine, () => () => {});
		const stop = store.start();
		await settle();
		await store.openTerminal({ repository: "/work/timber", worktree: "/work/timber", cols: 80, rows: 24 });
		await store.checkForAppUpdate();
		await settle();
		expect(await store.installAppUpdate({ endSessions: false })).toEqual({ outcome: "sessions-running", live: 1 });
		expect(engine.appUpdateInstalls()).toEqual([]);
		expect(await store.installAppUpdate({ endSessions: true })).toEqual({ outcome: "restarting" });
		expect(engine.appUpdateInstalls()).toEqual([{ endSessions: true }]);
		stop();
	});

	test("Restart to update asks first while sessions run, and Cancel goes back", async () => {
		const engine = createMockEngine();
		engine.endAppUpdateChecks("update");
		const store = createAppStore(engine, () => () => {});
		const stop = store.start();
		await settle();
		await store.openTerminal({ repository: "/work/timber", worktree: "/work/timber", cols: 80, rows: 24 });
		await store.checkForAppUpdate();
		await settle();
		await store.restartForUpdate(false);
		expect(store.getState().appUpdateStep).toEqual({ kind: "confirm", live: 1 });
		expect(engine.appUpdateInstalls()).toEqual([]);
		expect(renderToStaticMarkup(<App store={store} />)).toContain(updateConfirmText(1));
		store.cancelUpdateRestart();
		expect(store.getState().appUpdateStep).toEqual({ kind: "offer" });
		await store.restartForUpdate(true);
		expect(engine.appUpdateInstalls()).toEqual([{ endSessions: true }]);
		expect(store.getState().appUpdateStep).toEqual({ kind: "restarting" });
		stop();
	});

	test("a restart into the update that did not happen says why, in the banner, with the update still ready", async () => {
		const engine = createMockEngine();
		engine.endAppUpdateChecks("update");
		engine.failAppUpdateInstalls("Could not restart into the update: Something kept the app open. Quit the app and start it again, then try once more.");
		const store = createAppStore(engine, () => () => {});
		const stop = store.start();
		await settle();
		await store.checkForAppUpdate();
		await settle();
		await store.restartForUpdate(false);
		await settle();
		expect(store.getState().appUpdate).toEqual({ kind: "ready", version: MOCK_APP_UPDATE_VERSION });
		const html = renderToStaticMarkup(<App store={store} />);
		expect(html).toContain("Could not install the update");
		expect(html).toContain("Quit the app and start it again, then try once more.");
		stop();
	});

	test("a lost answer is a failure that says what to do, and a lost look is a quiet failure", async () => {
		const engine = {
			...createMockEngine(),
			checkForAppUpdate: () => Promise.reject(new Error("timed out")),
			installAppUpdate: () => Promise.reject(new Error("timed out")),
		};
		const store = createAppStore(engine, () => () => {});
		await store.checkForAppUpdate();
		expect(store.getState().appUpdate).toEqual({ kind: "failed", stage: "check", message: "No answer came back from the look: timed out." });
		expect(await store.installAppUpdate({ endSessions: true })).toEqual({ outcome: "failed", message: "No answer came back from the update: timed out. If the app is still open, quit it and start it again." });
	});
});
