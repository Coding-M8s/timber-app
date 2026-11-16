import { homedir } from "node:os";
import Electrobun, { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/main";
import type { AppRPC } from "../shared/rpc";
import { describeQuitRequest } from "../shared/terminal";
import { repositoryChanges } from "./changes";
import { createDone } from "./done";
import { createEditorLauncher } from "./editor";
import { readBranches } from "./git-engine";
import { createSavedLayout } from "./layout";
import { createSavedPreferences } from "./preferences";
import { createRepositoryList } from "./repository-list";
import { createRepositoryReader } from "./repository-reader";
import { createSettingsHolder, settingsFilePath } from "./settings";
import { createTimberLocator, describeTimberStatus } from "./timber";
import { openWebLink } from "./open-link";
import { createQuitGuard } from "./quit-guard";
import { createTerminalSessions } from "./terminals";
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
const preferences = createSavedPreferences(settings);
const worktrees = createWorktreeCommands({ timber: () => timber.current(), isListed: path => repositories.includes(path) });

const done = createDone({ timber: () => timber.current(), findRepository: path => repositories.find(path) });
const editor = createEditorLauncher({ preferences: () => preferences.load(), findRepository: path => repositories.find(path) });

/** Report to the window. It may not be connected yet, or be reloading; its first load reads everything anyway. */
function tell(what: string, send: () => void): void {
	try {
		send();
	} catch (error) {
		console.warn(`Could not report ${what} to the window: ${error instanceof Error ? error.message : String(error)}`);
	}
}

// What a terminal prints is private, like what a command prints: it goes to the window and is never logged.
const terminals = createTerminalSessions({
	findRepository: path => repositories.find(path),
	onOutput: output => tell("terminal output", () => rpc.send.terminalOutput(output)),
	onChange: change => tell("a terminal change", () => rpc.send.terminalChanged(change)),
});

const quitGuard = createQuitGuard({
	liveCount: () => terminals.liveCount(),
	// The window answers at once whether it shows the question. A window that is blank or broken does not answer in time.
	ask: live => rpc.request.askQuit({ live }, { maxRequestTime: 2000 }),
	async askNatively(live) {
		const { title, text } = describeQuitRequest(live);
		const { response } = await Utils.showMessageBox({
			type: "warning",
			title,
			message: title,
			detail: text,
			buttons: ["Keep running", "Quit"],
			defaultId: 0,
			cancelId: 0,
		});
		return response === 1;
	},
	endAll: () => terminals.closeAll(),
	quit: () => Utils.quit(),
});

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
			loadPreferences: () => preferences.load(),
			savePreferences: ({ change }) => preferences.save(change),
			// Starts the editor from the saved setting only. The request names the worktree, never the command (see ./editor.ts).
			openInEditor: request => editor.open(request),
			previewDone: request => done.preview(request),
			// Removes a worktree. Only ever with a preview that `previewDone` handed out (see ./done.ts).
			applyDone: request => done.apply(request),
			listTerminals: () => terminals.list(),
			// Starts a shell only in a worktree Timber lists (see ./terminals.ts).
			openTerminal: request => terminals.open(request),
			readTerminal: ({ id }) => terminals.read(id),
			closeTerminal: ({ id }) => terminals.close(id),
			confirmQuit: () => quitGuard.confirm(),
			writeClipboard: ({ text }) => Utils.clipboardWriteText(text),
			readClipboard: () => Utils.clipboardReadText(),
			// Only web links, to the person's browser, never through a shell (see ./open-link.ts).
			openLink: ({ url }) => openWebLink(url),
		},
		messages: {
			writeTerminal: ({ id, data }) => terminals.write(id, data),
			resizeTerminal: ({ id, cols, rows }) => terminals.resize(id, cols, rows),
			terminalDrawn: ({ id, seq }) => terminals.drawn(id, seq),
		},
	},
});

// Pass every reported change on to the interface, which reloads that repository.
repositoryChanges.subscribe(path => tell(`a change in ${path}`, () => rpc.send.repositoryChanged({ path })));

type Veto = { response?: { allow: boolean } };
// Quitting while terminals run waits for the person (see ./quit-guard.ts). When it goes ahead, every session ends with it.
// SIGINT and SIGTERM arrive here as the same request: the app's code runs in a Worker, where signal listeners never run,
// and Electrobun's native side turns the signal into a quit request. So they ask too.
function guardQuit(event: unknown): void {
	if (quitGuard.mayQuit()) {
		// The app goes away in a moment, so there is no time to wait for anything to end by itself.
		terminals.killAll();
		return;
	}
	(event as Veto).response = { allow: false };
}
Electrobun.events.on("before-quit", guardQuit);

const mainWindow = new BrowserWindow({
	title: "Timber",
	url: await mainViewUrl(),
	frame: { width: 1280, height: 820, x: 120, y: 80 },
	rpc,
});
// Closing the last window quits the app, so it asks the same question first.
mainWindow.on("will-close", event => {
	if (!quitGuard.mayQuit()) (event as Veto).response = { allow: false };
});
