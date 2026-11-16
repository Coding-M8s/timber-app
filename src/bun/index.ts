import { homedir } from "node:os";
import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/main";
import type { AppRPC } from "../shared/rpc";
import { repositoryChanges } from "./changes";
import { createDone } from "./done";
import { readBranches } from "./git-engine";
import { createSavedLayout } from "./layout";
import { createRepositoryList } from "./repository-list";
import { createRepositoryReader } from "./repository-reader";
import { createSettingsHolder, settingsFilePath } from "./settings";
import { createTimberLocator, describeTimberStatus } from "./timber";
import { createWorktreeCommands } from "./worktree-commands";

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

/** The native folder picker. Null when it was closed without a choice. */
async function pickFolder(): Promise<string | null> {
	const [folder] = await Utils.openFileDialog({
		startingFolder: homedir(),
		canChooseFiles: false,
		canChooseDirectory: true,
		allowsMultipleSelection: false,
	});
	return folder || null;
}

const settingsFile = settingsFilePath();
console.log(`Settings at ${settingsFile}`);
// One holder for the file, so the repository list and the layout cannot save over each other.
const settings = createSettingsHolder(settingsFile);
const repositories = createRepositoryList({ settingsFile, settings, pickFolder, reader: createRepositoryReader(() => timber.current()) });
const layout = createSavedLayout(settings);
const worktrees = createWorktreeCommands({ timber: () => timber.current(), isListed: path => repositories.includes(path) });

const done = createDone({ timber: () => timber.current(), findRepository: path => repositories.find(path) });

const rpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15_000,
	handlers: {
		requests: {
			timberStatus: () => timber.current(),
			recheckTimber: () => timber.refresh(),
			listRepositories: () => repositories.list(),
			addRepository: () => repositories.add(),
			removeRepository: ({ path }) => repositories.remove(path),
			loadRepository: ({ path }) => repositories.reload(path),
			// Read-only, and still only for a repository the app lists.
			listBranches: async ({ repository }) => await repositories.includes(repository) ? readBranches(repository) : null,
			// What these answer holds what the command printed, which is private: never log it.
			newWorktree: request => worktrees.create(request),
			openWorktree: request => worktrees.open(request),
			loadLayout: () => layout.load(),
			saveLayout: ({ layout: next }) => layout.save(next),
			previewDone: request => done.preview(request),
			// Removes a worktree. Only ever with a preview that `previewDone` handed out (see ./done.ts).
			applyDone: request => done.apply(request),
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
