import { readFile, stat } from "node:fs/promises";
import { remoteUrlArguments } from "../shared/issue-trackers";
import {
	ICON_REMOTE,
	type IconChoice,
	type IconTarget,
	type RemoteIconSource,
	type SidebarIcon,
	type SidebarIconResult,
	type SidebarIcons,
	MAX_ICON_BYTES,
	NOT_AN_IMAGE,
	describeBytes,
	emptyIcons,
	imageIcon,
	isBundledIcon,
	remoteIconSourceOf,
	tooManyBytes,
	withIcon,
} from "../shared/sidebar-icons";
import type { Settings } from "../shared/settings";
import { messageOf } from "../shared/error-message";
import { overrideRepositoryPaths } from "./git-engine";
import { readGit } from "./read-git";
import type { SettingsHolder } from "./settings";

/** Reading a remote's URL is local and quick, so anything this slow is stuck. */
const REMOTE_TIMEOUT_MS = 10_000;
/** A remote's URLs fit in far less. */
const REMOTE_LIMIT_BYTES = 16 * 1024;
/** How long GitHub or Bitbucket may take to send an icon. */
export const ICON_FETCH_TIMEOUT_MS = 15_000;

/** The image types the file picker offers. The bytes are checked whatever the name says. */
export const ICON_FILE_TYPES = "png,jpg,jpeg,webp";

export interface SidebarIconOptions {
	/** The one holder of the settings file. */
	settings: SettingsHolder;
	/** The native file picker, offering the given types. Null when it was closed without a choice. */
	pickFile: (types: string) => Promise<string | null>;
	/** How the network is reached. Tests pass their own. */
	fetch?: typeof fetch;
	/** The Git executable. Tests may pass another. */
	git?: string;
	environment?: Record<string, string | undefined>;
	timeoutMs?: number;
}

/** The repository and group icons, kept in the settings file. See `Engine.listSidebarIcons`. */
export interface SidebarIconStore {
	list(): Promise<SidebarIcons>;
	/** See `Engine.readRemoteIconSource`. */
	remoteSource(path: string): Promise<RemoteIconSource | null>;
	/** See `Engine.setSidebarIcon`. */
	set(target: IconTarget, choice: IconChoice | null): Promise<SidebarIconResult>;
}

/**
 * Where a repository's icon can come from, by its origin remote. One
 * read-only `git remote get-url --all -- origin`, as an argument array; a
 * remote that is missing, or Git that fails, is null.
 */
export async function remoteIconSource(folder: string, git?: string): Promise<RemoteIconSource | null> {
	const answer = await readGit(remoteUrlArguments(folder, ICON_REMOTE), { ...(git === undefined ? {} : { git }), timeoutMs: REMOTE_TIMEOUT_MS, limitBytes: REMOTE_LIMIT_BYTES });
	return answer.started && answer.exitCode === 0 && !answer.timedOut && !answer.truncated ? remoteIconSourceOf(answer.stdout) : null;
}

const hostName = (source: RemoteIconSource) => (source.host === "github" ? "GitHub" : "Bitbucket");

/** What a fetch of a remote's icon came to: its bytes, or why there are none, for the person. */
type Fetched = { ok: true; bytes: Uint8Array } | { ok: false; outcome: "refused" | "failed"; message: string };

/** A message as a sentence: an error's own words may end without a stop. */
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** How many redirects a fetch follows. GitHub and Bitbucket use one. */
const MAX_REDIRECTS = 5;

const isTimeout = (error: unknown) => {
	const name = (error as { name?: string } | null)?.name;
	return name === "TimeoutError" || name === "AbortError";
};

/**
 * Fetch the icon of a remote: a GET of its public address over HTTPS, with
 * no login. Redirects are followed one by one, at most MAX_REDIRECTS, each
 * only to another HTTPS address, so no request ever goes out in the clear.
 * At most MAX_ICON_BYTES are read; what the server says the type is counts
 * for nothing, as the bytes are checked after. The whole fetch, body
 * included, must end within `timeoutMs`.
 */
export async function fetchRemoteIcon(source: RemoteIconSource, fetcher: typeof fetch = fetch, timeoutMs = ICON_FETCH_TIMEOUT_MS): Promise<Fetched> {
	const host = hostName(source);
	const seconds = Math.max(1, Math.round(timeoutMs / 1000));
	const tooSlow: Fetched = { ok: false, outcome: "failed", message: `${host} did not answer within ${seconds} second${seconds === 1 ? "" : "s"}.` };
	const signal = AbortSignal.timeout(timeoutMs);
	let address = source.url;
	let response: Response;
	for (let hop = 0; ; hop++) {
		try {
			response = await fetcher(address, { redirect: "manual", signal });
		} catch (error) {
			return isTimeout(error) ? tooSlow : { ok: false, outcome: "failed", message: `Could not reach ${host}: ${sentence(messageOf(error))}` };
		}
		if (response.status < 300 || response.status >= 400 || response.status === 304) break;
		const location = response.headers.get("location");
		await response.body?.cancel();
		let next: URL | null = null;
		try {
			next = location === null ? null : new URL(location, address);
		} catch {
			next = null;
		}
		if (!next) return { ok: false, outcome: "failed", message: `${host} answered ${response.status} without saying where the icon is.` };
		if (next.protocol !== "https:") return { ok: false, outcome: "refused", message: `${host} sent the icon on to an address that is not HTTPS, so it was not fetched.` };
		if (hop === MAX_REDIRECTS) return { ok: false, outcome: "failed", message: `${host} sent the icon on too many times.` };
		address = next.href;
	}
	if (response.status === 404) {
		await response.body?.cancel();
		return {
			ok: false, outcome: "refused",
			message: source.host === "github"
				? `GitHub has no avatar for ${source.owner}.`
				: `Bitbucket shows no icon for ${source.name} without a login. The repository may be private, or gone.`,
		};
	}
	if (!response.ok) {
		await response.body?.cancel();
		return { ok: false, outcome: "failed", message: `${host} answered ${response.status} for ${source.url}.` };
	}
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) {
		await response.body?.cancel();
		return { ok: false, outcome: "refused", message: `${host} sent an image of ${describeBytes(declared)}. An icon can be at most ${describeBytes(MAX_ICON_BYTES)}.` };
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		const reader = response.body?.getReader();
		while (reader) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			// One byte past the most is enough to know it is too big: the rest is never read.
			if (size > MAX_ICON_BYTES) {
				await reader.cancel();
				return { ok: false, outcome: "refused", message: `${host} sent an image bigger than ${describeBytes(MAX_ICON_BYTES)}. An icon can be at most ${describeBytes(MAX_ICON_BYTES)}.` };
			}
			chunks.push(value);
		}
	} catch (error) {
		return isTimeout(error) ? tooSlow : { ok: false, outcome: "failed", message: `Could not read the icon from ${host}: ${sentence(messageOf(error))}` };
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.length;
	}
	return { ok: true, bytes };
}

/** Whether the target names a repository or group in the settings. */
function knows(settings: Settings, target: IconTarget): boolean {
	return target.kind === "repository"
		? settings.repositories.some(entry => entry.path === target.path)
		: (settings.groups ?? []).some(group => group.id === target.id);
}

/** The target as the bridge sent it, checked: its shape is never assumed. */
function readTarget(value: unknown): IconTarget | null {
	if (typeof value !== "object" || value === null) return null;
	const { kind, path, id } = value as Record<string, unknown>;
	if (kind === "repository" && typeof path === "string" && path !== "") return { kind, path };
	if (kind === "group" && typeof id === "string" && id !== "") return { kind, id };
	return null;
}

function readChoice(value: unknown): IconChoice | null | undefined {
	if (value === null) return null;
	if (typeof value !== "object") return undefined;
	const { kind, name } = value as Record<string, unknown>;
	if (kind === "bundled") return isBundledIcon(name) ? { kind, name } : undefined;
	if (kind === "file" || kind === "remote") return { kind };
	return undefined;
}

/**
 * Repository and group icons, kept in the settings file. Picking a file and
 * fetching from a remote happen before the change takes its turn with the
 * other changes to the file, so an open picker or a slow network never holds
 * a save up; the target is checked again in the turn. Nothing in a
 * repository or its folder is touched.
 */
export function createSidebarIcons(options: SidebarIconOptions): SidebarIconStore {
	const { settings: holder, pickFile, git, environment = process.env, timeoutMs } = options;
	const fetcher = options.fetch ?? fetch;
	const overridden = () => overrideRepositoryPaths(environment) !== null;

	async function listed(path: string): Promise<boolean> {
		return (await holder.current()).repositories.some(entry => entry.path === path);
	}

	/** The icon a choice makes, or why it makes none. */
	async function iconOf(target: IconTarget, choice: IconChoice): Promise<{ ok: true; icon: SidebarIcon } | Exclude<SidebarIconResult, { outcome: "saved" }>> {
		if (choice.kind === "bundled") return { ok: true, icon: { kind: "bundled", name: choice.name } };
		if (choice.kind === "file") {
			let file: string | null;
			try {
				file = await pickFile(ICON_FILE_TYPES);
			} catch (error) {
				return { outcome: "failed", message: `Could not open the file picker: ${sentence(messageOf(error))}` };
			}
			if (file === null) return { outcome: "cancelled" };
			try {
				const found = await stat(file);
				if (!found.isFile()) return { outcome: "refused", message: "That is not a file." };
				// A big file is refused before it is read.
				const big = tooManyBytes(found.size);
				if (big) return { outcome: "refused", message: big };
				const made = imageIcon("file", new Uint8Array(await readFile(file)));
				return made.ok ? made : { outcome: "refused", message: made.message };
			} catch (error) {
				return { outcome: "failed", message: `Could not read ${file}: ${sentence(messageOf(error))}` };
			}
		}
		if (target.kind !== "repository") return { outcome: "refused", message: "Only a repository can take its icon from a remote." };
		const source = await remoteIconSource(target.path, git);
		if (!source) return { outcome: "refused", message: `This repository has no GitHub or Bitbucket remote named ${ICON_REMOTE}.` };
		const fetched = await fetchRemoteIcon(source, fetcher, timeoutMs);
		if (!fetched.ok) return { outcome: fetched.outcome, message: `${fetched.message} The icon was not changed.` };
		const made = imageIcon(source.host, fetched.bytes);
		if (!made.ok) {
			const why = made.message === NOT_AN_IMAGE ? `${hostName(source)} sent something that is not a PNG, JPEG, or WebP image.` : `${hostName(source)} sent an icon that cannot be used: ${made.message}`;
			return { outcome: "refused", message: `${why} The icon was not changed.` };
		}
		return made;
	}

	return {
		async list() {
			if (overridden()) return emptyIcons();
			return (await holder.current()).icons ?? emptyIcons();
		},

		async remoteSource(path) {
			// The request comes over the bridge, and Git runs only for a repository in the list.
			if (overridden() || typeof path !== "string" || path === "" || !await listed(path)) return null;
			return remoteIconSource(path, git);
		},

		async set(requestedTarget, requestedChoice) {
			if (overridden()) return { outcome: "overridden" };
			const target = readTarget(requestedTarget);
			const choice = readChoice(requestedChoice);
			if (!target || choice === undefined) return { outcome: "failed", message: "The request for an icon is not complete." };
			if (!knows(await holder.current(), target)) return { outcome: "unknown" };
			let icon: SidebarIcon | null = null;
			if (choice) {
				const made = await iconOf(target, choice);
				if (!("ok" in made)) return made;
				icon = made.icon;
			}
			return holder.inTurn(async () => {
				const current = await holder.current();
				// It may have been removed while the picker was open or the icon was on its way.
				if (!knows(current, target)) return { outcome: "unknown" };
				const icons = withIcon(current.icons ?? emptyIcons(), target, icon);
				try {
					await holder.save({ ...current, icons });
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${holder.file}: ${messageOf(error)}` };
				}
				return { outcome: "saved", icons };
			});
		},
	};
}
