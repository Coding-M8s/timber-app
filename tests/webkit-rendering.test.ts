import { afterEach, describe, expect, test } from "bun:test";
import { CString, FFIType, dlopen } from "bun:ffi";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyWebkitRendering, readGraphicsVendors, readSavedDmabufChoice, setUpRendering } from "../src/bun/webkit-rendering";
import { autoDmabuf, decideRendering } from "../src/shared/rendering";
import { describeRendering } from "../src/mainview/rendering-format";
import { SETTINGS_VERSION } from "../src/shared/settings";

const INTEL = "0x8086";
const NVIDIA = "0x10de";
const AMD = "0x1002";

describe("autoDmabuf", () => {
	test("turns the DMA-BUF renderer off only when every graphics device is Intel", () => {
		expect(autoDmabuf([INTEL])).toBe(false);
		expect(autoDmabuf([INTEL, INTEL])).toBe(false);
		expect(autoDmabuf([NVIDIA, INTEL])).toBe(true);
		expect(autoDmabuf([AMD])).toBe(true);
	});

	test("leaves WebKitGTK's default when no device could be read", () => {
		expect(autoDmabuf([])).toBe(true);
	});
});

describe("decideRendering", () => {
	const never = () => {
		throw new Error("the devices were read when they did not matter");
	};

	test("Auto reads the devices and sets the variable only to turn the renderer off", () => {
		expect(decideRendering("linux", {}, "auto", () => [INTEL])).toEqual({
			status: { applies: true, dmabuf: false, decidedBy: "auto", choice: "auto" },
			variables: { WEBKIT_DISABLE_DMABUF_RENDERER: "1" },
		});
		expect(decideRendering("linux", {}, "auto", () => [NVIDIA, INTEL])).toEqual({
			status: { applies: true, dmabuf: true, decidedBy: "auto", choice: "auto" },
			variables: {},
		});
	});

	test("On and Off are followed whatever the devices", () => {
		expect(decideRendering("linux", {}, "on", never)).toEqual({
			status: { applies: true, dmabuf: true, decidedBy: "choice", choice: "on" },
			variables: {},
		});
		expect(decideRendering("linux", {}, "off", never)).toEqual({
			status: { applies: true, dmabuf: false, decidedBy: "choice", choice: "off" },
			variables: { WEBKIT_DISABLE_DMABUF_RENDERER: "1" },
		});
	});

	test("a variable set before start wins, read as WebKitGTK reads it", () => {
		expect(decideRendering("linux", { WEBKIT_DISABLE_DMABUF_RENDERER: "0" }, "off", never)).toEqual({
			status: { applies: true, dmabuf: true, decidedBy: "variable", choice: "off" },
			variables: {},
		});
		for (const value of ["1", "", "yes"]) {
			expect(decideRendering("linux", { WEBKIT_DISABLE_DMABUF_RENDERER: value }, "on", never).status).toEqual({ applies: true, dmabuf: false, decidedBy: "variable", choice: "on" });
		}
	});

	test("sets nothing on macOS or Windows, which do not use WebKitGTK", () => {
		expect(decideRendering("darwin", {}, "off", never)).toEqual({ status: { applies: false }, variables: {} });
		expect(decideRendering("win32", {}, "off", never)).toEqual({ status: { applies: false }, variables: {} });
	});
});

describe("describeRendering", () => {
	test("says what this run uses, why, and when a change takes effect", () => {
		const auto = { applies: true, dmabuf: false, decidedBy: "auto", choice: "auto" } as const;
		expect(describeRendering(auto, "auto")).toBe("Now: off, Auto found Intel graphics only. A change takes effect the next time the app starts.");
		expect(describeRendering(auto, "on")).toBe("Now: off, Auto found Intel graphics only. Restart the app to use the saved choice.");
		expect(describeRendering({ applies: true, dmabuf: true, decidedBy: "auto", choice: "auto" }, "auto")).toBe("Now: on, Auto kept WebKitGTK's default. A change takes effect the next time the app starts.");
		expect(describeRendering({ applies: true, dmabuf: true, decidedBy: "choice", choice: "on" }, "on")).toBe("Now: on, as chosen. A change takes effect the next time the app starts.");
		expect(describeRendering({ applies: true, dmabuf: true, decidedBy: "variable", choice: "off" }, "off")).toBe("Now: on, because WEBKIT_DISABLE_DMABUF_RENDERER was set when the app started. That variable wins over this setting.");
		expect(describeRendering({ applies: false }, "auto")).toContain("Only used on Linux");
	});
});

describe("reading the machine and the settings file", () => {
	const folders: string[] = [];
	const folder = () => {
		const made = mkdtempSync(join(tmpdir(), "timber-app-rendering-"));
		folders.push(made);
		return made;
	};
	afterEach(() => {
		for (const made of folders.splice(0)) rmSync(made, { recursive: true, force: true });
	});

	test("lists the vendor of each render node, and skips what is not one", () => {
		const drm = folder();
		for (const [name, vendor] of [["renderD129", INTEL], ["renderD128", NVIDIA], ["card0", AMD]] as const) {
			mkdirSync(join(drm, name, "device"), { recursive: true });
			writeFileSync(join(drm, name, "device", "vendor"), `${vendor}\n`);
		}
		mkdirSync(join(drm, "renderD130"));
		expect(readGraphicsVendors(drm)).toEqual([NVIDIA, INTEL]);
		expect(readGraphicsVendors(join(drm, "missing"))).toEqual([]);
	});

	test("reads the saved choice, and Auto when the file is missing, damaged, or has none", () => {
		const dir = folder();
		const file = join(dir, "settings.json");
		expect(readSavedDmabufChoice(file)).toBe("auto");
		writeFileSync(file, JSON.stringify({ version: SETTINGS_VERSION, preferences: { dmabuf: "off" } }));
		expect(readSavedDmabufChoice(file)).toBe("off");
		writeFileSync(file, JSON.stringify({ version: SETTINGS_VERSION, preferences: { dmabuf: "sometimes" } }));
		expect(readSavedDmabufChoice(file)).toBe("auto");
		writeFileSync(file, "{ not json");
		expect(readSavedDmabufChoice(file)).toBe("auto");
	});

	test("setting up never throws, and leaves a variable set before start alone", () => {
		const dir = folder();
		const file = join(dir, "settings.json");
		writeFileSync(file, JSON.stringify({ version: SETTINGS_VERSION, preferences: { dmabuf: "off" } }));
		expect(setUpRendering(file, { WEBKIT_DISABLE_DMABUF_RENDERER: "0" }, "linux")).toEqual({ applies: true, dmabuf: true, decidedBy: "variable", choice: "off" });
		writeFileSync(file, JSON.stringify({ version: SETTINGS_VERSION, preferences: { dmabuf: "on" } }));
		expect(setUpRendering(file, {}, "linux")).toEqual({ applies: true, dmabuf: true, decidedBy: "choice", choice: "on" });
		expect(setUpRendering(join(dir, "missing.json"), {}, "darwin")).toEqual({ applies: false });
	});
});

describe.if(process.platform === "linux")("applyWebkitRendering", () => {
	const libc = dlopen("libc.so.6", {
		getenv: { args: [FFIType.cstring], returns: FFIType.ptr },
		unsetenv: { args: [FFIType.cstring], returns: FFIType.i32 },
	});
	const cString = (text: string) => Buffer.from(`${text}\0`);
	const nativeValue = (name: string) => {
		const pointer = libc.symbols.getenv(cString(name));
		return pointer ? new CString(pointer).toString() : null;
	};

	test("writes the variables where WebKitGTK reads them, the C environment, not only process.env", () => {
		const name = "TIMBER_APP_TEST_RENDERING_VARIABLE";
		libc.symbols.unsetenv(cString(name));
		try {
			applyWebkitRendering({ [name]: "1" });
			expect(nativeValue(name)).toBe("1");
			// Not in process.env, so terminals the app starts do not inherit it.
			expect(process.env[name]).toBeUndefined();
		} finally {
			libc.symbols.unsetenv(cString(name));
		}
	});
});
