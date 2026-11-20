/**
 * Where the mock engine keeps the sessions saved at quit between runs, as the
 * main process keeps sessions.json: in memory for tests, and in the browser's
 * localStorage for `bun run dev:web`, so a reload is a restart.
 */
export interface MockSessionStorage {
	read(): string | null;
	write(text: string): void;
}

export function memorySessionStorage(): MockSessionStorage {
	let text: string | null = null;
	return {
		read: () => text,
		write(next) {
			text = next;
		},
	};
}

const KEY = "timber-app.mock.sessions";

/** localStorage key "timber-app.mock.sessions". Every call is wrapped: a missing or full storage reads as null and drops the write. */
export function browserSessionStorage(): MockSessionStorage {
	return {
		read() {
			try {
				return globalThis.localStorage?.getItem(KEY) ?? null;
			} catch {
				return null;
			}
		},
		write(text) {
			try {
				globalThis.localStorage?.setItem(KEY, text);
			} catch {
				// Private windows and full storage keep nothing. The next run opens no sessions.
			}
		},
	};
}
