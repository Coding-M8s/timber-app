import { BrowserView, BrowserWindow, Updater } from "electrobun/main";
import type { AppRPC } from "../shared/rpc";
import { repositoryChanges } from "./changes";
import { configuredRepositoryPaths, listRepositories, reloadRepository } from "./git-engine";
import { createTimberLocator, describeTimberStatus } from "./timber";

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

/** Look for Timber on start, so the answer is ready when the interface asks. */
const timber = createTimberLocator();
void timber.current().then(status => console.log(describeTimberStatus(status)));

const rpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15_000,
	handlers: {
		requests: {
			timberStatus: () => timber.current(),
			recheckTimber: () => timber.refresh(),
			listRepositories: () => listRepositories(configuredRepositoryPaths()),
			loadRepository: ({ path }) => reloadRepository(path),
		},
		messages: {},
	},
});

// Pass every reported change on to the interface, which reloads that repository.
repositoryChanges.subscribe(path => {
	try {
		rpc.send.repositoryChanged({ path });
	} catch (error) {
		// The window may not be connected yet. Its first load reads everything anyway.
		console.warn(`Could not report a change in ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
});

new BrowserWindow({
	title: "Timber",
	url: await mainViewUrl(),
	frame: { width: 1280, height: 820, x: 120, y: 80 },
	rpc,
});
