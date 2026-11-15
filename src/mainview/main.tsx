import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createEngine } from "./engine";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

createEngine().then(
	engine => root.render(
		<StrictMode>
			<App engine={engine} />
		</StrictMode>,
	),
	(error: unknown) => root.render(<p className="fatal">Timber could not start: {String(error)}</p>),
);
