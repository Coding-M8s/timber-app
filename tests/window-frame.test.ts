import { describe, expect, test } from "bun:test";
import { DEFAULT_WINDOW_FRAME, fitWindowFrame, readSavedWindow, rememberWindow, sameSavedWindow } from "../src/shared/window-frame";

const frame = { x: 300, y: 200, width: 1500, height: 800 };
const laptop = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 2560, height: 1440 };

describe("readSavedWindow", () => {
	test("reads a saved window and rounds to whole units", () => {
		expect(readSavedWindow({ frame, maximized: true })).toEqual({ frame, maximized: true });
		expect(readSavedWindow({ frame: { x: 10.4, y: -20.6, width: 800.5, height: 600.2 } })).toEqual({ frame: { x: 10, y: -21, width: 801, height: 600 }, maximized: false });
	});

	test("answers null for anything that is not a usable window", () => {
		const unusable = [
			undefined,
			null,
			"wide",
			[],
			{},
			{ frame: null },
			{ frame: { x: 0, y: 0, width: 1280 } },
			{ frame: { x: "0", y: 0, width: 1280, height: 820 } },
			{ frame: { x: 0, y: 0, width: Number.NaN, height: 820 } },
			{ frame: { x: 0, y: 0, width: 1e999, height: 820 } },
			{ frame: { x: 0, y: 0, width: 100, height: 820 } },
			{ frame: { x: 0, y: 0, width: 1280, height: 0 } },
		];
		for (const value of unusable) expect(readSavedWindow(value)).toBeNull();
	});
});

describe("rememberWindow", () => {
	test("remembers the frame of a window in its normal state", () => {
		expect(rememberWindow(null, { frame, maximized: false, fullScreen: false })).toEqual({ frame, maximized: false });
	});

	test("does not follow a frame that is only a pixel or two off, so the window cannot creep", () => {
		const before = { frame, maximized: true };
		const near = { x: frame.x - 2, y: frame.y + 1, width: frame.width + 2, height: frame.height - 1 };
		expect(rememberWindow(before, { frame: near, maximized: false, fullScreen: false })).toEqual({ frame, maximized: false });
		const moved = { ...frame, x: frame.x - 3 };
		expect(rememberWindow(before, { frame: moved, maximized: false, fullScreen: false })).toEqual({ frame: moved, maximized: false });
	});

	test("keeps the frame from before while the window is maximized", () => {
		const filled = { x: 0, y: 0, width: 1920, height: 1080 };
		expect(rememberWindow({ frame, maximized: false }, { frame: filled, maximized: true, fullScreen: false })).toEqual({ frame, maximized: true });
		expect(rememberWindow(null, { frame: filled, maximized: true, fullScreen: false })).toEqual({ frame: DEFAULT_WINDOW_FRAME, maximized: true });
	});

	test("does not remember full screen, and keeps what was there before it", () => {
		const filled = { x: 0, y: 0, width: 1920, height: 1080 };
		expect(rememberWindow({ frame, maximized: false }, { frame: filled, maximized: false, fullScreen: true })).toEqual({ frame, maximized: false });
		expect(rememberWindow({ frame, maximized: true }, { frame: filled, maximized: false, fullScreen: true })).toEqual({ frame, maximized: true });
	});

	test("keeps what was there when the window reports a frame that is no size at all", () => {
		const before = { frame, maximized: false };
		expect(rememberWindow(before, { frame: { x: 0, y: 0, width: 0, height: 0 }, maximized: false, fullScreen: false })).toBe(before);
		expect(rememberWindow(null, { frame: { x: 0, y: 0, width: 1, height: 1 }, maximized: false, fullScreen: false })).toBeNull();
	});
});

describe("sameSavedWindow", () => {
	test("compares every part", () => {
		expect(sameSavedWindow({ frame, maximized: false }, { frame: { ...frame }, maximized: false })).toBe(true);
		expect(sameSavedWindow({ frame, maximized: false }, { frame, maximized: true })).toBe(false);
		expect(sameSavedWindow({ frame, maximized: false }, { frame: { ...frame, height: 801 }, maximized: false })).toBe(false);
	});
});

describe("fitWindowFrame", () => {
	test("leaves a frame alone that lies within a display", () => {
		expect(fitWindowFrame(frame, [laptop, second])).toEqual(frame);
		const onSecond = { x: 2200, y: 100, width: 2000, height: 1200 };
		expect(fitWindowFrame(onSecond, [laptop, second])).toEqual(onSecond);
	});

	test("uses the frame as it is when no display is known", () => {
		expect(fitWindowFrame(frame, [])).toEqual(frame);
		expect(fitWindowFrame(frame, [{ x: 0, y: 0, width: 0, height: 0 }])).toEqual(frame);
	});

	test("moves a frame from a display that is gone onto the primary one, keeping its size", () => {
		expect(fitWindowFrame({ x: 2200, y: 100, width: 1500, height: 900 }, [laptop])).toEqual({ x: 420, y: 100, width: 1500, height: 900 });
	});

	test("shrinks a frame that is larger than the display", () => {
		expect(fitWindowFrame({ x: 2200, y: 100, width: 2400, height: 1300 }, [laptop])).toEqual(laptop);
	});

	test("pulls a frame that hangs over an edge back onto the display that shows most of it", () => {
		expect(fitWindowFrame({ x: -200, y: 500, width: 1000, height: 800 }, [laptop, second])).toEqual({ x: 0, y: 280, width: 1000, height: 800 });
		expect(fitWindowFrame({ x: 1800, y: -50, width: 1000, height: 800 }, [laptop, second])).toEqual({ x: 1920, y: 0, width: 1000, height: 800 });
	});
});
