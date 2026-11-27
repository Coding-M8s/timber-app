import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/mainview/App";
import { browserSampleRepositories, browserSampleTags, createMockEngine } from "../../src/mainview/engine/mock";
import { createAppStore } from "../../src/mainview/store/store";
import "../../src/mainview/styles.css";

/**
 * The app over the mock engine with the browser build's sidebar: worktrees
 * of every tag, the timber header colored, and a colored group, Clients
 * (issue 409). Otherwise as ./sidebar-page.tsx.
 */
const engine = createMockEngine(browserSampleRepositories, undefined, { sidebar: browserSampleTags });
const store = createAppStore(engine);
store.start();
Object.assign(window, { timberTestStore: store, timberTestEngine: engine });
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App store={store} />
	</StrictMode>,
);
