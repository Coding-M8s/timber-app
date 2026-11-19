import { describe, expect, test } from "bun:test";
import { CString, FFIType, dlopen } from "bun:ffi";
import { applyWebkitRendering, webkitRenderingVariables } from "../src/bun/webkit-rendering";

describe("webkitRenderingVariables", () => {
	test("turns WebKitGTK's DMA-BUF renderer off on Linux", () => {
		expect(webkitRenderingVariables("linux", {})).toEqual({ WEBKIT_DISABLE_DMABUF_RENDERER: "1" });
	});

	test("leaves a value the person set themselves, even an empty one", () => {
		expect(webkitRenderingVariables("linux", { WEBKIT_DISABLE_DMABUF_RENDERER: "0" })).toEqual({});
		expect(webkitRenderingVariables("linux", { WEBKIT_DISABLE_DMABUF_RENDERER: "" })).toEqual({});
	});

	test("sets nothing on macOS or Windows, which do not use WebKitGTK", () => {
		expect(webkitRenderingVariables("darwin", {})).toEqual({});
		expect(webkitRenderingVariables("win32", {})).toEqual({});
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
