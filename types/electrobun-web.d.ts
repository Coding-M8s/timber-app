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

		static defineRPC<Schema extends { bun: { requests: RequestMap } }>(config: {
			maxRequestTime?: number;
			handlers: { requests: object; messages: object };
		}): {
			request: {
				[Name in keyof Schema["bun"]["requests"]]: (
					params: Schema["bun"]["requests"][Name]["params"],
				) => Promise<Schema["bun"]["requests"][Name]["response"]>;
			};
		};
	}
}
