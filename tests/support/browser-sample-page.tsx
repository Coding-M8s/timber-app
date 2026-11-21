import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/mainview/App";
import { browserSampleRepositories, createMockEngine } from "../../src/mainview/engine/mock";
import { createAppStore } from "../../src/mainview/store/store";
import "../../src/mainview/styles.css";

/**
 * The app over the mock engine with every sample repository that
 * `bun run dev:web` lists, merged pull requests among them, for the browser
 * tests that need those rows. Otherwise as ./sidebar-page.tsx.
 */
const store = createAppStore(createMockEngine(browserSampleRepositories));
store.start();
Object.assign(window, { timberTestStore: store });
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App store={store} />
	</StrictMode>,
);
