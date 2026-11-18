import { type ReactNode, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { defaultPreferences } from "../shared/preferences";
import { createEngine } from "./engine";
import { createAppStore } from "./store/store";
import { applySavedTheme } from "./theme-apply";
import { followWindowState } from "./window-state";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

/**
 * In a browser, ?feedback=demo adds a sample dialog that acts out a Timber
 * command, for working on toasts, failures, and the running state. The
 * desktop app never loads it.
 */
async function sampleDialog(): Promise<ReactNode> {
	if ("__electrobunWebviewId" in window || new URLSearchParams(location.search).get("feedback") !== "demo") return null;
	const { FeedbackDemo } = await import("./components/FeedbackDemo");
	return <FeedbackDemo />;
}

/**
 * The engine, with the saved theme applied before anything is drawn. The
 * desktop app has it already, from the main process; this is what puts it on
 * the page in a browser. A theme that cannot be read leaves the default.
 */
async function themedEngine() {
	const engine = await createEngine();
	const preferences = await engine.loadPreferences().catch(() => defaultPreferences());
	applySavedTheme(preferences.theme, preferences.customThemes);
	return engine;
}

/** How long the window waits for the built-in fonts before it shows with whatever is there. */
const FONT_WAIT_MILLISECONDS = 500;

/**
 * Resolves once the first render has been laid out and its fonts are in,
 * or after a short wait for the fonts. The fonts are built in, so this is
 * quick; without it, text in them would be blank for a moment, as they use
 * `font-display: block`. Never rejects.
 */
function drawn(): Promise<void> {
	const fonts = document.fonts?.ready.then(() => {}, () => {}) ?? Promise.resolve();
	const fontsOrWait = Promise.race([fonts, new Promise<void>(resolve => setTimeout(resolve, FONT_WAIT_MILLISECONDS))]);
	// A task after the render, so the browser has laid it out first.
	return fontsOrWait.then(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
}

Promise.all([themedEngine(), sampleDialog()]).then(
	([engine, sample]) => {
		const store = createAppStore(engine);
		store.start();
		followWindowState(window => store.windowChanged(window));
		// Rendered at once, not when React gets to it, so the window is told it can show only once there is something to see.
		flushSync(() =>
			root.render(
				<StrictMode>
					<App store={store}>{sample}</App>
				</StrictMode>,
			),
		);
		void drawn().then(() => engine.windowReady());
	},
	(error: unknown) => {
		applySavedTheme(defaultPreferences().theme);
		root.render(<p className="fatal">Timber could not start: {String(error)}</p>);
	},
);
