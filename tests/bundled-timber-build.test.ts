import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundledTimberCopy } from "../scripts/bundled-timber-copy";
import { TIMBER_PIN, timberTarget, vendorFolder } from "../src/shared/timber-pin";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("bundledTimberCopy", () => {
	let repository: string;
	beforeEach(() => void (repository = mkdtempSync(join(tmpdir(), "bundled-copy-"))));
	afterEach(() => rmSync(repository, { recursive: true, force: true }));

	test("copies the fetched folder of the pinned version into the app as timber", () => {
		mkdirSync(join(repository, vendorFolder(TIMBER_PIN.version, "linux-x64")), { recursive: true });
		expect(bundledTimberCopy(TIMBER_PIN, repository, "linux", "x64", true)).toEqual({ [vendorFolder(TIMBER_PIN.version, "linux-x64")]: "timber" });
	});

	test("copies nothing when it was never fetched, or only for an earlier pin, unless a release needs it", () => {
		mkdirSync(join(repository, vendorFolder("0.0.1", "windows-x64")), { recursive: true });
		expect(bundledTimberCopy(TIMBER_PIN, repository, "win32", "x64", false)).toEqual({});
		expect(() => bundledTimberCopy(TIMBER_PIN, repository, "win32", "x64", true)).toThrow("is missing");
	});

	test("copies nothing where Timber publishes no binary, and a release there is an error", () => {
		expect(bundledTimberCopy(TIMBER_PIN, repository, "linux", "arm64", false)).toEqual({});
		expect(() => bundledTimberCopy(TIMBER_PIN, repository, "linux", "arm64", true)).toThrow("no binary for linux-arm64");
	});
});

test("the build copies the fetched Timber into the app, even when Electrobun reads the config from another folder", () => {
	const elsewhere = mkdtempSync(join(tmpdir(), "electrobun-config-"));
	try {
		const config = pathToFileURL(join(root, "electrobun.config.ts")).href;
		const environment = { ...process.env };
		delete environment.TIMBER_APP_REQUIRE_BUNDLED_TIMBER;
		const read = Bun.spawnSync([process.execPath, "-e", `console.log(JSON.stringify((await import(${JSON.stringify(config)})).default.build.copy))`], { cwd: elsewhere, env: environment, stdout: "pipe", stderr: "pipe" });
		expect(read.stderr.toString()).toBe("");
		const copy = JSON.parse(read.stdout.toString()) as Record<string, string>;
		const target = timberTarget(process.platform, process.arch);
		const vendored = target === null ? null : vendorFolder(TIMBER_PIN.version, target);
		if (vendored !== null && existsSync(join(root, vendored))) expect(copy[vendored]).toBe("timber");
		else expect(Object.values(copy)).not.toContain("timber");
	} finally {
		rmSync(elsewhere, { recursive: true, force: true });
	}
});
