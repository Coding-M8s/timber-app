/**
 * Where the window was and how large, remembered between runs. Everything
 * here is pure. The main process reads the real window and the real displays
 * (see src/bun/window-memory.ts).
 */

/** A rectangle on the desktop, in the units the window system reports. */
export interface WindowFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SavedWindow {
	/** The frame of the window while it is neither maximized nor full screen. */
	frame: WindowFrame;
	/** Whether the window was maximized when it was last seen. */
	maximized: boolean;
}

/** The window as the window system reports it at one moment. */
export interface SeenWindow extends SavedWindow {
	fullScreen: boolean;
}

/** The window of a first run, and of a run whose saved window cannot be read. */
export const DEFAULT_WINDOW_FRAME: WindowFrame = { x: 120, y: 80, width: 1280, height: 820 };

/** Below this a saved size is taken for a mistake, not for a choice. */
export const MIN_WINDOW_WIDTH = 480;
export const MIN_WINDOW_HEIGHT = 320;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFrame(value: unknown): WindowFrame | null {
	if (!isRecord(value)) return null;
	const { x, y, width, height } = value;
	for (const part of [x, y, width, height]) {
		if (typeof part !== "number" || !Number.isFinite(part)) return null;
	}
	const frame = { x: Math.round(x as number), y: Math.round(y as number), width: Math.round(width as number), height: Math.round(height as number) };
	return frame.width >= MIN_WINDOW_WIDTH && frame.height >= MIN_WINDOW_HEIGHT ? frame : null;
}

/**
 * Read a saved window from a value that came from outside, such as the
 * settings file. Null when it cannot be read, which means the default window.
 * It is a convenience, so it never makes the file count as damaged.
 */
export function readSavedWindow(value: unknown): SavedWindow | null {
	if (!isRecord(value)) return null;
	const frame = readFrame(value.frame);
	return frame && { frame, maximized: value.maximized === true };
}

export function sameSavedWindow(one: SavedWindow, other: SavedWindow): boolean {
	return one.maximized === other.maximized
		&& one.frame.x === other.frame.x
		&& one.frame.y === other.frame.y
		&& one.frame.width === other.frame.width
		&& one.frame.height === other.frame.height;
}

/**
 * A window that opens at a saved frame can land a pixel or two away from it,
 * as it does under fractional scaling. A change this small is not remembered,
 * so the window does not creep a little further with every run.
 */
export const WINDOW_FRAME_SLACK = 2;

function nearlySameFrame(one: WindowFrame, other: WindowFrame): boolean {
	return Math.abs(one.x - other.x) <= WINDOW_FRAME_SLACK
		&& Math.abs(one.y - other.y) <= WINDOW_FRAME_SLACK
		&& Math.abs(one.width - other.width) <= WINDOW_FRAME_SLACK
		&& Math.abs(one.height - other.height) <= WINDOW_FRAME_SLACK;
}

/**
 * What to remember after seeing the window. A maximized or full screen window
 * reports the frame it fills, so the frame from before is kept: leaving that
 * state in a later run goes back to the size the person chose. Full screen is
 * not remembered itself. Null when there is nothing worth remembering.
 */
export function rememberWindow(previous: SavedWindow | null, seen: SeenWindow): SavedWindow | null {
	if (seen.maximized || seen.fullScreen) {
		const frame = previous?.frame ?? DEFAULT_WINDOW_FRAME;
		return { frame, maximized: seen.fullScreen ? previous?.maximized ?? false : true };
	}
	const frame = readFrame(seen.frame);
	if (!frame) return previous;
	return { frame: previous && nearlySameFrame(previous.frame, frame) ? previous.frame : frame, maximized: false };
}

function overlap(frame: WindowFrame, area: WindowFrame): number {
	const width = Math.min(frame.x + frame.width, area.x + area.width) - Math.max(frame.x, area.x);
	const height = Math.min(frame.y + frame.height, area.y + area.height) - Math.max(frame.y, area.y);
	return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The frame to open the window with, given the usable area of each display,
 * the primary one first. The frame is moved, and shrunk when it has to be,
 * until it lies within the display that shows most of it, so a window saved
 * on a display that is gone or smaller now does not open out of reach. With
 * no known display the frame is used as it is.
 */
export function fitWindowFrame(frame: WindowFrame, areas: readonly WindowFrame[]): WindowFrame {
	const usable = areas.filter(area => area.width > 0 && area.height > 0);
	const [first] = usable;
	if (!first) return frame;
	let best = first;
	for (const area of usable) {
		if (overlap(frame, area) > overlap(frame, best)) best = area;
	}
	const width = Math.min(frame.width, best.width);
	const height = Math.min(frame.height, best.height);
	return {
		x: Math.min(Math.max(frame.x, best.x), best.x + best.width - width),
		y: Math.min(Math.max(frame.y, best.y), best.y + best.height - height),
		width,
		height,
	};
}
