import { Electroview } from "electrobun/view";
import type { Engine } from "../../shared/engine";
import type { AppRPC } from "../../shared/rpc";
import type { TerminalChange, TerminalOutput } from "../../shared/terminal";

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
				terminalOutput: output => terminalOutput.call(output),
				terminalChanged: change => terminalChanges.call(change),
			},
		},
	});
	new Electroview({ rpc });
	return {
		timberStatus: () => rpc.request.timberStatus({}),
		recheckTimber: () => rpc.request.recheckTimber({}),
		listRepositories: () => rpc.request.listRepositories({}),
		// The folder picker stays open for as long as the person likes.
		addRepository: () => rpc.request.addRepository({}, { maxRequestTime: Infinity }),
		removeRepository: path => rpc.request.removeRepository({ path }),
		loadRepository: path => rpc.request.loadRepository({ path }),
		listBranches: repository => rpc.request.listBranches({ repository }),
		// Setup scripts take as long as they take.
		newWorktree: request => rpc.request.newWorktree(request, { maxRequestTime: Infinity }),
		openWorktree: request => rpc.request.openWorktree(request, { maxRequestTime: Infinity }),
		// The main process reads the list first, and stops a stuck preview after 30 seconds.
		previewDone: request => rpc.request.previewDone(request, { maxRequestTime: 60_000 }),
		// Scripts that run before deletion take as long as they take.
		applyDone: request => rpc.request.applyDone(request, { maxRequestTime: Infinity }),
		onRepositoryChanged: changes.add,
		loadLayout: () => rpc.request.loadLayout({}),
		saveLayout: layout => rpc.request.saveLayout({ layout }),
		loadPreferences: () => rpc.request.loadPreferences({}),
		savePreferences: change => rpc.request.savePreferences({ change }),
		// The main process reads the list first, and waits a moment to hear whether the editor stopped right away.
		openInEditor: request => rpc.request.openInEditor(request, { maxRequestTime: 60_000 }),
		listTerminals: () => rpc.request.listTerminals({}),
		// The main process reads the list first.
		openTerminal: request => rpc.request.openTerminal(request, { maxRequestTime: 60_000 }),
		readTerminal: id => rpc.request.readTerminal({ id }),
		renameTerminal: (id, name) => rpc.request.renameTerminal({ id, name }),
		drawnTerminal: (id, seq) => rpc.send.terminalDrawn({ id, seq }),
		writeTerminal: (id, data) => rpc.send.writeTerminal({ id, data }),
		resizeTerminal: (id, cols, rows) => rpc.send.resizeTerminal({ id, cols, rows }),
		closeTerminal: id => rpc.request.closeTerminal({ id }),
		onTerminalOutput: terminalOutput.add,
		onTerminalChanged: terminalChanges.add,
		onQuitRequested: quitRequests.add,
		// Ending every session can take a moment, and the app quits right after.
		confirmQuit: () => rpc.request.confirmQuit({}, { maxRequestTime: 30_000 }),
		writeClipboard: text => rpc.request.writeClipboard({ text }),
		readClipboard: () => rpc.request.readClipboard({}),
		openLink: url => rpc.request.openLink({ url }),
	};
}
