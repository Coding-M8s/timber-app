import { FFIType, type Pointer, dlopen } from "bun:ffi";
import { dirname, join } from "node:path";

/*
 * Electrobun 2.0.6 gives a window no icon on Windows: its `setWindowIcon` is
 * an empty stub there, and the window class has none. The title bar then
 * shows Windows' default icon. The window pointer Electrobun hands out on
 * Windows is the HWND, so the app loads the icon the build ships in
 * Resources and gives it to the window itself.
 */

const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x10;
const WM_SETICON = 0x80;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXSMICON = 49;
const SM_CYSMICON = 50;

/** The icon the Windows build ships, `Resources\app.ico`, next to the `bin` folder of the running executable. */
export function windowIconFile(execPath: string): string {
	return join(dirname(execPath), "..", "Resources", "app.ico");
}

function wide(text: string): Buffer {
	return Buffer.from(`${text}\0`, "utf16le");
}

/**
 * Give a window its title bar and taskbar icons from an .ico file. Windows
 * only. Returns a reason when the icon could not be loaded, null when both
 * sizes were set. The icons stay loaded for the life of the process.
 */
export function setWindowIcon(window: Pointer, iconFile: string): string | null {
	const user32 = dlopen("user32.dll", {
		LoadImageW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
		SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
		GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
	});
	try {
		const { LoadImageW, SendMessageW, GetSystemMetrics } = user32.symbols;
		const path = wide(iconFile);
		const sizes = [
			{ which: ICON_SMALL, width: GetSystemMetrics(SM_CXSMICON), height: GetSystemMetrics(SM_CYSMICON) },
			{ which: ICON_BIG, width: GetSystemMetrics(SM_CXICON), height: GetSystemMetrics(SM_CYICON) },
		];
		for (const size of sizes) {
			const icon = LoadImageW(null, path, IMAGE_ICON, size.width, size.height, LR_LOADFROMFILE);
			if (!icon) return `Could not load the window icon from ${iconFile}.`;
			SendMessageW(window, WM_SETICON, size.which, icon);
		}
		return null;
	} finally {
		user32.close();
	}
}

/** Give the window the shipped icon on Windows; elsewhere Electrobun already does. Never throws. */
export function applyWindowIcon(window: Pointer | null, execPath = process.execPath, platform = process.platform): void {
	if (platform !== "win32") return;
	try {
		if (window === null) {
			console.warn("Could not set the window icon: the window has no handle.");
			return;
		}
		const problem = setWindowIcon(window, windowIconFile(execPath));
		if (problem !== null) console.warn(problem);
	} catch (error) {
		console.warn(`Could not set the window icon: ${error instanceof Error ? error.message : String(error)}`);
	}
}
