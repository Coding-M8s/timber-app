import { describe, expect, test } from "bun:test";
import { REVEAL_FALLBACK_MILLISECONDS, createWindowReveal } from "../src/bun/window-reveal";
import { createMockEngine } from "../src/mainview/engine/mock";

/** A clock the test moves by hand. */
function manualClock() {
	const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
	let now = 0;
	return {
		schedule(run: () => void, milliseconds: number) {
			const timer = { at: now + milliseconds, run, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		advance(milliseconds: number) {
			now += milliseconds;
			for (const timer of timers) {
				if (!timer.cancelled && timer.at <= now) {
					timer.cancelled = true;
					timer.run();
				}
			}
		},
		pending: () => timers.filter(timer => !timer.cancelled).length,
	};
}

describe("showing the window", () => {
	test("shows it once the interface says it has drawn itself, and only once", () => {
		const clock = manualClock();
		let shows = 0;
		const reveal = createWindowReveal(() => void shows++, clock.schedule);
		expect(shows).toBe(0);
		reveal.ready();
		reveal.ready();
		expect(shows).toBe(1);
		expect(reveal.shownBy()).toBe("ready");
		// The fallback is put away, so it never shows the window a second time.
		expect(clock.pending()).toBe(0);
		clock.advance(REVEAL_FALLBACK_MILLISECONDS * 2);
		expect(shows).toBe(1);
	});

	test("shows it anyway when the interface never says so, and a late word changes nothing", () => {
		const clock = manualClock();
		let shows = 0;
		const reveal = createWindowReveal(() => void shows++, clock.schedule);
		clock.advance(REVEAL_FALLBACK_MILLISECONDS - 1);
		expect(shows).toBe(0);
		expect(reveal.shownBy()).toBeNull();
		clock.advance(1);
		expect(shows).toBe(1);
		expect(reveal.shownBy()).toBe("fallback");
		reveal.ready();
		expect(shows).toBe(1);
	});

	test("the mock engine counts the word, as a browser shows the page itself", () => {
		const engine = createMockEngine();
		expect(engine.readyCalls()).toBe(0);
		engine.windowReady();
		expect(engine.readyCalls()).toBe(1);
	});
});
