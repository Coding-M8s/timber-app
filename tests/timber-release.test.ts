import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LATEST_RELEASE_URL, createReleaseWatcher, lookUpLatestRelease, readSavedRelease, releaseFilePath, timberFinder } from "../src/bun/timber-release";
import type { TimberStatus } from "../src/shared/model";
import { newerTimberVersion, readReleaseLocation, satisfiesTimberVersion } from "../src/shared/timber-version";
import { describeTimberProblem, describeTimberUpdate } from "../src/mainview/format";
import { createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";

describe("readReleaseLocation", () => {
	test("reads the version from the tag a latest-release link redirects to", () => {
		expect(readReleaseLocation("https://github.com/Coding-M8s/timber/releases/tag/v0.1.3")).toBe("0.1.3");
		expect(readReleaseLocation("https://github.com/Coding-M8s/timber/releases/tag/0.2.0")).toBe("0.2.0");
	});

	test("takes nothing else for a release", () => {
		expect(readReleaseLocation(null)).toBeNull();
		expect(readReleaseLocation("https://github.com/Coding-M8s/timber/releases")).toBeNull();
		expect(readReleaseLocation("https://github.com/login?return_to=/releases/tag/v0.1.3")).toBeNull();
		expect(readReleaseLocation("https://github.com/Coding-M8s/timber/releases/tag/nightly")).toBeNull();
		expect(readReleaseLocation("https://github.com/Coding-M8s/timber/releases/tag/v0.2.0-beta.1")).toBeNull();
	});
});

describe("newerTimberVersion", () => {
	test("picks the newer, and never one that cannot be read", () => {
		expect(newerTimberVersion("0.1.2", "0.1.3")).toBe("0.1.3");
		expect(newerTimberVersion("0.1.2", "0.1.0")).toBe("0.1.2");
		expect(newerTimberVersion("0.1.2", null)).toBe("0.1.2");
		expect(newerTimberVersion("0.1.2", "garbage")).toBe("0.1.2");
	});
});

describe("lookUpLatestRelease", () => {
	const answering = (response: Response | Error) => (async (url: string | URL | Request, init?: RequestInit) => {
		expect(String(url)).toBe(LATEST_RELEASE_URL);
		expect(init?.redirect).toBe("manual");
		if (response instanceof Error) throw response;
		return response;
	}) as typeof fetch;

	test("reads the redirect without following it", async () => {
		const redirect = new Response(null, { status: 302, headers: { location: "https://github.com/Coding-M8s/timber/releases/tag/v0.1.3" } });
		expect(await lookUpLatestRelease(answering(redirect))).toBe("0.1.3");
	});

	test("is null for any other answer, or none", async () => {
		expect(await lookUpLatestRelease(answering(new Response("ok", { status: 200 })))).toBeNull();
		expect(await lookUpLatestRelease(answering(new Response(null, { status: 404 })))).toBeNull();
		expect(await lookUpLatestRelease(answering(new Response(null, { status: 302, headers: { location: "https://example.com/" } })))).toBeNull();
		expect(await lookUpLatestRelease(answering(new Error("offline")))).toBeNull();
	});
});

describe("the saved release", () => {
	const folders: string[] = [];
	const fileIn = () => {
		const folder = mkdtempSync(join(tmpdir(), "timber-app-release-"));
		folders.push(folder);
		return releaseFilePath(join(folder, "settings.json"));
	};
	afterEach(() => {
		for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
	});

	test("a lookup that worked is saved, and read by the next run", async () => {
		const file = fileIn();
		const first = createReleaseWatcher({ file, lookUp: async () => "0.1.3", now: () => new Date("2026-11-19T12:00:00Z") });
		expect(first.latest()).toBeNull();
		expect(await first.check()).toBe(true);
		expect(first.latest()).toBe("0.1.3");
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: "0.1.3", checkedAt: "2026-11-19T12:00:00.000Z" });
		expect(await first.check()).toBe(false);

		const next = createReleaseWatcher({ file, lookUp: async () => null });
		expect(next.latest()).toBe("0.1.3");
		// Offline: what was saved stands.
		expect(await next.check()).toBe(false);
		expect(next.latest()).toBe("0.1.3");
	});

	test("an older answer replaces what was known, so a withdrawn release cannot lock anyone out", async () => {
		const file = fileIn();
		writeFileSync(file, JSON.stringify({ version: "0.1.4" }));
		const watcher = createReleaseWatcher({ file, lookUp: async () => "0.1.3" });
		expect(await watcher.check()).toBe(true);
		expect(watcher.latest()).toBe("0.1.3");
	});

	test("a damaged or missing file is no release", () => {
		const file = fileIn();
		expect(readSavedRelease(file)).toBeNull();
		writeFileSync(file, "{ not json");
		expect(readSavedRelease(file)).toBeNull();
		writeFileSync(file, JSON.stringify({ version: "soon" }));
		expect(readSavedRelease(file)).toBeNull();
	});
});

describe("timberFinder", () => {
	/** A pretend Timber of `version`, judged against whatever is required, as findTimber does. */
	const timberOf = (version: { current: string }) => {
		const asked: string[] = [];
		const look = async (required: string): Promise<TimberStatus> => {
			asked.push(required);
			return satisfiesTimberVersion(version.current, required)
				? { state: "ready", path: "/bin/timber", version: version.current }
				: { state: "too-old", path: "/bin/timber", found: version.current, required };
		};
		return { look, asked };
	};

	test("requires the newest release known on start", async () => {
		const { look } = timberOf({ current: "0.1.3" });
		const find = timberFinder({ look, latest: () => "0.1.4", override: false });
		expect(await find()).toEqual({ state: "too-old", path: "/bin/timber", found: "0.1.3", required: "0.1.4", latestRelease: true });
	});

	test("with no release known, offline on a first start, the built-in minimum is enough", async () => {
		const { look, asked } = timberOf({ current: "0.1.2" });
		const find = timberFinder({ look, latest: () => null, override: false, minimum: "0.1.2" });
		expect(await find()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.2" });
		expect(asked).toEqual(["0.1.2"]);
	});

	test("a release that comes out while Timber is usable is named, not required, until Timber is not usable", async () => {
		const version = { current: "0.1.3" };
		let latest = "0.1.3";
		const { look } = timberOf(version);
		const find = timberFinder({ look, latest: () => latest, override: false });
		expect(await find()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.3" });

		latest = "0.1.4";
		expect(await find()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.3", newerRelease: "0.1.4" });
		// Updated, then Check again: the banner goes.
		version.current = "0.1.4";
		expect(await find()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.4" });
	});

	test("once Timber is not usable, each look requires the newest release known", async () => {
		const version = { current: "0.1.2" };
		let latest = "0.1.3";
		const { look, asked } = timberOf(version);
		const find = timberFinder({ look, latest: () => latest, override: false });
		expect((await find()).state).toBe("too-old");
		latest = "0.1.4";
		version.current = "0.1.3";
		expect(await find()).toMatchObject({ state: "too-old", required: "0.1.4" });
		version.current = "0.1.4";
		expect(await find()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.4" });
		expect(asked).toEqual(["0.1.3", "0.1.4", "0.1.4"]);
	});

	test("the development override needs only the built-in minimum, and gets no banner", async () => {
		const { look, asked } = timberOf({ current: "0.1.2" });
		const find = timberFinder({ look, latest: () => "0.1.3", override: true, minimum: "0.1.2" });
		expect(await find()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.2" });
		expect(asked).toEqual(["0.1.2"]);
	});

	test("waits for the lookup on start before the first look only", async () => {
		let latest: string | null = null;
		let finish!: () => void;
		const before = new Promise<void>(resolve => finish = resolve).then(() => void (latest = "0.1.3"));
		const { look, asked } = timberOf({ current: "0.1.3" });
		const find = timberFinder({ look, latest: () => latest, override: false, before, minimum: "0.1.2" });
		const first = find();
		await Promise.resolve();
		expect(asked).toEqual([]);
		finish();
		expect(await first).toMatchObject({ state: "ready" });
		expect(asked).toEqual(["0.1.3"]);
	});
});

describe("what the window says", () => {
	test("the banner names the release and keeps Timber working until the next start", () => {
		expect(describeTimberUpdate({ state: "ready", path: "/bin/timber", version: "0.1.3", newerRelease: "0.1.4" }))
			.toBe("Timber 0.1.4 is out, and you have 0.1.3. Timber keeps working for now; from the next start, Timber app needs 0.1.4.");
		expect(describeTimberUpdate({ state: "ready", path: "/bin/timber", version: "0.1.4" })).toBeNull();
		expect(describeTimberUpdate(null)).toBeNull();
	});

	test("the notice says the newest release is needed when that is the reason", () => {
		expect(describeTimberProblem({ state: "too-old", path: "/bin/timber", found: "0.1.2", required: "0.1.3", latestRelease: true }))
			.toEqual({ title: "Update Timber", text: "Found Timber 0.1.2 at /bin/timber. Timber app needs the newest release, 0.1.3.", action: "Update it with:" });
	});
});

describe("the window hears a newer release", () => {
	test("asks for the status again, and keeps the worktrees on screen", async () => {
		let status: TimberStatus = { state: "ready", path: "/bin/timber", version: "0.1.3" };
		const engine = createMockEngine(undefined, () => status);
		const store = createAppStore(engine);
		const stop = store.start();
		const settle = () => new Promise(resolve => setTimeout(resolve, 0));
		await settle();
		const repositories = store.getState().repositories;
		expect(repositories.length).toBeGreaterThan(0);

		status = { ...status, newerRelease: "0.1.4" };
		engine.announceTimberChange();
		await settle();
		const timber = store.getState().timber;
		expect(timber?.known && timber.status).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.3", newerRelease: "0.1.4" });
		expect(store.getState().repositories).toEqual(repositories);
		stop();
	});
});
