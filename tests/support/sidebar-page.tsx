import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/mainview/App";
import { createMockEngine } from "../../src/mainview/engine/mock";
import { createAppStore } from "../../src/mainview/store/store";
import "../../src/mainview/styles.css";

/**
 * The app over the mock engine with no acted-out delays, for the tests that
 * drive a real browser (see ./browser.ts). The store is on the window so a
 * test can read what the interface did to it.
 */
const store = createAppStore(createMockEngine());
store.start();
Object.assign(window, { timberTestStore: store });
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App store={store} />
	</StrictMode>,
);
