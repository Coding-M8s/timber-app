import { BrowserView, BrowserWindow, Updater } from "electrobun/main";
import type { AppRPC } from "../shared/rpc";
import { configuredRepositoryPaths, listRepositories } from "./git-engine";

const DEV_SERVER_URL = "http://localhost:5173";

/** In development, prefer the Vite server so interface edits apply without a relaunch. */
async function mainViewUrl(): Promise<string> {
	if (await Updater.localInfo.channel() === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			return DEV_SERVER_URL;
		} catch {
			// No dev server: fall through to the bundled interface.
		}
	}
	return "views://mainview/index.html";
}

const rpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15_000,
	handlers: {
		requests: {
			listRepositories: () => listRepositories(configuredRepositoryPaths()),
		},
		messages: {},
	},
});

new BrowserWindow({
	title: "Timber",
	url: await mainViewUrl(),
	frame: { width: 1280, height: 820, x: 120, y: 80 },
	rpc,
});
