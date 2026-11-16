import { homedir } from "node:os";
import Electrobun, { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/main";
import { type ForcePushMarks, withForcePushes } from "../shared/git-fetch";
import type { Repository } from "../shared/model";
import type { AppRPC } from "../shared/rpc";
import { repositoryChanges } from "./changes";
import { createDone } from "./done";
import { createEditorLauncher } from "./editor";
import { createGitRunner } from "./fetch-git";
import { createFetcher } from "./fetcher";
import { createSavedForcePushes } from "./force-pushes";
import { createFileChanges } from "./file-changes";
import { readBranches } from "./git-engine";
import { createSavedLayout } from "./layout";
import { createSavedPreferences } from "./preferences";
import { createRepositoryList } from "./repository-list";
import { createRepositoryReader } from "./repository-reader";
import { createSettingsHolder, settingsFilePath } from "./settings";
import { createTimberLocator, describeTimberStatus } from "./timber";
import { openWebLink } from "./open-link";
import { createQuitGuard } from "./quit-guard";
import { createRefreshPolicy } from "./refresh-policy";
import { type WatchTarget, createRepositoryWatcher } from "./repository-watcher";
import { createWorktreeStamps } from "./worktree-stamp";
import { createTerminalSessions } from "./terminals";
import { createTimberSettings } from "./timber-settings";
import { createWorktreeCommands } from "./worktree-commands";
import { createWorkflowReader } from "./workflows";

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

/*
 * Background refresh (see docs/architecture.md, "Watching for changes"). The watcher hears changes to the Git
 * metadata of every listed repository, the policy passes them on only while the window shows, and checks the
 * selected worktree for edits now and then. What they report goes out through `repositoryChanges`.
 */
let watchTargets: readonly WatchTarget[] = [];
const refreshPolicy = createRefreshPolicy({
	announce: path => repositoryChanges.announce(path),
	readStamp: createWorktreeStamps({ targets: () => watchTargets }),
	onReturn: () => void watchRepositories(),
});
const watcher = createRepositoryWatcher({ onChange: path => refreshPolicy.changed(path) });

/*
 * Fetching (see docs/architecture.md, "Fetching"). Every repository in the list is fetched in the background on the
 * interval from the preferences, and when the person asks. A fetch writes only remote-tracking refs. What it moved
 * is reported like any other change, through the refresh policy, so a hidden window catches up when it returns.
 */
const savedForcePushes = createSavedForcePushes(settings);
const fetcher = createFetcher({
	runGit: createGitRunner(),
	onChanged: path => refreshPolicy.changed(path),
	onStatus: status => tell("where fetching stands", () => rpc.send.fetchChanged(status)),
	marks: await savedForcePushes.load(),
	saveMarks: marks => void savedForcePushes.save(marks),
});
// Nothing is fetched in the background until the preferences say whether to.
void preferences.load().then(
	saved => fetcher.configure(saved.fetch),
	error => console.warn(`Could not read whether to fetch in the background, so nothing is fetched until Fetch now: ${error instanceof Error ? error.message : String(error)}`),
);

/**
 * A repository as read, with its branches marked force-pushed where a fetch found a rewrite nobody saw yet. `marks`
 * were taken before the read, so a mark that a fetch made while Git answered is never judged by an older read: it
 * shows on the next one, which that fetch asks for.
 */
function marked(repository: Repository, marks: ForcePushMarks[string] | undefined): Repository {
	const { repository: shown, stale } = withForcePushes(repository, marks);
	if (stale.length > 0) fetcher.forget(repository.path, stale);
	return shown;
}
/**
 * Watch exactly the repositories in the list. Called on start, after adding or removing one, and when the window
 * returns. One runs at a time, so an older answer never replaces a newer one.
 */
let watchSync: Promise<void> = Promise.resolve();
function watchRepositories(): Promise<void> {
	watchSync = watchSync.then(async () => {
		try {
			watchTargets = await repositories.watchTargets();
			watcher.sync(watchTargets);
			fetcher.sync(watchTargets);
		} catch (error) {
			console.warn(`Could not read which repositories to watch: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
	return watchSync;
}
void watchRepositories();

const done = createDone({ timber: () => timber.current(), findRepository: path => repositories.find(path) });
const fileChanges = createFileChanges({ findRepository: path => repositories.find(path) });
// Timber reads and writes its own settings and logins. The app never opens those files (see ./timber-settings.ts).
const timberSettings = createTimberSettings({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
// Runs Timber's settings read and keeps only the workflows. What it prints is private: never log it (see ./workflows.ts).
const workflows = createWorkflowReader({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
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
	// An agent's command comes from the saved preferences only (see ./terminals.ts).
	agents: async () => (await preferences.load()).agents,
	// `timber setup` runs the Timber that was found, never a command from the window.
	timber: () => timber.current(),
	onOutput: output => tell("terminal output", () => rpc.send.terminalOutput(output)),
	onChange: change => tell("a terminal change", () => rpc.send.terminalChanged(change)),
});

const quitGuard = createQuitGuard({
	liveCount: () => terminals.liveCount(),
	// The window answers at once whether it shows the question. One that is broken, or no longer drawn because
	// Electrobun's native side stopped it (as on SIGTERM), does not answer in time, and then the app quits.
	ask: live => rpc.request.askQuit({ live }, { maxRequestTime: 2000 }),
	endAll: () => terminals.closeAll(),
	quit: () => Utils.quit(),
});

const rpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15_000,
	handlers: {
		requests: {
			timberStatus: () => timber.current(),
			recheckTimber: () => timber.refresh(),
			listRepositories: async () => {
				const marks = fetcher.allMarks();
				return (await repositories.list()).map(repository => marked(repository, marks[repository.path]));
			},
			addRepository: async () => {
				const result = await repositories.add();
				if (result.outcome === "added") await watchRepositories();
				return result;
			},
			removeRepository: async ({ path }) => {
				const result = await repositories.remove(path);
				if (result.outcome === "removed") fetcher.remove(path);
				await watchRepositories();
				return result;
			},
			loadRepository: async ({ path }) => {
				const marks = fetcher.marks(path);
				const repository = await repositories.reload(path);
				return repository && marked(repository, marks);
			},
			// Read-only, and still only for a repository the app lists.
			listBranches: async ({ repository }) => await repositories.includes(repository) ? readBranches(repository) : null,
			// What these answer holds what the command printed, which is private: never log it.
			newWorktree: request => worktrees.create(request),
			openWorktree: request => worktrees.open(request),
			loadLayout: () => layout.load(),
			saveLayout: ({ layout: next }) => layout.save(next),
			loadPreferences: () => preferences.load(),
			savePreferences: async ({ change }) => {
				const result = await preferences.save(change);
				if (result.outcome === "saved") fetcher.configure(result.preferences.fetch);
				return result;
			},
			// Starts the editor from the saved setting only. The request names the worktree, never the command (see ./editor.ts).
			openInEditor: request => editor.open(request),
			readTimberSettings: request => timberSettings.read(request),
			// A save request can hold a login typed in Settings: never log it, or what Timber printed (see ./timber-settings.ts).
			saveTimberSettings: request => timberSettings.save(request),
			checkTimberConnection: request => timberSettings.check(request),
			// An agent's arguments can hold tokens: never log the answer.
			listWorkflows: ({ repository }) => workflows.list(repository),
			previewDone: request => done.preview(request),
			// Removes a worktree. Only ever with a preview that `previewDone` handed out (see ./done.ts).
			applyDone: request => done.apply(request),
			// Read-only Git, only in a worktree Timber lists (see ./file-changes.ts). A diff holds file contents: never log it.
			readFileChanges: request => fileChanges.read(request),
			readFileDiff: request => fileChanges.diff(request),
			listTerminals: () => terminals.list(),
			// Starts a shell, an agent from the saved Settings, or timber setup, only in a worktree Timber lists (see ./terminals.ts).
			openTerminal: request => terminals.open(request),
			readTerminal: ({ id }) => terminals.read(id),
			renameTerminal: ({ id, name }) => terminals.rename(id, name),
			closeTerminal: ({ id }) => terminals.close(id),
			confirmQuit: () => quitGuard.confirm(),
			writeClipboard: ({ text }) => Utils.clipboardWriteText(text),
			readClipboard: () => Utils.clipboardReadText(),
			// Only web links, to the person's browser, never through a shell (see ./open-link.ts).
			openLink: ({ url }) => openWebLink(url),
			fetchStatuses: async () => fetcher.statuses(),
			// Writes only remote-tracking refs, and never asks for credentials (see ./fetcher.ts).
			fetchNow: ({ repository }) => fetcher.fetchNow(repository),
		},
		messages: {
			writeTerminal: ({ id, data }) => terminals.write(id, data),
			resizeTerminal: ({ id, cols, rows }) => terminals.resize(id, cols, rows),
			terminalDrawn: ({ id, seq }) => terminals.drawn(id, seq),
			attend: attention => {
				refreshPolicy.attend(attention);
				fetcher.setVisible(attention.visible);
			},
			forcePushSeen: ({ repository, branch, at }) => {
				if (fetcher.acknowledge(repository, branch, at)) refreshPolicy.changed(repository);
			},
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
		refreshPolicy.stop();
		watcher.stop();
		// Asks a running Git to stop, so it can remove its lock files before the app goes.
		fetcher.stop();
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
