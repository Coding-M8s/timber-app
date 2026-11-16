import { describe, expect, test } from "bun:test";
import type { WindowState } from "../src/mainview/store/store";
import { type WindowSource, followWindowState } from "../src/mainview/window-state";

/** A page whose visibility and focus the test sets, firing the events a browser would. */
function fakePage() {
	const page = new EventTarget();
	const view = new EventTarget();
	let visibility: DocumentVisibilityState = "visible";
	let focus = true;
	const source: WindowSource = {
		document: {
			get visibilityState() {
				return visibility;
			},
			hasFocus: () => focus,
			addEventListener: page.addEventListener.bind(page),
			removeEventListener: page.removeEventListener.bind(page),
		},
		window: { addEventListener: view.addEventListener.bind(view), removeEventListener: view.removeEventListener.bind(view) },
	};
	return {
		source,
		hide() {
			visibility = "hidden";
			focus = false;
			view.dispatchEvent(new Event("blur"));
			page.dispatchEvent(new Event("visibilitychange"));
		},
		show() {
			visibility = "visible";
			page.dispatchEvent(new Event("visibilitychange"));
		},
		focus() {
			focus = true;
			view.dispatchEvent(new Event("focus"));
		},
	};
}

describe("followWindowState", () => {
	test("reports at once, then on every hide, show, focus, and blur, until stopped", () => {
		const page = fakePage();
		const reports: WindowState[] = [];
		const stop = followWindowState(state => reports.push(state), page.source);
		expect(reports).toEqual([{ visible: true, focused: true }]);

		page.hide();
		expect(reports.at(-1)).toEqual({ visible: false, focused: false });
		page.show();
		expect(reports.at(-1)).toEqual({ visible: true, focused: false });
		page.focus();
		expect(reports.at(-1)).toEqual({ visible: true, focused: true });

		stop();
		const count = reports.length;
		page.hide();
		expect(reports.length).toBe(count);
	});
});
