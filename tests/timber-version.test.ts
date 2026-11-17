import { describe, expect, test } from "bun:test";
import {
	REQUIRED_TIMBER_VERSION,
	compareTimberVersions,
	parseTimberVersion,
	readVersionOutput,
	satisfiesTimberVersion,
} from "../src/shared/timber-version";

const compare = (left: string, right: string) => Math.sign(compareTimberVersions(parseTimberVersion(left)!, parseTimberVersion(right)!));

describe("parseTimberVersion", () => {
	test("reads plain, prefixed, and pre-release versions", () => {
		expect(parseTimberVersion("0.1.1")).toEqual({ major: 0, minor: 1, patch: 1, prerelease: false });
		expect(parseTimberVersion(" v12.30.4\n")).toEqual({ major: 12, minor: 30, patch: 4, prerelease: false });
		expect(parseTimberVersion("0.2.0-beta.1")).toEqual({ major: 0, minor: 2, patch: 0, prerelease: true });
		expect(parseTimberVersion("0.2.0+build.5")).toEqual({ major: 0, minor: 2, patch: 0, prerelease: false });
	});

	test("answers null for text that is not a version", () => {
		for (const text of ["", "timber", "1.2", "1.2.3.4", "1.2.x", "one.two.three", "-1.2.3"]) {
			expect(parseTimberVersion(text)).toBeNull();
		}
	});
});

describe("compareTimberVersions", () => {
	test("orders by major, then minor, then patch, as numbers", () => {
		expect(compare("0.1.1", "0.1.1")).toBe(0);
		expect(compare("0.1.0", "0.1.1")).toBe(-1);
		expect(compare("0.1.2", "0.1.1")).toBe(1);
		expect(compare("0.2.0", "0.1.9")).toBe(1);
		expect(compare("1.0.0", "0.9.9")).toBe(1);
		expect(compare("0.1.10", "0.1.9")).toBe(1);
		expect(compare("0.10.0", "0.9.0")).toBe(1);
	});

	test("puts a pre-release before its release and after the release below it", () => {
		expect(compare("0.1.1-beta.1", "0.1.1")).toBe(-1);
		expect(compare("0.1.1", "0.1.1-beta.1")).toBe(1);
		expect(compare("0.1.2-beta.1", "0.1.1")).toBe(1);
	});
});

describe("satisfiesTimberVersion", () => {
	test("requires 0.1.2, the first with the settings commands, by default", () => {
		expect(REQUIRED_TIMBER_VERSION).toBe("0.1.2");
		expect(satisfiesTimberVersion("0.1.2")).toBe(true);
		expect(satisfiesTimberVersion("0.2.0")).toBe(true);
		expect(satisfiesTimberVersion("1.0.0")).toBe(true);
		expect(satisfiesTimberVersion("0.1.1")).toBe(false);
		expect(satisfiesTimberVersion("0.1.0")).toBe(false);
		expect(satisfiesTimberVersion("0.1.2-rc.1")).toBe(false);
	});

	test("never accepts a version it cannot read", () => {
		expect(satisfiesTimberVersion("latest")).toBe(false);
		expect(satisfiesTimberVersion("")).toBe(false);
	});
});

describe("readVersionOutput", () => {
	test("reads the version from what the command prints", () => {
		expect(readVersionOutput("0.1.1\n")).toBe("0.1.1");
		expect(readVersionOutput("0.1.1\r\n")).toBe("0.1.1");
		expect(readVersionOutput("timber 0.3.0\n")).toBe("0.3.0");
		expect(readVersionOutput("v0.1.1\n")).toBe("0.1.1");
		expect(readVersionOutput("0.2.0-beta.1\n")).toBe("0.2.0-beta.1");
	});

	test("answers null when the output is not a version", () => {
		expect(readVersionOutput("")).toBeNull();
		expect(readVersionOutput("usage: timber [options]\n")).toBeNull();
		expect(readVersionOutput("error\n0.1.1\n")).toBeNull();
	});
});
