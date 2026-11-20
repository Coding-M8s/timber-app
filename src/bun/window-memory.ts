import { type SavedWindow, type SeenWindow, rememberWindow, sameSavedWindow } from "../shared/window-frame";
import type { SettingsHolder } from "./settings";
import { messageOf } from "../shared/error-message";

/** The window part of the settings file: where the window was and how large. */
export interface WindowMemory {
	/** The saved window, or null when none was saved yet. */
	load(): Promise<SavedWindow | null>;
	/**
	 * The window moved or changed size. It is read and saved once it has been
	 * still for a moment, never while it is being dragged.
	 */
	changed(): void;
	/** Read and save the window now, such as when the app is about to quit. */
	flush(): Promise<void>;
}

export interface WindowMemoryDependencies {
	settings: SettingsHolder;
	/** The window as it is now. May throw when the window is gone, and then nothing is saved. */
	read: () => SeenWindow;
	/** How long the window has to be still before it is saved, in milliseconds. */
	delay?: number;
	warn?: (message: string) => void;
}

const DEFAULT_DELAY = 400;

export function createWindowMemory({ settings, read, delay = DEFAULT_DELAY, warn = console.warn }: WindowMemoryDependencies): WindowMemory {
	let timer: ReturnType<typeof setTimeout> | null = null;

	function save(): Promise<void> {
		let seen: SeenWindow;
		try {
			seen = read();
		} catch {
			return Promise.resolve();
		}
		return settings.inTurn(async () => {
			const current = await settings.current();
			const next = rememberWindow(current.window ?? null, seen);
			if (!next || (current.window && sameSavedWindow(current.window, next))) return;
			try {
				// Every other part of the settings stays as it is.
				await settings.save({ ...current, window: next });
			} catch (error) {
				// A convenience: the window stays usable, and the next change tries again.
				warn(`Could not save the window size to ${settings.file}: ${messageOf(error)}`);
			}
		});
	}

	function flush(): Promise<void> {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		return save();
	}

	return {
		async load() {
			return (await settings.current()).window ?? null;
		},

		changed() {
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				void save();
			}, delay);
		},

		flush,
	};
}
