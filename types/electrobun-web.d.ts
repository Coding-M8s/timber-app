/**
 * A stand-in for the Electrobun browser SDK, used by the default `bun run typecheck`.
 *
 * The real SDK types come from the devkit that `electrobun prepare` projects
 * into .hutch/devkit, which plain browser work and CI do not have. This
 * approximation keeps the rest of the interface checkable there. `bun run
 * typecheck:desktop` checks against the real SDK and is the one that counts for
 * src/bun and the desktop bridge.
 */
declare module "electrobun/view" {
	type RequestMap = Record<string, { params: unknown; response: unknown }>;

	export type RPCSchema<Shape extends { requests: object; messages: object }> = Shape;

	export class Electroview {
		constructor(config: { rpc: unknown });

		static defineRPC<Schema extends { bun: { requests: RequestMap; messages: object }; webview: { requests: RequestMap; messages: object } }>(config: {
			maxRequestTime?: number;
			handlers: {
				requests: {
					[Name in keyof Schema["webview"]["requests"]]?: (
						params: Schema["webview"]["requests"][Name]["params"],
					) => Schema["webview"]["requests"][Name]["response"] | Promise<Schema["webview"]["requests"][Name]["response"]>;
				};
				messages: {
					[Name in keyof Schema["webview"]["messages"]]?: (payload: Schema["webview"]["messages"][Name]) => void;
				};
			};
		}): {
			request: {
				[Name in keyof Schema["bun"]["requests"]]: (
					params: Schema["bun"]["requests"][Name]["params"],
					options?: { maxRequestTime?: number },
				) => Promise<Schema["bun"]["requests"][Name]["response"]>;
			};
			send: {
				[Name in keyof Schema["bun"]["messages"]]: (payload: Schema["bun"]["messages"][Name]) => void;
			};
		};
	}
}
