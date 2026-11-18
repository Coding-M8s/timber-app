import { homedir } from "node:os";
import { dirname } from "node:path";
import Electrobun, { BrowserView, BrowserWindow, Screen, Updater, Utils } from "electrobun/main";
import { APP_NAME, APP_VERSION } from "../shared/app-info";
import { type Attention, assumedAttention } from "../shared/attention";
import { type ForcePushMarks, withForcePushes } from "../shared/git-fetch";
import type { Repository } from "../shared/model";
import { defaultPreferences } from "../shared/preferences";
import type { AppRPC } from "../shared/rpc";
import { availableThemes, themeStyleSheet } from "../shared/theme";
import { DEFAULT_WINDOW_FRAME, type WindowFrame, fitWindowFrame } from "../shared/window-frame";
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
import { createPullRequestReader } from "./pull-requests";
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
import { createDesktopNotices } from "./desktop-notices";
import { createStatusNotices } from "../shared/status-notices";
import { createThemeFiles } from "./theme-files";
import { themePreload } from "./theme-preload";
import { createTimberSettings } from "./timber-settings";
import { createUninstaller } from "./uninstall";
import { createWindowMemory } from "./window-memory";
import { createWindowReveal } from "./window-reveal";
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

/** The native file picker, for one file. Null when it was closed without a choice. */
async function pickFile(): Promise<string | null> {
	const [file] = await Utils.openFileDialog({
		startingFolder: homedir(),
		canChooseFiles: true,
		canChooseDirectory: false,
		allowsMultipleSelection: false,
	});
	return file || null;
}

const settingsFile = settingsFilePath();
console.log(`Settings at ${settingsFile}`);
// One holder for the file, so the repository list and the layout cannot save over each other.
const settings = createSettingsHolder(settingsFile);
const repositories = createRepositoryList({ settingsFile, settings, pickFolder, reader: createRepositoryReader(() => timber.current()) });
const layout = createSavedLayout(settings);
const preferences = createSavedPreferences(settings);
const themeFiles = createThemeFiles({ pickFolder, pickFile });
const worktrees = createWorktreeCommands({ timber: () => timber.current(), isListed: path => repositories.includes(path), findRepository: path => repositories.find(path) });

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
// Runs Timber's pull request read, with Timber's own GitHub login. Nothing it prints is logged (see ./pull-requests.ts).
const pullRequests = createPullRequestReader({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
const editor = createEditorLauncher({ preferences: () => preferences.load(), findRepository: path => repositories.find(path) });

/** Report to the window. It may not be connected yet, or be reloading; its first load reads everything anyway. */
function tell(what: string, send: () => void): void {
	try {
		send();
	} catch (error) {
		console.warn(`Could not report ${what} to the window: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/*
 * A session whose status moves to Needs you, Done, Error, or crashed gets a desktop notification when its worktree is
 * not on screen in a focused window (see ../shared/status-notices.ts). A click brings the window forward and shows it.
 */
let attention: Attention = assumedAttention;
const statusNotices = createStatusNotices();
const desktopNotices = createDesktopNotices({
	path: process.env.PATH ?? "",
	fallback: notice => {
		try {
			Utils.showNotification({ title: notice.title, body: notice.body });
		} catch (error) {
			console.warn(`Could not show a notification: ${error instanceof Error ? error.message : String(error)}`);
		}
	},
	onClick: id => {
		try {
			mainWindow.activate();
		} catch {
			// The session is still shown when the window cannot come forward.
		}
		tell("a session to show", () => rpc.send.showSession({ id }));
	},
});

/** The saved setting, kept here so each change is decided at once, in the order the changes came. Read on start and after each save. */
let notificationsEnabled = true;
void preferences.load().then(saved => {
	notificationsEnabled = saved.statusNotifications;
}, () => {
	// The default stays: on.
});

function weighNotice(change: Parameters<typeof statusNotices.changed>[0]): void {
	const notice = statusNotices.changed(change, attention, notificationsEnabled, Date.now());
	if (notice !== null) desktopNotices.show(notice);
}

// What a terminal prints is private, like what a command prints: it goes to the window and is never logged.
const terminals = createTerminalSessions({
	findRepository: path => repositories.find(path),
	// An agent's command comes from the saved preferences only (see ./terminals.ts).
	agents: async () => (await preferences.load()).agents,
	// `timber rebase` runs the Timber that was found, never a command from the window.
	timber: () => timber.current(),
	onOutput: output => tell("terminal output", () => rpc.send.terminalOutput(output)),
	onChange: change => {
		tell("a terminal change", () => rpc.send.terminalChanged(change));
		weighNotice(change);
	},
});

const quitGuard = createQuitGuard({
	liveCount: () => terminals.liveCount(),
	// The window answers at once whether it shows the question. One that is broken, or no longer drawn because
	// Electrobun's native side stopped it (as on SIGTERM), does not answer in time, and then the app quits.
	ask: live => rpc.request.askQuit({ live }, { maxRequestTime: 2000 }),
	endAll: () => terminals.closeAll(),
	quit: () => Utils.quit(),
});

// Runs the uninstaller the installer left beside the app, and nothing else (see ./uninstall.ts).
const uninstaller = createUninstaller({
	settingsFolder: dirname(settingsFile),
	forgetSettings: () => settings.discard(),
	// The person agreed to quit when they agreed to uninstall, so the terminals end without another question.
	quit: () => void quitGuard.confirm(),
});

const rpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15_000,
	handlers: {
		requests: {
			appInfo: () => ({ version: APP_VERSION }),
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
			reorderRepositories: ({ order }) => repositories.reorder(order),
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
			rebaseWorktree: request => worktrees.rebase(request),
			loadLayout: () => layout.load(),
			saveLayout: ({ layout: next }) => layout.save(next),
			loadPreferences: () => preferences.load(),
			savePreferences: async ({ change }) => {
				const result = await preferences.save(change);
				if (result.outcome === "saved") {
					fetcher.configure(result.preferences.fetch);
					applyZoom(result.preferences.zoom);
					notificationsEnabled = result.preferences.statusNotifications;
				}
				return result;
			},
			exportTheme: ({ theme }) => themeFiles.exportTheme(theme),
			importTheme: () => themeFiles.importTheme(),
			// Starts the editor from the saved setting only. The request names the worktree, never the command (see ./editor.ts).
			openInEditor: request => editor.open(request),
			readTimberSettings: request => timberSettings.read(request),
			// A save request can hold a login typed in Settings: never log it, or what Timber printed (see ./timber-settings.ts).
			saveTimberSettings: request => timberSettings.save(request),
			checkTimberConnection: request => timberSettings.check(request),
			// An agent's arguments can hold tokens: never log the answer.
			listWorkflows: ({ repository }) => workflows.list(repository),
			readPullRequests: ({ repository }) => pullRequests.read(repository),
			previewDone: request => done.preview(request),
			// Removes a worktree. Only ever with a preview that `previewDone` handed out (see ./done.ts).
			applyDone: request => done.apply(request),
			// Read-only Git, only in a worktree Timber lists (see ./file-changes.ts). A diff holds file contents: never log it.
			readFileChanges: request => fileChanges.read(request),
			readFileDiff: request => fileChanges.diff(request),
			listTerminals: () => terminals.list(),
			// Starts a shell, an agent from the saved Settings, or timber rebase, only in a worktree Timber lists (see ./terminals.ts).
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
			uninstallPlan: () => uninstaller.plan(),
			// Removes the app, and its settings only when asked. Then the app quits (see ./uninstall.ts).
			uninstall: request => uninstaller.uninstall(request),
		},
		messages: {
			writeTerminal: ({ id, data }) => terminals.write(id, data),
			resizeTerminal: ({ id, cols, rows }) => terminals.resize(id, cols, rows),
			terminalDrawn: ({ id, seq }) => terminals.drawn(id, seq),
			attend: next => {
				attention = next;
				refreshPolicy.attend(next);
				fetcher.setVisible(next.visible);
			},
			windowReady: () => windowReveal.ready(),
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
		desktopNotices.stopAll();
		refreshPolicy.stop();
		watcher.stop();
		// Asks a running Git to stop, so it can remove its lock files before the app goes.
		fetcher.stop();
		// A resize from just before quitting is still waiting to be saved.
		void windowMemory.flush();
		return;
	}
	(event as Veto).response = { allow: false };
}
Electrobun.events.on("before-quit", guardQuit);

/** The usable area of each display, the primary one first. Empty when the displays cannot be read. */
function displayAreas(): WindowFrame[] {
	try {
		const displays = [...Screen.getAllDisplays()].sort((one, other) => Number(other.isPrimary) - Number(one.isPrimary));
		return displays.map(display => display.workArea.width > 0 && display.workArea.height > 0 ? display.workArea : display.bounds);
	} catch {
		return [];
	}
}

/*
 * The window opens where it was and as large as it was (see docs/architecture.md, "The saved window"). It is read
 * again once it has been still after a move or a resize, and that is saved.
 */
const windowMemory = createWindowMemory({
	settings,
	read: () => ({ frame: mainWindow.getFrame(), maximized: mainWindow.isMaximized(), fullScreen: mainWindow.isFullScreen() }),
});
const savedWindow = await windowMemory.load();

/* The saved theme is on the page before it is first drawn (see docs/architecture.md, "Themes"). */
const startingPreferences = await preferences.load().catch(() => defaultPreferences());

const mainWindow = new BrowserWindow({
	title: APP_NAME,
	url: await mainViewUrl(),
	preload: themePreload(themeStyleSheet(startingPreferences.theme, availableThemes(startingPreferences.customThemes))),
	// Shown once the interface has drawn itself in the saved theme (see ./window-reveal.ts).
	hidden: true,
	frame: fitWindowFrame(savedWindow?.frame ?? DEFAULT_WINDOW_FRAME, displayAreas()),
	rpc,
});
if (savedWindow?.maximized) mainWindow.maximize();
const windowReveal = createWindowReveal(by => {
	mainWindow.show();
	if (by === "fallback") console.warn("The interface did not say it was drawn, so the window was shown anyway.");
});
mainWindow.on("resize", () => windowMemory.changed());
mainWindow.on("move", () => windowMemory.changed());

/** Draw the interface at this zoom (see docs/architecture.md, "Interface zoom"). The window stays usable when it fails. */
function applyZoom(zoom: number): void {
	try {
		mainWindow.setPageZoom(zoom);
	} catch (error) {
		console.warn(`Could not set the zoom: ${error instanceof Error ? error.message : String(error)}`);
	}
}
applyZoom(startingPreferences.zoom);
// Closing the last window quits the app, so it asks the same question first.
mainWindow.on("will-close", event => {
	if (!quitGuard.mayQuit()) (event as Veto).response = { allow: false };
});
