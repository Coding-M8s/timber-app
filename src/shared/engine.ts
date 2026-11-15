import type { Repository } from "./model";

/**
 * Everything the interface may ask of the machine it runs on.
 *
 * The interface only ever talks to this contract. The desktop app answers it
 * from the Bun main process; the browser build answers it from sample data.
 * Grow it one capability at a time, and keep every method safe to call again.
 */
export interface Engine {
	listRepositories(): Promise<Repository[]>;
}
