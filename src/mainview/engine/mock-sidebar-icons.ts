/**
 * Repository and group icons as the mock acts them out. In a browser, Choose
 * image file opens the browser's file picker; tests and the console give it
 * the bytes of a file with `setIconFile`. A repository's remote icon is
 * decided with `setRemoteIcon`: the sample timber repository has a GitHub
 * origin whose avatar is a small green square.
 */
import type { Engine } from "../../shared/engine";
import { type IconTarget, type RemoteIconSource, type SidebarIcon, type SidebarIconResult, type SidebarIcons, emptyIcons, fromBase64, imageIcon, isBundledIcon, tooManyBytes, withIcon } from "../../shared/sidebar-icons";

/** A 16 by 16 pixel PNG, green: the sample GitHub avatar. */
export const SAMPLE_AVATAR_PNG = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQW+BMEmIY1TCqYfhqAAAOjhEQe5pRjgAAAABJRU5ErkJggg==";
/** The same, blue: a sample image file. */
export const SAMPLE_ICON_FILE_PNG = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNQ7PhPEmIY1TCqYfhqAACLCKgQD5rXyAAAAABJRU5ErkJggg==";

/** What a repository's remote gives: its source and the bytes fetched, or a fetch that fails with this outcome and message. */
export type MockRemoteIcon = { source: RemoteIconSource; image: Uint8Array } | { source: RemoteIconSource; failure: { outcome: "refused" | "failed"; message: string } };

export interface SidebarIconControls {
	/** Decide what the next Choose image file reads: these bytes, or null for a picker closed without a choice. Each choice takes one. */
	setIconFile(bytes: Uint8Array | null): void;
	/** Decide what a repository's origin gives, or null for one with no GitHub or Bitbucket origin. */
	setRemoteIcon(path: string, remote: MockRemoteIcon | null): void;
}

/** Ask the browser for an image file. Null when the picker was closed without one. */
function pickInBrowser(): Promise<Uint8Array | null> {
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/png,image/jpeg,image/webp";
		input.addEventListener("cancel", () => resolve(null));
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (!file) return resolve(null);
			// Big files are refused by their size, as the main process does, so only the first bytes past the most are read.
			void file.slice(0, 256 * 1024).arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), () => resolve(null));
		});
		input.click();
	});
}

const inBrowser = () => typeof document !== "undefined" && typeof window !== "undefined";

export interface MockSidebarIconOptions {
	/** Whether a repository or group is in the list now. */
	knows(target: IconTarget): boolean;
}

export function createMockSidebarIcons(options: MockSidebarIconOptions): Pick<Engine, "listSidebarIcons" | "readRemoteIconSource" | "setSidebarIcon"> & SidebarIconControls & { forgetIcon(target: IconTarget): void } {
	let icons: SidebarIcons = emptyIcons();
	const files: (Uint8Array | null)[] = [];
	const remotes = new Map<string, MockRemoteIcon | null>([
		["/work/timber", { source: { host: "github", owner: "acme", name: "acme/timber", url: "https://github.com/acme.png?size=64" }, image: fromBase64(SAMPLE_AVATAR_PNG)! }],
	]);

	async function iconOf(target: IconTarget, choice: Parameters<Engine["setSidebarIcon"]>[1] & object): Promise<{ ok: true; icon: SidebarIcon } | Exclude<SidebarIconResult, { outcome: "saved" }>> {
		if (choice.kind === "bundled") return isBundledIcon(choice.name) ? { ok: true, icon: { kind: "bundled", name: choice.name } } : { outcome: "failed", message: "The request for an icon is not complete." };
		if (choice.kind === "file") {
			const bytes = files.length > 0 ? files.shift()! : inBrowser() ? await pickInBrowser() : null;
			if (bytes === null) return { outcome: "cancelled" };
			const big = tooManyBytes(bytes.length);
			if (big) return { outcome: "refused", message: big };
			const made = imageIcon("file", bytes);
			return made.ok ? made : { outcome: "refused", message: made.message };
		}
		if (target.kind !== "repository") return { outcome: "refused", message: "Only a repository can take its icon from a remote." };
		const remote = remotes.get(target.path) ?? null;
		if (!remote) return { outcome: "refused", message: "This repository has no GitHub or Bitbucket remote named origin." };
		if ("failure" in remote) return { outcome: remote.failure.outcome, message: `${remote.failure.message} The icon was not changed.` };
		const made = imageIcon(remote.source.host, remote.image);
		return made.ok ? made : { outcome: "refused", message: `${made.message} The icon was not changed.` };
	}

	return {
		listSidebarIcons: async () => structuredClone(icons),
		async readRemoteIconSource(path) {
			if (!options.knows({ kind: "repository", path })) return null;
			return structuredClone(remotes.get(path)?.source ?? null);
		},
		async setSidebarIcon(target, choice) {
			if (!options.knows(target)) return { outcome: "unknown" };
			let icon: SidebarIcon | null = null;
			if (choice) {
				const made = await iconOf(target, choice);
				if (!("ok" in made)) return made;
				icon = made.icon;
			}
			// As in the main process: it may have gone while the picker was open.
			if (!options.knows(target)) return { outcome: "unknown" };
			icons = withIcon(icons, target, icon);
			return { outcome: "saved", icons: structuredClone(icons) };
		},
		setIconFile(bytes) {
			files.push(bytes);
		},
		setRemoteIcon(path, remote) {
			remotes.set(path, remote);
		},
		forgetIcon(target) {
			icons = withIcon(icons, target, null);
		},
	};
}
