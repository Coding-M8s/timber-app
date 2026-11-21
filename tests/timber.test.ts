import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { chooseTimber, createTimberLocator, describeTimberStatus, findBundledTimber, findTimber } from "../src/bun/timber";
import type { TimberStatus } from "../src/shared/model";
import { windows } from "./support/runtime";

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
	current = versioned(root, "current", "0.1.4");
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
		expect(await findTimber(onPath(empty, current.folder))).toEqual({ state: "ready", source: "path", path: current.path, version: "0.1.4" });
		expect(await findTimber(onPath(newer.folder))).toEqual({ state: "ready", source: "path", path: newer.path, version: "0.4.2" });
	});

	test("uses the first Timber on PATH", async () => {
		expect(await findTimber(onPath(newer.folder, old.folder))).toMatchObject({ state: "ready", source: "path", path: newer.path });
		expect(await findTimber(onPath(old.folder, newer.folder))).toMatchObject({ state: "too-old", source: "path", path: old.path });
	});

	test("is not found when PATH has no Timber", async () => {
		expect(await findTimber(onPath(empty))).toEqual({ state: "not-found", source: "path", path: null });
		expect(await findTimber({})).toEqual({ state: "not-found", source: "path", path: null });
	});

	test("is too old, naming the found and required versions, for an older Timber", async () => {
		expect(await findTimber(onPath(old.folder))).toEqual({ state: "too-old", source: "path", path: old.path, found: "0.1.0", required: "0.1.4" });
		expect(await findTimber(onPath(current.folder), "0.2.0")).toEqual({ state: "too-old", source: "path", path: current.path, found: "0.1.4", required: "0.2.0" });
	});

	test("is not found when the executable fails or does not print a version", async () => {
		expect(await findTimber(onPath(broken.folder))).toEqual({ state: "not-found", source: "path", path: broken.path });
		expect(await findTimber(onPath(chatty.folder))).toEqual({ state: "not-found", source: "path", path: chatty.path });
	});

	test("the override takes precedence over PATH", async () => {
		expect(await findTimber({ ...onPath(old.folder), TIMBER_APP_TIMBER_PATH: newer.path }))
			.toEqual({ state: "ready", source: "override", path: newer.path, version: "0.4.2" });
		expect(await findTimber({ ...onPath(newer.folder), TIMBER_APP_TIMBER_PATH: old.path }))
			.toEqual({ state: "too-old", source: "override", path: old.path, found: "0.1.0", required: "0.1.4" });
	});

	test("a relative override resolves from the current folder", async () => {
		const status = await findTimber({ ...onPath(empty), TIMBER_APP_TIMBER_PATH: relative(process.cwd(), current.path) });
		expect(status).toEqual({ state: "ready", source: "override", path: current.path, version: "0.1.4" });
	});

	test("a broken override is reported, not replaced by the Timber on PATH", async () => {
		const missing = join(root, "missing", "timber");
		expect(await findTimber({ ...onPath(current.folder), TIMBER_APP_TIMBER_PATH: missing }))
			.toEqual({ state: "not-found", source: "override", path: missing });
		expect(await findTimber({ ...onPath(current.folder), TIMBER_APP_TIMBER_PATH: empty }))
			.toEqual({ state: "not-found", source: "override", path: empty });
	});

	test("an empty override is ignored", async () => {
		expect(await findTimber({ ...onPath(current.folder), TIMBER_APP_TIMBER_PATH: "  " })).toMatchObject({ state: "ready", source: "path", path: current.path });
	});

	test("only ever asks Timber for its version", () => {
		for (const fake of [current, newer, old]) {
			expect(readdirSync(fake.folder)).toEqual([windows ? "timber.cmd" : "timber"]);
		}
	});

	test("picks up a Timber installed after the first look", async () => {
		const environment = onPath(join(root, "later"));
		expect(await findTimber(environment)).toEqual({ state: "not-found", source: "path", path: null });
		const installed = versioned(root, "later", "0.1.4");
		expect(await findTimber(environment)).toEqual({ state: "ready", source: "path", path: installed.path, version: "0.1.4" });
	});
});

describe("chooseTimber", () => {
	const bundled = "/app/Resources/app/timber/timber";

	test("uses the bundled Timber by default, ahead of the one on PATH", () => {
		expect(chooseTimber(onPath(current.folder), { kind: "bundled" }, bundled)).toEqual({ source: "bundled", path: bundled });
	});

	test("falls back to PATH where the app ships no Timber", () => {
		expect(chooseTimber(onPath(current.folder), { kind: "bundled" }, null)).toEqual({ source: "path", path: current.path });
	});

	test("the PATH choice skips the bundled Timber", () => {
		expect(chooseTimber(onPath(current.folder), { kind: "path" }, bundled)).toEqual({ source: "path", path: current.path });
	});

	test("a chosen file is the only candidate, even when it is missing", () => {
		const missing = join(root, "missing", "timber");
		expect(chooseTimber(onPath(current.folder), { kind: "file", path: missing }, bundled)).toEqual({ source: "setting", path: missing });
	});

	test("the development override comes before the person's choice", () => {
		expect(chooseTimber({ ...onPath(current.folder), TIMBER_APP_TIMBER_PATH: newer.path }, { kind: "file", path: old.path }, bundled))
			.toEqual({ source: "override", path: newer.path });
	});

	test("the chosen file goes through the same version check", async () => {
		expect(await findTimber(onPath(empty), "0.1.3", { kind: "file", path: old.path }, bundled))
			.toEqual({ state: "too-old", source: "setting", path: old.path, found: "0.1.0", required: "0.1.3" });
		expect(await findTimber(onPath(empty), "0.1.3", { kind: "file", path: newer.path }, bundled))
			.toEqual({ state: "ready", source: "setting", path: newer.path, version: "0.4.2" });
	});
});

describe("findBundledTimber", () => {
	test("finds the binary for this platform in the bundled folder, and nothing where there is none", () => {
		const folder = join(root, "bundled");
		mkdirSync(folder);
		expect(findBundledTimber(folder, "linux", "x64")).toBeNull();
		const name = windows ? "timber.exe" : "timber";
		writeFileSync(join(folder, name), "");
		if (!windows) chmodSync(join(folder, name), 0o755);
		const platform = windows ? "win32" : "linux";
		expect(findBundledTimber(folder, platform, "x64")).toBe(join(folder, name));
		expect(findBundledTimber(folder, platform, "arm64")).toBeNull();
		expect(findBundledTimber(folder, "freebsd", "x64")).toBeNull();
	});
});

describe("createTimberLocator", () => {
	test("looks once, then again only on refresh", async () => {
		const answers: TimberStatus[] = [
			{ state: "not-found", source: "path", path: null },
			{ state: "ready", source: "path", path: "/bin/timber", version: "0.1.2" },
		];
		let looks = 0;
		const locator = createTimberLocator(async () => answers[looks++]!);

		expect(looks).toBe(0);
		expect(await locator.current()).toEqual({ state: "not-found", source: "path", path: null });
		expect(await locator.current()).toEqual({ state: "not-found", source: "path", path: null });
		expect(looks).toBe(1);

		expect(await locator.refresh()).toEqual({ state: "ready", source: "path", path: "/bin/timber", version: "0.1.2" });
		expect(await locator.current()).toEqual({ state: "ready", source: "path", path: "/bin/timber", version: "0.1.2" });
		expect(looks).toBe(2);
	});
});

describe("describeTimberStatus", () => {
	test("gives one log line for each state", () => {
		expect(describeTimberStatus({ state: "ready", source: "path", path: "/bin/timber", version: "0.1.2" })).toBe("Timber 0.1.2 at /bin/timber, found on PATH");
		expect(describeTimberStatus({ state: "ready", source: "bundled", path: "/app/timber", version: "0.1.4" })).toBe("Timber 0.1.4 at /app/timber, bundled with the app");
		expect(describeTimberStatus({ state: "too-old", source: "setting", path: "/bin/timber", found: "0.1.0", required: "0.1.2" }))
			.toBe("Timber 0.1.0 at /bin/timber, chosen in Settings, is older than the required 0.1.2");
		expect(describeTimberStatus({ state: "not-found", source: "path", path: null })).toBe("Timber was not found on PATH");
		expect(describeTimberStatus({ state: "not-found", source: "override", path: "/x/timber" })).toBe("No Timber answered at /x/timber, from TIMBER_APP_TIMBER_PATH");
	});
});
