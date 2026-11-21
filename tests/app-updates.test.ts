import { describe, expect, test } from "bun:test";
import { type AppUpdatesDependencies, type UpdaterPort, createAppUpdates } from "../src/bun/app-updates";
import type { AppUpdateState } from "../src/shared/app-update";
import { UPDATES_FROM_SOURCE, UPDATES_WITHOUT_ADDRESS, mayCheck, updateFailureReason, updateUnavailableReason } from "../src/shared/app-update";

/** A stand-in for Electrobun's updater: what each look and download answers is set by the test. */
function fakeUpdater(change: Partial<UpdaterPort> = {}) {
	const calls: string[] = [];
	let info = { version: "0.2.0", updateAvailable: true, updateReady: false, error: "" };
	let downloaded = true;
	let launched = true;
	const updater: UpdaterPort = {
		localBuild: async () => ({ channel: "stable", baseUrl: "https://github.com/Coding-M8s/timber-app/releases/latest/download" }),
		check: async () => {
			calls.push("check");
			return { ...info };
		},
		download: async () => {
			calls.push("download");
			info = downloaded ? { ...info, updateReady: true } : { ...info, updateReady: false, error: "Failed to download update: HTTP 503" };
		},
		latest: () => ({ ...info }),
		apply: async () => {
			calls.push("apply");
			return launched;
		},
		...change,
	};
	return {
		updater,
		calls,
		answer: (next: Partial<typeof info>) => { info = { ...info, ...next }; },
		failDownload: () => { downloaded = false; },
		failApply: () => { launched = false; },
	};
}

function setup(change: Partial<AppUpdatesDependencies> = {}, fake = fakeUpdater()) {
	const seen: AppUpdateState[] = [];
	const events: string[] = [];
	let live = 0;
	const updates = createAppUpdates({
		updater: fake.updater,
		liveCount: () => live,
		restartInto: async apply => {
			events.push("sessions saved and ended");
			return apply();
		},
		onChange: state => seen.push(state),
		now: () => 1_000,
		...change,
	});
	return { updates, seen, events, fake, setLive: (count: number) => { live = count; } };
}

describe("whether this build can update itself", () => {
	test("a build from source cannot, nor one without an update address", () => {
		expect(updateUnavailableReason({ channel: "dev", baseUrl: "https://example.com" })).toBe(UPDATES_FROM_SOURCE);
		expect(updateUnavailableReason({ channel: "", baseUrl: "" })).toBe(UPDATES_FROM_SOURCE);
		expect(updateUnavailableReason({ channel: "stable", baseUrl: " " })).toBe(UPDATES_WITHOUT_ADDRESS);
		expect(updateUnavailableReason({ channel: "stable", baseUrl: "https://example.com" })).toBeNull();
	});

	test("a look does not start again while one runs, a download runs, or the app restarts", () => {
		expect(mayCheck({ kind: "idle" })).toBe(true);
		expect(mayCheck({ kind: "failed", stage: "check", message: "x" })).toBe(true);
		expect(mayCheck({ kind: "checking" })).toBe(false);
		expect(mayCheck({ kind: "downloading", version: "0.2.0" })).toBe(false);
		expect(mayCheck({ kind: "installing", version: "0.2.0" })).toBe(false);
		expect(mayCheck({ kind: "unavailable", reason: "x" })).toBe(false);
	});

	test("Electrobun's failure text keeps only the reason, as a sentence", () => {
		expect(updateFailureReason("Failed to check for updates: Unable to connect. Is the computer able to access the url?")).toBe("Unable to connect. Is the computer able to access the url?");
		expect(updateFailureReason("Failed to download update: HTTP 503")).toBe("HTTP 503.");
		expect(updateFailureReason("")).toBe("No reason was given.");
	});
});

describe("looking for an update", () => {
	test("a build from source never looks", async () => {
		const fake = fakeUpdater({ localBuild: async () => ({ channel: "dev", baseUrl: "" }) });
		const { updates } = setup({}, fake);
		expect(await updates.check()).toEqual({ kind: "unavailable", reason: UPDATES_FROM_SOURCE });
		expect(fake.calls).toEqual([]);
	});

	test("a newer release is downloaded at once and then waits for the person", async () => {
		const { updates, seen, fake } = setup();
		expect(await updates.check()).toEqual({ kind: "ready", version: "0.2.0" });
		expect(fake.calls).toEqual(["check", "download"]);
		expect(seen.map(state => state.kind)).toEqual(["checking", "downloading", "ready"]);
		// Nothing installs without the person.
		expect(fake.calls).not.toContain("apply");
	});

	test("the newest release already running is up to date", async () => {
		const fake = fakeUpdater();
		fake.answer({ updateAvailable: false });
		const { updates } = setup({}, fake);
		expect(await updates.check()).toEqual({ kind: "up-to-date", checkedAt: 1_000 });
		expect(fake.calls).toEqual(["check"]);
	});

	test("an update downloaded in an earlier run is ready without a second download", async () => {
		const fake = fakeUpdater();
		fake.answer({ updateReady: true });
		const { updates } = setup({}, fake);
		expect(await updates.check()).toEqual({ kind: "ready", version: "0.2.0" });
		expect(fake.calls).toEqual(["check"]);
	});

	test("offline, the look fails quietly with the reason", async () => {
		const fake = fakeUpdater();
		fake.answer({ updateAvailable: false, version: "", error: "Failed to check for updates: Unable to connect" });
		const { updates } = setup({}, fake);
		expect(await updates.check()).toEqual({ kind: "failed", stage: "check", message: "Unable to connect." });
	});

	test("an updater that throws is a failed look too, never an error out of check", async () => {
		const fake = fakeUpdater({ check: async () => { throw new Error("boom"); } });
		const { updates } = setup({}, fake);
		expect(await updates.check()).toEqual({ kind: "failed", stage: "check", message: "Boom." });
	});

	test("a failed download says so and can be tried again", async () => {
		const fake = fakeUpdater();
		fake.failDownload();
		const { updates } = setup({}, fake);
		expect(await updates.check()).toEqual({ kind: "failed", stage: "download", message: "HTTP 503." });
		expect(mayCheck(updates.current())).toBe(true);
	});

	test("with an update downloaded, a later look that fails keeps it, without a word", async () => {
		const { updates, seen, fake } = setup();
		await updates.check();
		const heard = seen.length;
		fake.answer({ version: "", updateAvailable: false, updateReady: false, error: "Failed to check for updates: Unable to connect" });
		expect(await updates.check()).toEqual({ kind: "ready", version: "0.2.0" });
		// No "checking" in between, so the banner and an open question stay.
		expect(seen.slice(heard)).toEqual([]);
	});

	test("with an update downloaded, a later look that finds the same one changes nothing, and a newer one is downloaded", async () => {
		const { updates, seen, fake } = setup();
		await updates.check();
		const heard = seen.length;
		expect(await updates.check()).toEqual({ kind: "ready", version: "0.2.0" });
		expect(seen.slice(heard)).toEqual([]);
		fake.answer({ version: "0.3.0", updateReady: false });
		expect(await updates.check()).toEqual({ kind: "ready", version: "0.3.0" });
		expect(seen.slice(heard).map(state => state.kind)).toEqual(["downloading", "ready"]);
	});

	test("with an update downloaded, an updater that throws keeps it too", async () => {
		const fake = fakeUpdater();
		const { updates } = setup({}, fake);
		await updates.check();
		fake.updater.check = async () => { throw new Error("boom"); };
		expect(await updates.check()).toEqual({ kind: "ready", version: "0.2.0" });
	});

	test("two looks at once share one", async () => {
		const { updates, fake } = setup();
		const [one, two] = await Promise.all([updates.check(), updates.check()]);
		expect(one).toEqual(two);
		expect(fake.calls.filter(call => call === "check")).toHaveLength(1);
	});
});

describe("installing a downloaded update", () => {
	test("nothing installs before an update is ready", async () => {
		const { updates, fake } = setup();
		expect(await updates.install({ endSessions: true })).toEqual({ outcome: "failed", message: "No update is ready to install yet." });
		expect(fake.calls).not.toContain("apply");
	});

	test("while sessions run and the person has not agreed, nothing restarts", async () => {
		const { updates, fake, events, setLive } = setup();
		await updates.check();
		setLive(2);
		expect(await updates.install({ endSessions: false })).toEqual({ outcome: "sessions-running", live: 2 });
		expect(fake.calls).not.toContain("apply");
		expect(events).toEqual([]);
		expect(updates.current()).toEqual({ kind: "ready", version: "0.2.0" });
	});

	test("once agreed, the sessions are saved and ended, then the update is applied", async () => {
		const { updates, fake, events, setLive } = setup();
		await updates.check();
		setLive(2);
		expect(await updates.install({ endSessions: true })).toEqual({ outcome: "restarting" });
		expect(events).toEqual(["sessions saved and ended"]);
		expect(fake.calls.at(-1)).toBe("apply");
		expect(updates.current()).toEqual({ kind: "installing", version: "0.2.0" });
	});

	test("with nothing running, it restarts without asking", async () => {
		const { updates } = setup();
		await updates.check();
		expect(await updates.install({ endSessions: false })).toEqual({ outcome: "restarting" });
	});

	test("an update that does not start leaves it ready, with the reason", async () => {
		const fake = fakeUpdater();
		fake.failApply();
		const { updates } = setup({}, fake);
		await updates.check();
		const result = await updates.install({ endSessions: true });
		expect(result.outcome).toBe("failed");
		expect(updates.current()).toEqual({ kind: "ready", version: "0.2.0" });
	});

	test("no look starts while the app restarts into the update", async () => {
		const { updates, fake } = setup();
		await updates.check();
		await updates.install({ endSessions: true });
		await updates.check();
		expect(fake.calls.filter(call => call === "check")).toHaveLength(1);
	});
});
