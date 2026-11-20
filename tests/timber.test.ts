import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { createTimberLocator, describeTimberStatus, findTimber } from "../src/bun/timber";
import type { TimberStatus } from "../src/shared/model";

const windows = process.platform === "win32";

/**
 * Put a real executable named `timber` in a new folder under `root`. It runs
 * `script` (POSIX shell) or `batch` (Windows), so the tests spawn an actual
 * process exactly as the app does.
 */
function fakeTimber(root: string, folder: string, script: string, batch: string): { folder: string; path: string } {
	const directory = join(root, folder);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, windows ? "timber.cmd" : "timber");
	writeFileSync(path, windows ? `@echo off\r\n${batch}\r\n` : `#!/bin/sh\n${script}\n`);
	if (!windows) chmodSync(path, 0o755);
	return { folder: directory, path };
}

/** A Timber that prints `version` and leaves a marker file if it is ever given anything but --version. */
function versioned(root: string, folder: string, version: string) {
	return fakeTimber(
		root,
		folder,
		`if [ "$#" -ne 1 ] || [ "$1" != "--version" ]; then touch "$(dirname "$0")/misused"; exit 2; fi\necho "${version}"`,
		`if not "%~1"=="--version" (type nul > "%~dp0misused" & exit /b 2)\r\necho ${version}`,
	);
}

let root: string;
let current: { folder: string; path: string };
let newer: { folder: string; path: string };
let old: { folder: string; path: string };
let broken: { folder: string; path: string };
let chatty: { folder: string; path: string };
let empty: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "timber-app-find-"));
	current = versioned(root, "current", "0.1.3");
	newer = versioned(root, "newer", "0.4.2");
	old = versioned(root, "old", "0.1.0");
	broken = fakeTimber(root, "broken", "exit 1", "exit /b 1");
	chatty = fakeTimber(root, "chatty", "echo hello", "echo hello");
	empty = join(root, "empty");
	mkdirSync(empty);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Only the given folders are searched, so a Timber installed on this machine cannot leak in. */
const onPath = (...folders: string[]) => ({ PATH: folders.join(delimiter) });

describe("findTimber", () => {
	test("is ready, with path and version, when a new enough Timber is on PATH", async () => {
		expect(await findTimber(onPath(empty, current.folder))).toEqual({ state: "ready", path: current.path, version: "0.1.3" });
		expect(await findTimber(onPath(newer.folder))).toEqual({ state: "ready", path: newer.path, version: "0.4.2" });
	});

	test("uses the first Timber on PATH", async () => {
		expect(await findTimber(onPath(newer.folder, old.folder))).toMatchObject({ state: "ready", path: newer.path });
		expect(await findTimber(onPath(old.folder, newer.folder))).toMatchObject({ state: "too-old", path: old.path });
	});

	test("is not found when PATH has no Timber", async () => {
		expect(await findTimber(onPath(empty))).toEqual({ state: "not-found", override: null });
		expect(await findTimber({})).toEqual({ state: "not-found", override: null });
	});

	test("is too old, naming the found and required versions, for an older Timber", async () => {
		expect(await findTimber(onPath(old.folder))).toEqual({ state: "too-old", path: old.path, found: "0.1.0", required: "0.1.3" });
		expect(await findTimber(onPath(current.folder), "0.2.0")).toEqual({ state: "too-old", path: current.path, found: "0.1.3", required: "0.2.0" });
	});

	test("is not found when the executable fails or does not print a version", async () => {
		expect(await findTimber(onPath(broken.folder))).toEqual({ state: "not-found", override: null });
		expect(await findTimber(onPath(chatty.folder))).toEqual({ state: "not-found", override: null });
	});

	test("the override takes precedence over PATH", async () => {
		expect(await findTimber({ ...onPath(old.folder), TIMBER_APP_TIMBER_PATH: newer.path }))
			.toEqual({ state: "ready", path: newer.path, version: "0.4.2" });
		expect(await findTimber({ ...onPath(newer.folder), TIMBER_APP_TIMBER_PATH: old.path }))
			.toEqual({ state: "too-old", path: old.path, found: "0.1.0", required: "0.1.3" });
	});

	test("a relative override resolves from the current folder", async () => {
		const status = await findTimber({ ...onPath(empty), TIMBER_APP_TIMBER_PATH: relative(process.cwd(), current.path) });
		expect(status).toEqual({ state: "ready", path: current.path, version: "0.1.3" });
	});

	test("a broken override is reported, not replaced by the Timber on PATH", async () => {
		const missing = join(root, "missing", "timber");
		expect(await findTimber({ ...onPath(current.folder), TIMBER_APP_TIMBER_PATH: missing }))
			.toEqual({ state: "not-found", override: missing });
		expect(await findTimber({ ...onPath(current.folder), TIMBER_APP_TIMBER_PATH: empty }))
			.toEqual({ state: "not-found", override: empty });
	});

	test("an empty override is ignored", async () => {
		expect(await findTimber({ ...onPath(current.folder), TIMBER_APP_TIMBER_PATH: "  " })).toMatchObject({ state: "ready", path: current.path });
	});

	test("only ever asks Timber for its version", () => {
		for (const fake of [current, newer, old]) {
			expect(readdirSync(fake.folder)).toEqual([windows ? "timber.cmd" : "timber"]);
		}
	});

	test("picks up a Timber installed after the first look", async () => {
		const environment = onPath(join(root, "later"));
		expect(await findTimber(environment)).toEqual({ state: "not-found", override: null });
		const installed = versioned(root, "later", "0.1.3");
		expect(await findTimber(environment)).toEqual({ state: "ready", path: installed.path, version: "0.1.3" });
	});
});

describe("createTimberLocator", () => {
	test("looks once, then again only on refresh", async () => {
		const answers: TimberStatus[] = [
			{ state: "not-found", override: null },
			{ state: "ready", path: "/bin/timber", version: "0.1.2" },
		];
		let looks = 0;
		const locator = createTimberLocator(async () => answers[looks++]!);

		expect(looks).toBe(0);
		expect(await locator.current()).toEqual({ state: "not-found", override: null });
		expect(await locator.current()).toEqual({ state: "not-found", override: null });
		expect(looks).toBe(1);

		expect(await locator.refresh()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.2" });
		expect(await locator.current()).toEqual({ state: "ready", path: "/bin/timber", version: "0.1.2" });
		expect(looks).toBe(2);
	});
});

describe("describeTimberStatus", () => {
	test("gives one log line for each state", () => {
		expect(describeTimberStatus({ state: "ready", path: "/bin/timber", version: "0.1.2" })).toBe("Timber 0.1.2 at /bin/timber");
		expect(describeTimberStatus({ state: "too-old", path: "/bin/timber", found: "0.1.0", required: "0.1.2" }))
			.toBe("Timber 0.1.0 at /bin/timber is older than the required 0.1.2");
		expect(describeTimberStatus({ state: "not-found", override: null })).toBe("Timber was not found on PATH");
		expect(describeTimberStatus({ state: "not-found", override: "/x/timber" })).toBe("No Timber answered at /x/timber (TIMBER_APP_TIMBER_PATH)");
	});
});
