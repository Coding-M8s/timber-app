import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createEngine } from "./engine";
import { createAppStore } from "./store/store";
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

Promise.all([createEngine(), sampleDialog()]).then(
	([engine, sample]) => {
		const store = createAppStore(engine);
		store.start();
		root.render(
			<StrictMode>
				<App store={store}>{sample}</App>
			</StrictMode>,
		);
	},
	(error: unknown) => root.render(<p className="fatal">Timber could not start: {String(error)}</p>),
);
