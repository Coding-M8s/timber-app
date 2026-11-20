import { describe, expect, test } from "bun:test";
import { FFIType, type Pointer, dlopen } from "bun:ffi";
import { join, resolve } from "node:path";
import { setWindowIcon, windowIconFile } from "../src/bun/window-icon";

describe("windowIconFile", () => {
	test("is Resources\\app.ico beside the bin folder of the running executable", () => {
		const execPath = join("C:", "Users", "someone", "AppData", "Local", "com.codingm8s.timber-app", "stable", "app", "bin", "bun.exe");
		expect(windowIconFile(execPath)).toBe(join("C:", "Users", "someone", "AppData", "Local", "com.codingm8s.timber-app", "stable", "app", "Resources", "app.ico"));
	});
});

describe.if(process.platform === "win32")("setWindowIcon on a real window", () => {
	const WM_GETICON = 0x7f;
	const user32 = () => dlopen("user32.dll", {
		CreateWindowExW: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
		DestroyWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
		SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
	});
	const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");

	function withWindow(use: (window: Pointer, read: (which: number) => number) => void): void {
		const lib = user32();
		const window = lib.symbols.CreateWindowExW(0, wide("STATIC"), wide("icon test"), 0, 0, 0, 100, 100, null, null, null, null);
		try {
			expect(window).not.toBeNull();
			use(window as Pointer, which => Number(lib.symbols.SendMessageW(window as Pointer, WM_GETICON, which, null)));
		} finally {
			if (window) lib.symbols.DestroyWindow(window);
			lib.close();
		}
	}

	test("sets the small and the big icon from the shipped .ico", () => {
		withWindow((window, read) => {
			expect(read(0)).toBe(0);
			expect(setWindowIcon(window, resolve("icons", "icon.ico"))).toBeNull();
			expect(read(0)).not.toBe(0);
			expect(read(1)).not.toBe(0);
		});
	});

	test("says so when the file is missing, and leaves the window as it was", () => {
		withWindow((window, read) => {
			const missing = resolve("icons", "missing.ico");
			expect(setWindowIcon(window, missing)).toBe(`Could not load the window icon from ${missing}.`);
			expect(read(0)).toBe(0);
		});
	});
});
