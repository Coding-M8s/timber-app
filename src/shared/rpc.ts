import type { RPCSchema } from "electrobun/view";
import type { Repository, TimberStatus } from "./model";

/**
 * The typed bridge between the Bun main process and the interface.
 * Types only: both sides import this file and it emits no runtime code.
 * Keep it in step with `Engine` in ./engine.ts.
 */
export type AppRPC = {
	bun: RPCSchema<{
		requests: {
			timberStatus: { params: {}; response: TimberStatus };
			recheckTimber: { params: {}; response: TimberStatus };
			listRepositories: { params: {}; response: Repository[] };
			loadRepository: { params: { path: string }; response: Repository | null };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			/** A repository changed. `path` is its primary checkout. */
			repositoryChanged: { path: string };
		};
	}>;
};
