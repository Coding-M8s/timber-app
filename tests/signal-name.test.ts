import { describe, expect, test } from "bun:test";
import { constants } from "node:os";
import { signalName } from "../src/bun/signal-name";

describe("signalName", () => {
	test("keeps a signal Bun already named", () => {
		expect(signalName("SIGTERM")).toBe("SIGTERM");
	});

	test("names a signal Bun gives as a number", () => {
		expect(signalName(constants.signals.SIGKILL)).toBe("SIGKILL");
	});

	test("describes a number that has no name", () => {
		expect(signalName(200)).toBe("signal 200");
	});

	test("keeps no signal as none", () => {
		expect(signalName(null)).toBeNull();
	});
});
