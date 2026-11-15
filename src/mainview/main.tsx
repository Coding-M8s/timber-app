import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createEngine } from "./engine";
import { createAppStore } from "./store/store";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

createEngine().then(
	engine => {
		const store = createAppStore(engine);
		store.start();
		root.render(
			<StrictMode>
				<App store={store} />
			</StrictMode>,
		);
	},
	(error: unknown) => root.render(<p className="fatal">Timber could not start: {String(error)}</p>),
);
