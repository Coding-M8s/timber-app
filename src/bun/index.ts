// First, before Electrobun loads: chooses how WebKitGTK draws (see webkit-rendering.ts).
import { renderingAtStart } from "./webkit-rendering-setup";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Electrobun, { BrowserView, BrowserWindow, Screen, Updater, Utils } from "electrobun/main";
import { APP_IDENTIFIER, APP_NAME, APP_VERSION } from "../shared/app-info";
import { type Attention, assumedAttention } from "../shared/attention";
import { type ForcePushMarks, withForcePushes } from "../shared/git-fetch";
import type { Repository } from "../shared/model";
import { type Preferences, defaultPreferences } from "../shared/preferences";
import { sameTimberChoice } from "../shared/timber-choice";
import { readSoundChoice } from "../shared/sound-setting";
import type { AppRPC } from "../shared/rpc";
import { availableThemes, themeStyleSheet } from "../shared/theme";
import { DEFAULT_WINDOW_FRAME, type WindowFrame, fitWindowFrame } from "../shared/window-frame";
import { repositoryChanges } from "./changes";
import { createDone } from "./done";
import { createEditorLauncher } from "./editor";
import { createGitRunner } from "./fetch-git";
import { createFetcher } from "./fetcher";
import { createSyncActions } from "./sync-actions";
import { type HandoffFolder, openHandoffFolder } from "./handoffs";
import { createSavedForcePushes } from "./force-pushes";
import { createChops } from "./chops";
import { createSavedChopApprovals } from "./chop-approvals";
import { createChopsWatcher } from "./chops-watcher";
import { createFileChanges } from "./file-changes";
import { createWorktreeFiles } from "./worktree-files";
import { createWorktreeFolders } from "./worktree-folders";
import { createPorts } from "./ports";
import { createWorktreePaths } from "./worktree-paths";
import { readBranches } from "./git-engine";
import { createSavedLayout } from "./layout";
import { createSavedPreferences } from "./preferences";
import { createIssueSearcher } from "./issue-search";
import { createIssueLister } from "./issue-lists";
import { createIssueReader } from "./issues";
import { createPullRequestReader } from "./pull-requests";
import { createRepositoryList } from "./repository-list";
import { createRepositoryReader } from "./repository-reader";
import { createSettingsHolder, settingsFilePath } from "./settings";
import { checkTimber, chooseTimber, createTimberLocator, describeTimberStatus, findBundledTimber } from "./timber";
import { atMost, createReleaseWatcher, lookUpLatestRelease, releaseFilePath, timberFinder } from "./timber-release";
import { openWebLink } from "./open-link";
import { createAppUpdates } from "./app-updates";
import { createQuitGuard } from "./quit-guard";
import { createRestarter } from "./restart";
import { createListingPace } from "./listing-pace";
import { createRecentListings } from "./recent-listings";
import { createRefreshPolicy } from "./refresh-policy";
import { type WatchTarget, createRepositoryWatcher } from "./repository-watcher";
import { createWorktreeStamps } from "./worktree-stamp";
import { createTerminalSessions } from "./terminals";
import { claudeConfigFolder, claudeConversationExists, codexConversationExists, codexHomeFolder, findCodexConversation } from "./agent-conversations";
import { createSessionLayout, sessionsFilePath } from "./session-layout";
import { createDesktopNotices } from "./desktop-notices";
import { type AlertSettings, createAlertRunner } from "../shared/status-notices";
import { sessionBusAddress } from "./dbus";
import { connectNotificationServer } from "./notification-server";
import { chooseSoundFile, createSoundPlayer } from "./sounds";
import { carryAlert } from "./alert-actions";
import { createThemeFiles } from "./theme-files";
import { themePreload } from "./theme-preload";
import { createTimberSettings } from "./timber-settings";
import { createUninstaller } from "./uninstall";
import { createWindowMemory } from "./window-memory";
import { applyWindowIcon, windowIconFile } from "./window-icon";
import { connectToastHost } from "./windows-toasts";
import { createWindowReveal } from "./window-reveal";
import { createWorktreeCommands } from "./worktree-commands";
import { createBackupCommands } from "./backups";
import { createArenaCommands } from "./arenas";
import { createRepositoryTurns } from "./repository-turns";
import { createWorkflowReader } from "./workflows";
import { createIssueTrackerReader } from "./issue-trackers";
import { messageOf } from "../shared/error-message";

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

/**
 * The newest Timber release is required (see ./timber-release.ts). It is
 * looked up on start, waiting at most two seconds before the first look for
 * Timber, so a slow network never holds the window up; the release saved by
 * an earlier run stands in meanwhile, or offline.
 */
/** How often the newest Timber release is looked up again while the app runs. */
const TIMBER_RELEASE_INTERVAL_MS = 3 * 60 * 60 * 1000;
const timberRelease = createReleaseWatcher({ file: releaseFilePath(settingsFilePath()), lookUp: () => lookUpLatestRelease() });
const releaseAtStart = timberRelease.check();

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
/*
 * Every read of a repository's worktrees is paced (see ./listing-pace.ts), and the read-only views reuse the one the
 * sidebar just read (see ./recent-listings.ts), so a background change costs one `timber ls`, not one per view.
 */
const pace = createListingPace({
	send: path => repositoryChanges.announce(path),
	resend: path => refreshPolicy.changed(path),
});
const listings = createRecentListings(createRepositoryReader(() => timber.current()), { listing: pace.listing });
const repositories = createRepositoryList({ settingsFile, settings, pickFolder, reader: listings });
const layout = createSavedLayout(settings);
/*
 * The sessions that ran when the app last quit open again (see ./session-layout.ts and docs/architecture.md, "After a
 * restart"). The file is read now, the window takes it once, and it is written only at quit. `terminals` is made
 * further down; the save only runs at quit.
 */
const sessionLayout = createSessionLayout({
	file: sessionsFilePath(settingsFile),
	running: () => terminals.running(),
	endedCodex: () => terminals.endedCodex(),
	findCodex: options => findCodexConversation({ homeFolder: codexHomeFolder(process.env, homedir()), ...options }),
	claudeExists: id => claudeConversationExists(id, claudeConfigFolder(process.env, homedir())),
});
await sessionLayout.load();
const preferences = createSavedPreferences(settings);
/*
 * Which Timber runs: the development override, else the choice in Settings, Timber, Executable, which is the one
 * bundled with the app unless changed (see ./timber.ts). Read again on every look, so a saved choice counts at once.
 */
const bundledTimber = findBundledTimber();
const timber = createTimberLocator(timberFinder({
	choose: async () => chooseTimber(process.env, (await preferences.load()).timber, bundledTimber),
	look: (candidate, required) => checkTimber(candidate, process.env, required),
	latest: () => timberRelease.latest(),
	before: atMost(releaseAtStart, 2_000),
}));
void timber.current().then(status => console.log(describeTimberStatus(status)));
const themeFiles = createThemeFiles({ pickFolder, pickFile });
// New, open, rebase, and restoring or deleting a backup run one at a time in each repository.
const turns = createRepositoryTurns();
const worktrees = createWorktreeCommands({ timber: () => timber.current(), isListed: path => repositories.includes(path), findRepository: path => repositories.find(path), turns });
// Timber's recovery backups. Names and paths are the person's own, and what Timber printed is private: never log either (see ./backups.ts).
const backups = createBackupCommands({ timber: () => timber.current(), isListed: path => repositories.includes(path), turns });
// Arenas (see ./arenas.ts). The task and what Timber printed are private: never log either. Before a pick, the
// sessions in the attempts it removes end, since Timber cannot see them; the winner's keep running.
const arenas = createArenaCommands({
	timber: () => timber.current(),
	isListed: path => repositories.includes(path),
	endSessionsIn: async paths => {
		const inThem = () => terminals.list().filter(session => paths.includes(session.path));
		await Promise.all(inThem().map(session => terminals.close(session.id)));
		return inThem().filter(session => session.state.kind === "running").map(session => session.name);
	},
	turns,
});

/*
 * Background refresh (see docs/architecture.md, "Watching for changes"). The watcher hears changes to the Git
 * metadata of every listed repository, the policy passes them on only while the window shows, and checks the
 * selected worktree for edits now and then. What they report goes out through `repositoryChanges`.
 */
let watchTargets: readonly WatchTarget[] = [];
const refreshPolicy = createRefreshPolicy({
	announce: path => pace.announce(path),
	readStamp: createWorktreeStamps({ targets: () => watchTargets }),
	onReturn: () => void watchRepositories(),
});
/** A change heard in a repository: listings read before it are not reused, and the policy decides when to tell the window. */
function heard(path: string): void {
	listings.forget(path);
	refreshPolicy.changed(path);
}
const watcher = createRepositoryWatcher({ onChange: heard });
// The chops file of each main checkout, and nothing else in it (see ./chops-watcher.ts). The window lists the chops again.
const chopsWatcher = createChopsWatcher({ onChange: repository => tell(`a change to the chops of ${repository}`, () => rpc.send.chopsChanged({ repository })) });

/*
 * Fetching (see docs/architecture.md, "Fetching"). Every repository in the list is fetched in the background on the
 * interval from the preferences, and when the person asks. A fetch writes only remote-tracking refs. What it moved
 * is reported like any other change, through the refresh policy, so a hidden window catches up when it returns.
 */
const savedForcePushes = createSavedForcePushes(settings);
const gitRunner = createGitRunner();
const fetcher = createFetcher({
	runGit: gitRunner,
	onChanged: heard,
	onStatus: status => tell("where fetching stands", () => rpc.send.fetchChanged(status)),
	marks: await savedForcePushes.load(),
	saveMarks: marks => void savedForcePushes.save(marks),
});
/*
 * Sync actions, Pull and Push (see ./sync-actions.ts), for a listed worktree, in the repository's turn. Pull's fetch
 * runs as one fetch of the fetcher's, so it never runs beside another and a force-push it brings in is marked. Push
 * runs `timber publish` while no fetch runs, since it moves a remote-tracking ref too. What Git and Timber printed is
 * private: it goes back to the window and is never logged.
 */
const syncActions = createSyncActions({
	findRepository: path => repositories.find(path),
	turns,
	runGit: gitRunner,
	fetch: (repository, args, cwd) => fetcher.fetchWith(repository, args, cwd),
	whileNotFetching: (repository, task) => fetcher.whileNotFetching(repository, task),
	timber: () => timber.current(),
});
// Nothing is fetched in the background until the preferences say whether to.
void preferences.load().then(
	saved => fetcher.configure(saved.fetch),
	error => console.warn(`Could not read whether to fetch in the background, so nothing is fetched until Fetch now: ${messageOf(error)}`),
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
			chopsWatcher.sync(watchTargets.map(target => target.path));
			fetcher.sync(watchTargets);
		} catch (error) {
			console.warn(`Could not read which repositories to watch: ${messageOf(error)}`);
		}
	});
	return watchSync;
}
void watchRepositories();

const done = createDone({ timber: () => timber.current(), findRepository: path => repositories.find(path) });
const fileChanges = createFileChanges({ findRepository: path => repositories.findRecent(path) });
const worktreeFiles = createWorktreeFiles({ findRepository: path => repositories.findRecent(path) });
// The folders the file explorer shows, each watched alone, never what is below (see ./worktree-folders.ts).
const worktreeFolders = createWorktreeFolders({
	findRepository: path => repositories.findRecent(path),
	onChange: change => tell(`a change in ${change.folder || "the folder"} of ${change.worktree}`, () => rpc.send.worktreeFolderChanged(change)),
});
// Personal chops come from the saved preferences only; the repository's are read from its main checkout's file on every request.
// A chop's text comes from that read only, never from the window; a repository chop runs once its text is approved (see ./chops.ts).
const chopApprovals = createSavedChopApprovals(settings);
const chops = createChops({
	findRepository: path => repositories.findRecent(path),
	personal: async () => (await preferences.load()).chops,
	approvals: () => chopApprovals.load(),
	approve: (repository, digest) => chopApprovals.approve(repository, digest),
	openTerminal: (request, chop) => terminals.open(request, chop),
	sendPrompt: (id, repository, worktree, text) => terminals.sendPrompt(id, repository, worktree, text),
	session: id => terminals.list().find(session => session.id === id) ?? null,
	// A prompt chop's agent comes from the saved Settings only, as any agent's does.
	agents: async () => (await preferences.load()).agents,
	// A chop's sound comes from the saved preferences only, never from the window.
	chopSounds: async () => {
		const saved = await preferences.load();
		return { play: saved.playChopSounds, file: saved.fileChopSounds };
	},
	// The alerts' player, so its rules hold: one sound at a time, at most 4 seconds. A missing file of one's own plays the chime, as an alert does.
	playSound: choice => void sounds.play(choice, { fallBackToChime: true }),
});
// Timber reads and writes its own settings and logins. The app never opens those files (see ./timber-settings.ts).
const timberSettings = createTimberSettings({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
// Runs Timber's settings read and keeps only the workflows. What it prints is private: never log it (see ./workflows.ts).
const workflows = createWorkflowReader({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
// Timber's settings read (which checks the list), then the remote's URL. It says whether a login applies, never what it is.
const issueTrackers = createIssueTrackerReader({ readSettings: request => timberSettings.read(request) });
// Runs Timber's pull request read, with Timber's own GitHub login. Nothing it prints is logged (see ./pull-requests.ts).
const pullRequests = createPullRequestReader({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
const issues = createIssueReader({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
const issueSearch = createIssueSearcher({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
const issueLists = createIssueLister({ timber: () => timber.current(), isListed: path => repositories.includes(path) });
const editor = createEditorLauncher({ preferences: () => preferences.load(), findRepository: path => repositories.find(path) });

/** Report to the window. It may not be connected yet, or be reloading; its first load reads everything anyway. */
function tell(what: string, send: () => void): void {
	try {
		send();
	} catch (error) {
		console.warn(`Could not report ${what} to the window: ${messageOf(error)}`);
	}
}

/*
 * A session whose status moves to Needs you, Done, Error, or crashed gets a desktop notification and a sound, as
 * Settings choose, when its worktree is not on screen in a focused window (see ../shared/status-notices.ts). A click
 * brings the window forward and shows it. A notification that no longer holds is withdrawn.
 */
let attention: Attention = assumedAttention;
/** Where notifications and sounds look for programs. On Windows the variable may be named `Path`, as Electrobun starts the app. */
const searchPath = process.env.PATH ?? process.env.Path ?? "";
/** Windows: start the toast script with Windows PowerShell, for the app's identifier and the icon the build ships. */
async function connectWindowsToasts() {
	const warn = (message: string) => console.warn(`Windows notifications: ${message}`);
	try {
		const powershell = Bun.which("powershell.exe", { PATH: searchPath });
		if (powershell === null) throw new Error("Windows PowerShell was not found");
		const icon = windowIconFile(process.execPath);
		return await connectToastHost({ powershell, aumid: APP_IDENTIFIER, displayName: APP_NAME, iconFile: existsSync(icon) ? icon : null, onProblem: warn });
	} catch (error) {
		// Electrobun shows the notification instead; this is said at most once a minute (see ./desktop-notices.ts).
		warn(`${messageOf(error)}. Using Electrobun's notification instead.`);
		throw error;
	}
}
const desktopNotices = createDesktopNotices({
	path: searchPath,
	connect: () => (process.platform === "win32" ? connectWindowsToasts() : connectNotificationServer(sessionBusAddress(process.env))),
	fallback: notice => {
		try {
			Utils.showNotification({ title: notice.title, body: notice.body });
		} catch (error) {
			console.warn(`Could not show a notification: ${messageOf(error)}`);
		}
	},
	// The activation token is not handed on: the window is an X11 one under XWayland (see docs/architecture.md).
	onClick: id => {
		try {
			mainWindow.activate();
		} catch {
			// The session is still shown when the window cannot come forward.
		}
		tell("a session to show", () => rpc.send.showSession({ id }));
	},
});
// Sounds play here, not in the window, so they play while it is hidden. The sounds that come with the app are written
// to the cache folder the first time they play.
const sounds = createSoundPlayer({ path: searchPath, cacheFolder: join(Utils.paths.userCache, "sounds") });

/** The saved settings, kept here so each change is decided at once, in the order the changes came. Read on start and after each save. */
let alertSettings: AlertSettings = settingsForAlerts(defaultPreferences());
function settingsForAlerts(saved: Preferences): AlertSettings {
	return { notify: saved.statusNotifications, notifyStates: saved.notifyStates, sounds: saved.sounds };
}
const alerts = createAlertRunner({
	attention: () => attention,
	settings: () => alertSettings,
	act: action => carryAlert(action, desktopNotices, sounds),
});
function applyAlertPreferences(saved: Preferences): void {
	alertSettings = settingsForAlerts(saved);
	alerts.review();
}
void preferences.load().then(applyAlertPreferences, () => {
	// The defaults stay: notifications on, no sound.
});

// Where `timber new` typed in one of the app's terminals hands over the worktree it created (see ./handoffs.ts).
// Each record goes to the window, which opens a session only in a worktree the app lists.
let handoffFolder: HandoffFolder | null = null;
let quitting = false;
const handoffReady: Promise<string | null> = openHandoffFolder({
	parent: process.env.XDG_RUNTIME_DIR || tmpdir(),
	onHandoff: handoff => tell("a handed-off worktree", () => rpc.send.worktreeHandedOff(handoff)),
	onProblem: message => console.warn(message),
}).then(folder => {
	handoffFolder = folder;
	// Made while the app was quitting: nothing will use it.
	if (quitting) folder.close();
	return folder.path;
}, error => {
	console.warn(`Could not make the handoff folder, so timber new in a terminal stays in that terminal: ${messageOf(error)}`);
	return null;
});

// What a terminal prints is private, like what a command prints: it goes to the window and is never logged.
const terminals = createTerminalSessions({
	handoffFolder: () => handoffReady,
	findRepository: path => repositories.find(path),
	// An agent's command comes from the saved preferences only (see ./terminals.ts).
	agents: async () => (await preferences.load()).agents,
	sessionNaming: async () => (await preferences.load()).sessionNames,
	// `timber rebase` runs the Timber that was found, never a command from the window.
	timber: () => timber.current(),
	// An arena attempt's command comes from Timber only (see ./arenas.ts).
	arenaLaunch: request => arenas.launch(request),
	// A workflow's agent comes from Timber's settings as read now, never from the window. Never log it (see ./workflows.ts).
	workflows: repository => workflows.list(repository),
	// An agent goes back to its own conversation only when that is still in the agent's own folder. Nothing there is written.
	conversations: {
		claudeExists: id => claudeConversationExists(id, claudeConfigFolder(process.env, homedir())),
		codexExists: id => codexConversationExists(id, codexHomeFolder(process.env, homedir())),
		newId: () => crypto.randomUUID(),
	},
	onOutput: output => tell("terminal output", () => rpc.send.terminalOutput(output)),
	onChange: change => {
		tell("a terminal change", () => rpc.send.terminalChanged(change));
		alerts.changed(change);
	},
});// Ports are read for the selected worktree on request only, never on a timer (see ./ports.ts).
const ports = createPorts({ listWorktrees: createWorktreePaths({ targets: () => watchTargets }), leaders: () => terminals.leaders(), attention: () => attention });


// Files with unsaved edits in the File tab, as the window last said. Quitting asks while there are any.
let unsavedFiles = 0;
const quitGuard = createQuitGuard({
	liveCount: () => terminals.liveCount(),
	unsavedCount: () => unsavedFiles,
	// The window answers at once whether it shows the question. One that is broken, or no longer drawn because
	// Electrobun's native side stopped it (as on SIGTERM), does not answer in time, and then the app quits.
	ask: live => rpc.request.askQuit({ live }, { maxRequestTime: 2000 }),
	endAll: () => terminals.closeAll(),
	quit: () => Utils.quit(),
	// Which sessions run is saved before they end, so they open again on the next launch.
	save: () => sessionLayout.save(),
	resume: () => sessionLayout.resume(),
});

// Runs the uninstaller the installer left beside the app, and nothing else (see ./uninstall.ts).
const uninstaller = createUninstaller({
	settingsFolder: dirname(settingsFile),
	// The sessions file goes first: the settings folder is removed only when nothing else is in it.
	forgetSettings: async () => {
		sessionLayout.discard();
		await settings.discard();
	},
	// The person agreed to quit when they agreed to uninstall, so the terminals end without another question.
	quit: () => void quitGuard.confirm(),
});

// Starts the app again once it is gone, then quits (see ./restart.ts). The window asked first while terminals run.
const restarter = createRestarter({ quit: () => quitGuard.confirm() });

/*
 * Updating the app from its GitHub releases (see ./app-updates.ts). Electrobun's applyUpdate asks before quitting like
 * any quit, starts the swap, and quits; it says how that went only in its status history.
 */
const appUpdates = createAppUpdates({
	updater: {
		localBuild: async () => {
			const info = await Updater.getLocalInfo();
			return { channel: info.channel, baseUrl: info.baseUrl };
		},
		check: () => Updater.checkForUpdate(),
		download: () => Updater.downloadUpdate(),
		latest: () => Updater.updateInfo(),
		apply: async () => {
			await Updater.applyUpdate();
			return Updater.getStatusHistory().at(-1)?.status === "launching-new-version";
		},
	},
	liveCount: () => terminals.liveCount(),
	// The person agreed, so the sessions are saved and end without another question, as for a restart.
	restartInto: apply => quitGuard.confirmWith(apply),
	onChange: state => tell("the app update", () => rpc.send.appUpdateChanged(state)),
});

const rpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15_000,
	handlers: {
		requests: {
			appInfo: () => ({ version: APP_VERSION, rendering: renderingAtStart }),
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
			// Grouping only changes the settings file: the set of repositories stays, so nothing is watched or fetched anew.
			listRepositoryGroups: () => repositories.listGroups(),
			createRepositoryGroup: ({ name, repository, parent }) => repositories.createGroup(name, repository ?? undefined, parent ?? undefined),
			renameRepositoryGroup: ({ id, name }) => repositories.renameGroup(id, name),
			deleteRepositoryGroup: ({ id }) => repositories.deleteGroup(id),
			moveRepositoryGroup: ({ id, parent, before }) => repositories.moveGroup(id, parent, before),
			placeRepository: ({ path, group, order }) => repositories.place(path, group, order ?? undefined),
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
			runSyncAction: request => syncActions.run(request),
			setWorktreeBase: request => worktrees.setBase(request),
			createPullRequest: request => worktrees.pullRequest(request),
			// Read-only Git, and only for a worktree Timber lists in a repository the app lists.
			readHeadSubject: request => worktrees.headSubject(request),
			loadLayout: () => layout.load(),
			saveLayout: ({ layout: next }) => layout.save(next),
			loadPreferences: () => preferences.load(),
			savePreferences: async ({ change }) => {
				const before = await preferences.load();
				const result = await preferences.save(change);
				if (result.outcome === "saved") {
					if (!sameTimberChoice(before.timber, result.preferences.timber)) void lookForTimberAgain();
					fetcher.configure(result.preferences.fetch);
					applyZoom(result.preferences.zoom);
					applyAlertPreferences(result.preferences);
				}
				return result;
			},
			exportTheme: ({ theme }) => themeFiles.exportTheme(theme),
			importTheme: () => themeFiles.importTheme(),
			// Answers the path the person picked, which is private: never log it.
			chooseSoundFile: () => chooseSoundFile(pickFile),
			// A preview from Settings. A custom path is checked again before it plays (see ./sounds.ts).
			playSound: ({ choice }) => {
				const read = readSoundChoice(choice);
				return read === undefined ? Promise.resolve({ outcome: "missing" as const }) : sounds.play(read);
			},
			// Starts the editor from the saved setting only. The request names the worktree, never the command (see ./editor.ts).
			openInEditor: request => editor.open(request),
			readTimberSettings: request => timberSettings.read(request),
			// A save request can hold a login typed in Settings: never log it, or what Timber printed (see ./timber-settings.ts).
			saveTimberSettings: request => timberSettings.save(request),
			checkTimberConnection: request => timberSettings.check(request),
			// An agent's arguments can hold tokens: never log the answer.
			listWorkflows: ({ repository }) => workflows.list(repository),
			readIssueTrackers: ({ repository }) => issueTrackers.read(repository),
			readPullRequests: ({ repository }) => pullRequests.read(repository),
			readIssue: request => issues.read(request),
			searchIssues: request => issueSearch.search(request),
			// Read-only: Timber lists issues with its own login and changes nothing (see ./issue-lists.ts).
			listIssues: request => issueLists.list(request),
			readBackups: ({ repository }) => backups.list(repository),
			// Restores into a new folder and branch; Timber never changes the backup or its source (see ./backups.ts).
			restoreBackup: request => backups.restore(request),
			// Deletes one backup, only as the person confirmed it: Timber checks its digest first.
			deleteBackup: request => backups.remove(request),
			listArenas: ({ repository }) => arenas.list(repository),
			// Only names and tools leave the main process, never a preset's command (see ./arenas.ts).
			listArenaPresets: ({ repository }) => arenas.presets(repository),
			inspectArena: request => arenas.inspect(request),
			// The request holds the task: never log it (see ./arenas.ts).
			newArena: request => arenas.create(request),
			// Removes the attempts other than the winner, only while no session of the app runs in one (see ./arenas.ts).
			pickArena: request => arenas.pick(request),
			previewDone: request => done.preview(request),
			// Removes a worktree. Only ever with a preview that `previewDone` handed out (see ./done.ts).
			applyDone: request => done.apply(request),
			// Read-only Git, only in a worktree Timber lists (see ./file-changes.ts). A diff holds file contents: never log it.
			readFileChanges: request => fileChanges.read(request),
			readFileDiff: request => fileChanges.diff(request),
			// Reads one file, only inside a worktree Timber lists, links included (see ./worktree-files.ts). It holds file contents: never log it.
			readWorktreeFile: request => worktreeFiles.read(request),
			// Writes only that file, in place, and only a file that is there (see ./worktree-files.ts). It holds file contents: never log it.
			writeWorktreeFile: request => worktreeFiles.write(request),
			// Lists one folder, only inside a worktree Timber lists, never following a link (see ./worktree-folders.ts). Git runs only to ask what it ignores.
			listWorktreeFolder: request => worktreeFolders.list(request),
			// Read-only Docker and process table, only in a worktree Timber lists, never while the window is hidden (see ./ports.ts).
			readPorts: request => ports.read(request),
			listChops: request => chops.list(request),
			// Starts the person's shell with a chop's text typed in, the text read here, never sent by the window (see ./chops.ts).
			runChop: request => chops.run(request),
			listTerminals: () => terminals.list(),
			// Answered once per run, so a reloaded window opens nothing twice. Each is opened with openTerminal, which checks it.
			takeSavedSessions: () => sessionLayout.take(),
			// Starts a shell, an agent from the saved Settings, or timber rebase, only in a worktree Timber lists (see ./terminals.ts).
			forgetSavedSessions: ({ worktrees }) => sessionLayout.forget(worktrees),
			async openTerminal(request) {
				// What came of opening a saved session again tells the quit save whether to keep the saved one.
				try {
					const result = await terminals.open(request);
					sessionLayout.restored(request.restore, result.outcome);
					return result;
				} catch (error) {
					sessionLayout.restored(request.restore, "failed");
					throw error;
				}
			},
			readTerminal: ({ id }) => terminals.read(id),
			renameTerminal: ({ id, name }) => terminals.rename(id, name),
			closeTerminal: ({ id }) => terminals.close(id),
			confirmQuit: async () => {
				await quitGuard.confirm();
			},
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
			restartPlan: () => restarter.plan(),
			// Quits, ending every terminal without asking again, and starts the same app again (see ./restart.ts).
			restart: () => restarter.restart(),
			appUpdate: () => appUpdates.current(),
			// Answers at once; the download that may follow is told through appUpdateChanged.
			checkForAppUpdate: () => {
				void appUpdates.check();
				return appUpdates.current();
			},
			// Restarts only when asked, and while sessions run only once the person agreed (see ./app-updates.ts).
			installAppUpdate: request => appUpdates.install(request),
			// Writes only the session's input, as one bracketed paste (see ./terminals.ts).
			pasteTerminal: async ({ id, text }) => terminals.paste(id, text),
		},
		messages: {
			writeTerminal: ({ id, data }) => terminals.write(id, data),
			resizeTerminal: ({ id, cols, rows }) => terminals.resize(id, cols, rows),
			terminalDrawn: ({ id, seq }) => terminals.drawn(id, seq),
			attend: next => {
				attention = next;
				// The selected worktree and its shown chip, for the save at quit.
				sessionLayout.attend(next);
				alerts.review();
				refreshPolicy.attend(next);
				fetcher.setVisible(next.visible);
			},
			windowReady: () => windowReveal.ready(),
			watchWorktreeFolders: ({ folders }) => void worktreeFolders.watch(folders),
			unsavedFiles: ({ count }) => {
				unsavedFiles = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
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
// Quitting while terminals run waits for the person (see ./quit-guard.ts). When it goes ahead, the open sessions are saved,
// then every session ends with it.
// SIGINT and SIGTERM arrive here as the same request: the app's code runs in a Worker, where signal listeners never run,
// and Electrobun's native side turns the signal into a quit request. So they ask too.
function guardQuit(event: unknown): void {
	if (quitGuard.mayQuit()) {
		// Saved before anything ends. After an agreed quit this was done already and does nothing; with nothing running it
		// writes the empty layout, so closed sessions stay closed.
		sessionLayout.save();
		// The app goes away in a moment, so there is no time to wait for anything to end by itself.
		terminals.killAll();
		alerts.stop();
		void desktopNotices.stopAll();
		sounds.stopAll();
		refreshPolicy.stop();
		pace.stop();
		watcher.stop();
		chopsWatcher.stop();
		worktreeFolders.close();
		quitting = true;
		handoffFolder?.close();
		// Asks a running Git to stop, so it can remove its lock files before the app goes.
		fetcher.stop();
		// A resize from just before quitting is still waiting to be saved.
		void windowMemory.flush();
		return;
	}
	(event as Veto).response = { allow: false };
}
/**
 * A different newest Timber release, or another Timber chosen in Settings: look for Timber again, and tell the
 * window, which asks for the new answer.
 */
async function lookForTimberAgain(): Promise<void> {
	console.log(describeTimberStatus(await timber.refresh()));
	tell("the Timber status", () => rpc.send.timberChanged({}));
}
const checkTimberRelease = (check: Promise<boolean>) => void check.then(changed => changed ? lookForTimberAgain() : undefined);
checkTimberRelease(releaseAtStart);
setInterval(() => checkTimberRelease(timberRelease.check()), TIMBER_RELEASE_INTERVAL_MS);

/*
 * A newer release of the app is looked for a little after start, so it never competes with the first listing, and
 * then every six hours. A look that fails, for example offline, only says so in Settings, About.
 */
const APP_UPDATE_FIRST_LOOK_MS = 30_000;
const APP_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
setTimeout(() => void appUpdates.check(), APP_UPDATE_FIRST_LOOK_MS);
setInterval(() => void appUpdates.check(), APP_UPDATE_INTERVAL_MS);

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
	// Files dropped on the window never open in it, even when WebKitGTK goes to one whatever the page does,
	// as with a drop of several files on Linux; the interface pastes their paths instead (src/mainview/path-drop.ts).
	navigationRules: JSON.stringify(["^file://*"]),
});
applyWindowIcon(mainWindow.ptr);
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
		console.warn(`Could not set the zoom: ${messageOf(error)}`);
	}
}
applyZoom(startingPreferences.zoom);
// Closing the last window quits the app, so it asks the same question first.
mainWindow.on("will-close", event => {
	if (!quitGuard.mayQuit()) (event as Veto).response = { allow: false };
});
