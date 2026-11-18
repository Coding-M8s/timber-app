import { type ReactNode, StrictMode } from "react";
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

Promise.all([themedEngine(), sampleDialog()]).then(
	([engine, sample]) => {
		const store = createAppStore(engine);
		store.start();
		followWindowState(window => store.windowChanged(window));
		root.render(
			<StrictMode>
				<App store={store}>{sample}</App>
			</StrictMode>,
		);
	},
	(error: unknown) => {
		applySavedTheme(defaultPreferences().theme);
		root.render(<p className="fatal">Timber could not start: {String(error)}</p>);
	},
);
