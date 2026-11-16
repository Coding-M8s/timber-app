import { Electroview } from "electrobun/view";
import type { Engine } from "../../shared/engine";
import type { AppRPC } from "../../shared/rpc";

/** The real engine: every call crosses the typed bridge to the Bun main process. */
export function createDesktopEngine(): Engine {
	const changeListeners = new Set<(path: string) => void>();
	const rpc = Electroview.defineRPC<AppRPC>({
		maxRequestTime: 15_000,
		handlers: {
			requests: {},
			messages: {
				repositoryChanged: ({ path }) => {
					for (const listener of [...changeListeners]) listener(path);
				},
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
		onRepositoryChanged: listener => {
			changeListeners.add(listener);
			return () => void changeListeners.delete(listener);
		},
		loadLayout: () => rpc.request.loadLayout({}),
		saveLayout: layout => rpc.request.saveLayout({ layout }),
		loadPreferences: () => rpc.request.loadPreferences({}),
		savePreferences: change => rpc.request.savePreferences({ change }),
	};
}
