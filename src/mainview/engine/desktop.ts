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
		loadRepository: path => rpc.request.loadRepository({ path }),
		onRepositoryChanged: listener => {
			changeListeners.add(listener);
			return () => void changeListeners.delete(listener);
		},
	};
}
