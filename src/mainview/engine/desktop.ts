import { Electroview } from "electrobun/view";
import type { Engine } from "../../shared/engine";
import type { AppRPC } from "../../shared/rpc";

/** The real engine: every call crosses the typed bridge to the Bun main process. */
export function createDesktopEngine(): Engine {
	const rpc = Electroview.defineRPC<AppRPC>({
		maxRequestTime: 15_000,
		handlers: { requests: {}, messages: {} },
	});
	new Electroview({ rpc });
	return {
		timberStatus: () => rpc.request.timberStatus({}),
		recheckTimber: () => rpc.request.recheckTimber({}),
		listRepositories: () => rpc.request.listRepositories({}),
	};
}
