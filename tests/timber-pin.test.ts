import { describe, expect, test } from "bun:test";
import {
	TIMBER_PIN, readTimberPin, releaseBinaryName, releaseFileUrl, timberExecutableName, timberTarget, vendorFolder,
} from "../src/shared/timber-pin";
import { REQUIRED_TIMBER_VERSION, satisfiesTimberVersion } from "../src/shared/timber-version";

const SUM = "a".repeat(64);
const valid = {
	version: "0.1.4",
	binaries: { "linux-x64": SUM, "windows-x64": SUM, "darwin-arm64": SUM, "darwin-x64": SUM },
	notices: { LICENSE: SUM },
};

describe("the pinned Timber", () => {
	test("is a release the app accepts", () => {
		expect(satisfiesTimberVersion(TIMBER_PIN.version, REQUIRED_TIMBER_VERSION)).toBe(true);
	});

	test("ships Timber's license and its third-party notices", () => {
		expect(Object.keys(TIMBER_PIN.notices).sort()).toEqual(["LICENSE", "THIRD_PARTY_NOTICES.txt"]);
	});
});

describe("readTimberPin", () => {
	test("reads a pin with a checksum for every platform", () => {
		expect(readTimberPin(valid)).toEqual(valid);
	});

	test("refuses a version that is not one, or carries the tag's v", () => {
		expect(() => readTimberPin({ ...valid, version: "latest" })).toThrow("version");
		expect(() => readTimberPin({ ...valid, version: "v0.1.4" })).toThrow("version");
	});

	test("refuses a missing or malformed checksum", () => {
		expect(() => readTimberPin({ ...valid, binaries: { ...valid.binaries, "windows-x64": undefined } })).toThrow("windows-x64");
		expect(() => readTimberPin({ ...valid, binaries: { ...valid.binaries, "linux-x64": "ABC" } })).toThrow("linux-x64");
		expect(() => readTimberPin({ ...valid, notices: { LICENSE: "nope" } })).toThrow("LICENSE");
		expect(() => readTimberPin({ ...valid, notices: { "../LICENSE": SUM } })).toThrow("notice");
		expect(() => readTimberPin({ ...valid, notices: {} })).toThrow("notices");
	});
});

describe("timberTarget", () => {
	test("names the binary for each platform Timber publishes", () => {
		expect(timberTarget("linux", "x64")).toBe("linux-x64");
		expect(timberTarget("win32", "x64")).toBe("windows-x64");
		expect(timberTarget("darwin", "arm64")).toBe("darwin-arm64");
		expect(timberTarget("darwin", "x64")).toBe("darwin-x64");
	});

	test("answers null where there is none, so the app falls back to PATH", () => {
		expect(timberTarget("linux", "arm64")).toBeNull();
		expect(timberTarget("win32", "arm64")).toBeNull();
		expect(timberTarget("freebsd", "x64")).toBeNull();
	});
});

test("release names, URLs, and the vendor folder follow the version and target", () => {
	expect(releaseBinaryName("0.1.4", "linux-x64")).toBe("timber-v0.1.4-linux-x64");
	expect(releaseBinaryName("0.1.4", "windows-x64")).toBe("timber-v0.1.4-windows-x64.exe");
	expect(releaseFileUrl("0.1.4", "LICENSE")).toBe("https://github.com/Coding-M8s/timber/releases/download/v0.1.4/LICENSE");
	expect(timberExecutableName("windows-x64")).toBe("timber.exe");
	expect(timberExecutableName("darwin-arm64")).toBe("timber");
	expect(vendorFolder("0.1.4", "linux-x64")).toBe("vendor/timber/v0.1.4/linux-x64");
});
