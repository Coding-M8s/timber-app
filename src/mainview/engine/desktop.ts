import type { WorktreeHandoff } from "../../shared/handoff";
import { Electroview } from "electrobun/view";
import type { Engine } from "../../shared/engine";
import type { AppUpdateState } from "../../shared/app-update";
import type { RepositoryFetch } from "../../shared/git-fetch";
import type { AppRPC } from "../../shared/rpc";
import type { TerminalChange, TerminalOutput } from "../../shared/terminal";
import type { WorktreeFolderChange } from "../../shared/worktree-folders";

/** A set of listeners, and the function that adds one and returns how to take it away. */
function listeners<Value>() {
	const all = new Set<(value: Value) => void>();
	return {
		call: (value: Value) => {
			for (const listener of [...all]) listener(value);
		},
		size: () => all.size,
		add: (listener: (value: Value) => void) => {
			all.add(listener);
			return () => void all.delete(listener);
		},
	};
}

/** The real engine: every call crosses the typed bridge to the Bun main process. */
export function createDesktopEngine(): Engine {
	const changes = listeners<string>();
	const terminalOutput = listeners<TerminalOutput>();
	const terminalChanges = listeners<TerminalChange>();
	const quitRequests = listeners<number>();
	const fetches = listeners<RepositoryFetch>();
	const timberChanges = listeners<void>();
	const appUpdates = listeners<AppUpdateState>();
	const shownSessions = listeners<string>();
	const handoffs = listeners<WorktreeHandoff>();
	const chopChanges = listeners<string>();
	const folderChanges = listeners<WorktreeFolderChange>();
	const rpc = Electroview.defineRPC<AppRPC>({
		maxRequestTime: 15_000,
		handlers: {
			requests: {
				// The question shows only when the interface listens. Without it, nobody can be asked, and the app quits.
				askQuit: ({ live }) => {
					if (quitRequests.size() === 0) return false;
					quitRequests.call(live);
					return true;
				},
			},
			messages: {
				repositoryChanged: ({ path }) => changes.call(path),
				chopsChanged: ({ repository }) => chopChanges.call(repository),
				worktreeFolderChanged: change => folderChanges.call(change),
				terminalOutput: output => terminalOutput.call(output),
				terminalChanged: change => terminalChanges.call(change),
				showSession: ({ id }) => shownSessions.call(id),
				worktreeHandedOff: handoff => handoffs.call(handoff),
				fetchChanged: status => fetches.call(status),
				timberChanged: () => timberChanges.call(),
				appUpdateChanged: state => appUpdates.call(state),
			},
		},
	});
	new Electroview({ rpc });
	return {
		appInfo: () => rpc.request.appInfo({}),
		timberStatus: () => rpc.request.timberStatus({}),
		recheckTimber: () => rpc.request.recheckTimber({}),
		onTimberChanged: timberChanges.add,
		listRepositories: () => rpc.request.listRepositories({}),
		// The folder picker stays open for as long as the person likes.
		addRepository: () => rpc.request.addRepository({}, { maxRequestTime: Infinity }),
		removeRepository: path => rpc.request.removeRepository({ path }),
		reorderRepositories: order => rpc.request.reorderRepositories({ order }),
		listRepositoryGroups: () => rpc.request.listRepositoryGroups({}),
		createRepositoryGroup: (name, repository) => rpc.request.createRepositoryGroup({ name, repository: repository ?? null }),
		renameRepositoryGroup: (id, name) => rpc.request.renameRepositoryGroup({ id, name }),
		deleteRepositoryGroup: id => rpc.request.deleteRepositoryGroup({ id }),
		reorderRepositoryGroups: order => rpc.request.reorderRepositoryGroups({ order }),
		placeRepository: (path, group, order) => rpc.request.placeRepository({ path, group, order: order ?? null }),
		loadRepository: path => rpc.request.loadRepository({ path }),
		listBranches: repository => rpc.request.listBranches({ repository }),
		// Setup scripts take as long as they take.
		newWorktree: request => rpc.request.newWorktree(request, { maxRequestTime: Infinity }),
		openWorktree: request => rpc.request.openWorktree(request, { maxRequestTime: Infinity }),
		// A fetch and Git hooks take as long as they take.
		rebaseWorktree: request => rpc.request.rebaseWorktree(request, { maxRequestTime: Infinity }),
		// A fetch, a fast-forward, and Git hooks take as long as they take.
		runSyncAction: request => rpc.request.runSyncAction(request, { maxRequestTime: Infinity }),
		setWorktreeBase: request => rpc.request.setWorktreeBase(request, { maxRequestTime: Infinity }),
		// A push and GitHub take as long as they take. Timber stops each GitHub request after ten seconds.
		createPullRequest: request => rpc.request.createPullRequest(request, { maxRequestTime: Infinity }),
		readHeadSubject: request => rpc.request.readHeadSubject(request),
		// The main process reads the list first, and stops a stuck preview after 30 seconds.
		previewDone: request => rpc.request.previewDone(request, { maxRequestTime: 60_000 }),
		// Scripts that run before deletion take as long as they take.
		applyDone: request => rpc.request.applyDone(request, { maxRequestTime: Infinity }),
		onRepositoryChanged: changes.add,
		attend: attention => rpc.send.attend(attention),
		windowReady: () => rpc.send.windowReady({}),
		reportUnsavedFiles: count => rpc.send.unsavedFiles({ count }),
		fetchStatuses: () => rpc.request.fetchStatuses({}),
		// A large fetch takes as long as it takes; the main process stops one after ten minutes.
		fetchNow: repository => rpc.request.fetchNow({ repository }, { maxRequestTime: Infinity }),
		onFetchChanged: fetches.add,
		forcePushSeen: seen => rpc.send.forcePushSeen(seen),
		loadLayout: () => rpc.request.loadLayout({}),
		saveLayout: layout => rpc.request.saveLayout({ layout }),
		loadPreferences: () => rpc.request.loadPreferences({}),
		savePreferences: change => rpc.request.savePreferences({ change }),
		// Both wait for the person to pick in a file dialog.
		exportTheme: theme => rpc.request.exportTheme({ theme }, { maxRequestTime: Infinity }),
		importTheme: () => rpc.request.importTheme({}, { maxRequestTime: Infinity }),
		// The person may take their time in the file dialog.
		chooseSoundFile: () => rpc.request.chooseSoundFile({}, { maxRequestTime: Infinity }),
		playSound: choice => rpc.request.playSound({ choice }),
		// The main process reads the list first, and waits a moment to hear whether the editor stopped right away.
		openInEditor: request => rpc.request.openInEditor(request, { maxRequestTime: 60_000 }),
		// The main process stops a stuck read after 30 seconds.
		readTimberSettings: request => rpc.request.readTimberSettings(request, { maxRequestTime: 60_000 }),
		// Timber may wait on its lock, so a save takes as long as it takes.
		saveTimberSettings: request => rpc.request.saveTimberSettings(request, { maxRequestTime: Infinity }),
		// The main process stops a stuck check after 30 seconds.
		checkTimberConnection: request => rpc.request.checkTimberConnection(request, { maxRequestTime: 60_000 }),
		listWorkflows: repository => rpc.request.listWorkflows({ repository }),
		// The main process stops Timber after 30 seconds and Git after 10.
		readIssueTrackers: repository => rpc.request.readIssueTrackers({ repository }, { maxRequestTime: 60_000 }),
		// The main process stops a stuck read after 30 seconds.
		readPullRequests: repository => rpc.request.readPullRequests({ repository }, { maxRequestTime: 60_000 }),
		readIssue: request => rpc.request.readIssue(request, { maxRequestTime: 60_000 }),
		searchIssues: request => rpc.request.searchIssues(request, { maxRequestTime: 60_000 }),
		listIssues: request => rpc.request.listIssues(request, { maxRequestTime: 60_000 }),
		// The main process stops a stuck list after 30 seconds.
		readBackups: repository => rpc.request.readBackups({ repository }, { maxRequestTime: 60_000 }),
		// Copying every file back, and deleting, take as long as they take.
		restoreBackup: request => rpc.request.restoreBackup(request, { maxRequestTime: Infinity }),
		deleteBackup: request => rpc.request.deleteBackup(request, { maxRequestTime: Infinity }),
		// The main process stops a stuck read after 30 seconds.
		listArenas: repository => rpc.request.listArenas({ repository }, { maxRequestTime: 60_000 }),
		listArenaPresets: repository => rpc.request.listArenaPresets({ repository }, { maxRequestTime: 60_000 }),
		inspectArena: request => rpc.request.inspectArena(request, { maxRequestTime: 60_000 }),
		// Creating every attempt's worktree and setup, and archiving and removing attempts, take as long as they take.
		newArena: request => rpc.request.newArena(request, { maxRequestTime: Infinity }),
		pickArena: request => rpc.request.pickArena(request, { maxRequestTime: Infinity }),
		// The main process reads the list first, then Git, which it stops after 20 seconds.
		readFileChanges: request => rpc.request.readFileChanges(request, { maxRequestTime: 60_000 }),
		readFileDiff: request => rpc.request.readFileDiff(request, { maxRequestTime: 60_000 }),
		readWorktreeFile: request => rpc.request.readWorktreeFile(request, { maxRequestTime: 60_000 }),
		writeWorktreeFile: request => rpc.request.writeWorktreeFile(request, { maxRequestTime: 60_000 }),
		listWorktreeFolder: request => rpc.request.listWorktreeFolder(request, { maxRequestTime: 60_000 }),
		watchWorktreeFolders: folders => rpc.send.watchWorktreeFolders({ folders }),
		onWorktreeFolderChanged: folderChanges.add,
		readPorts: request => rpc.request.readPorts(request, { maxRequestTime: 30_000 }),
		listChops: request => rpc.request.listChops(request, { maxRequestTime: 60_000 }),
		onChopsChanged: chopChanges.add,
		// The main process reads the chops and the list first.
		runChop: request => rpc.request.runChop(request, { maxRequestTime: 60_000 }),
		listTerminals: () => rpc.request.listTerminals({}),
		takeSavedSessions: () => rpc.request.takeSavedSessions({}),
		forgetSavedSessions: worktrees => rpc.request.forgetSavedSessions({ worktrees }),
		// The main process reads the list first.
		openTerminal: request => rpc.request.openTerminal(request, { maxRequestTime: 60_000 }),
		readTerminal: id => rpc.request.readTerminal({ id }),
		renameTerminal: (id, name) => rpc.request.renameTerminal({ id, name }),
		drawnTerminal: (id, seq) => rpc.send.terminalDrawn({ id, seq }),
		writeTerminal: (id, data) => rpc.send.writeTerminal({ id, data }),
		resizeTerminal: (id, cols, rows) => rpc.send.resizeTerminal({ id, cols, rows }),
		pasteTerminal: (id, text) => rpc.request.pasteTerminal({ id, text }),
		closeTerminal: id => rpc.request.closeTerminal({ id }),
		onTerminalOutput: terminalOutput.add,
		onTerminalChanged: terminalChanges.add,
		onShowSession: shownSessions.add,
		onWorktreeHandedOff: handoffs.add,
		onQuitRequested: quitRequests.add,
		// Ending every session can take a moment, and the app quits right after.
		confirmQuit: () => rpc.request.confirmQuit({}, { maxRequestTime: 30_000 }),
		writeClipboard: text => rpc.request.writeClipboard({ text }),
		readClipboard: () => rpc.request.readClipboard({}),
		openLink: url => rpc.request.openLink({ url }),
		uninstallPlan: () => rpc.request.uninstallPlan({}),
		// The main process stops a stuck uninstaller after a minute.
		uninstall: request => rpc.request.uninstall(request, { maxRequestTime: 120_000 }),
		restartPlan: () => rpc.request.restartPlan({}),
		// Ending every session can take a moment, like confirmQuit, and the app quits right after.
		restart: () => rpc.request.restart({}, { maxRequestTime: 30_000 }),
		appUpdate: () => rpc.request.appUpdate({}),
		checkForAppUpdate: () => rpc.request.checkForAppUpdate({}),
		onAppUpdateChanged: appUpdates.add,
		// Ending every session can take a moment, like restart, and the app quits right after.
		installAppUpdate: request => rpc.request.installAppUpdate(request, { maxRequestTime: 30_000 }),
	};
}
