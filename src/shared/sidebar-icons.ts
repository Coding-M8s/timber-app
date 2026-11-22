import { githubRepositoryOf } from "./issue-trackers";

/**
 * The small icon a repository or a group can show before its name in the
 * sidebar, and a repository beside its name in the command palette. It is
 * kept in the app's settings, never in the repository. Everything here is
 * pure: the main process reads files, Git, and the network (see
 * src/bun/sidebar-icons.ts), and hands the bytes here to be checked.
 */

/** The icons that come with the app, in the order the dialog shows them. */
export const BUNDLED_ICONS = ["folder", "briefcase", "home", "star", "heart", "code", "book", "flask", "globe", "rocket", "bug", "box"] as const;
export type BundledIconName = (typeof BUNDLED_ICONS)[number];

/** The image types an icon can be, told apart by their first bytes, never by a file name or a server's word. */
export type IconImageType = "image/png" | "image/jpeg" | "image/webp";

/** Where an image icon came from: a file the person picked, or the repository's GitHub or Bitbucket remote. */
export type IconImageSource = "file" | "github" | "bitbucket";

export type SidebarIcon =
	| { kind: "bundled"; name: BundledIconName }
	/** `data` is the image itself, in base64, so the sidebar never waits on a file or the network. */
	| { kind: "image"; source: IconImageSource; type: IconImageType; data: string };

/** The icons set, by the path of a repository's primary checkout and by group id. */
export interface SidebarIcons {
	repositories: Record<string, SidebarIcon>;
	groups: Record<string, SidebarIcon>;
}

/** What an icon is for: a repository, named by the path of its primary checkout, or a group, by its id. */
export type IconTarget = { kind: "repository"; path: string } | { kind: "group"; id: string };

/**
 * What to set: a bundled icon, an image file picked with the native picker,
 * or the icon of the repository's remote, fetched now. Asking for the remote
 * again is how it is refreshed.
 */
export type IconChoice = { kind: "bundled"; name: BundledIconName } | { kind: "file" } | { kind: "remote" };

/** The most bytes an image icon can have. Icons show at 14 pixels, and a remote one is a few kilobytes. */
export const MAX_ICON_BYTES = 32 * 1024;
/** The most pixels an image icon can have on either side. */
export const MAX_ICON_PIXELS = 512;

export function emptyIcons(): SidebarIcons {
	return { repositories: {}, groups: {} };
}

export const isBundledIcon = (value: unknown): value is BundledIconName => typeof value === "string" && (BUNDLED_ICONS as readonly string[]).includes(value);

/** The icon of a repository, or null. Safe for any path, `__proto__` too. */
export function repositoryIcon(icons: SidebarIcons, path: string): SidebarIcon | null {
	return Object.hasOwn(icons.repositories, path) ? icons.repositories[path]! : null;
}

/** The icon of a group, or null. */
export function groupIcon(icons: SidebarIcons, id: string): SidebarIcon | null {
	return Object.hasOwn(icons.groups, id) ? icons.groups[id]! : null;
}

/** The icons with one set, or with null taken away. */
export function withIcon(icons: SidebarIcons, target: IconTarget, icon: SidebarIcon | null): SidebarIcons {
	const [part, key] = target.kind === "repository" ? ["repositories", target.path] as const : ["groups", target.id] as const;
	const next = { ...icons[part] };
	if (icon) next[key] = icon;
	else delete next[key];
	return { ...icons, [part]: next };
}

export const hasIcons = (icons: SidebarIcons | undefined): icons is SidebarIcons =>
	icons !== undefined && (Object.keys(icons.repositories).length > 0 || Object.keys(icons.groups).length > 0);

/** What `sniffImage` found: the type and size of an image, or why it is not one an icon can be. */
export type SniffedImage = { ok: true; type: IconImageType; width: number; height: number } | { ok: false; message: string };

export const NOT_AN_IMAGE = "That file is not a PNG, JPEG, or WebP image.";

/** A size in bytes as a person reads it: "812 bytes", "48 KB", "2.4 MB". Kilobytes round up, so a size just past a limit never reads as the limit. */
export function describeBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} bytes`;
	if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why an image of `bytes` bytes is refused, or null when it is small enough. */
export function tooManyBytes(bytes: number): string | null {
	return bytes > MAX_ICON_BYTES ? `That image is ${describeBytes(bytes)}. An icon can be at most ${describeBytes(MAX_ICON_BYTES)}.` : null;
}

const u16be = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
const u32be = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
const u16le = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8);
const u24le = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((letter, index) => bytes[at + index] === letter.charCodeAt(0));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) || !ascii(bytes, 12, "IHDR")) return null;
	return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** The markers that start a JPEG frame and hold its size. C4, C8, and CC are other segments with the same first nibble. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let at = 2;
	while (at < bytes.length) {
		if (bytes[at] !== 0xff) return null;
		// Any number of fill bytes may come before a marker.
		while (bytes[at] === 0xff) at++;
		const marker = bytes[at];
		at++;
		if (marker === undefined) return null;
		// Markers that stand alone, with no length after them.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		// The end of the image, or the image data, before any frame: no size to read.
		if (marker === 0xd9 || marker === 0xda) return null;
		if (at + 2 > bytes.length) return null;
		const length = u16be(bytes, at);
		if (length < 2) return null;
		if (JPEG_FRAMES.has(marker)) {
			if (at + 7 > bytes.length) return null;
			return { height: u16be(bytes, at + 3), width: u16be(bytes, at + 5) };
		}
		at += length;
	}
	return null;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 30 || !ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return null;
	if (ascii(bytes, 12, "VP8 ")) {
		// A key frame: its start code, then 14 bits each of width and height.
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
		return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
	}
	if (ascii(bytes, 12, "VP8L")) {
		if (bytes[20] !== 0x2f) return null;
		const bits = (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0;
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (ascii(bytes, 12, "VP8X")) return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
	return null;
}

/**
 * Whether bytes are an image an icon can be: PNG, JPEG, or WebP, known by
 * their first bytes, no bigger than MAX_ICON_BYTES, and no more than
 * MAX_ICON_PIXELS on a side. Only the header is read, so an image that is
 * damaged further on can still pass; the sidebar then shows no icon for it.
 * SVG is never taken: it can hold scripts, and has no size in pixels.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage {
	const big = tooManyBytes(bytes.length);
	if (big) return { ok: false, message: big };
	const found: [IconImageType, { width: number; height: number } | null][] = [["image/png", pngSize(bytes)], ["image/jpeg", jpegSize(bytes)], ["image/webp", webpSize(bytes)]];
	const match = found.find(([, size]) => size !== null);
	if (!match) return { ok: false, message: NOT_AN_IMAGE };
	const [type, size] = match;
	const { width, height } = size!;
	if (width < 1 || height < 1) return { ok: false, message: NOT_AN_IMAGE };
	if (width > MAX_ICON_PIXELS || height > MAX_ICON_PIXELS) {
		return { ok: false, message: `That image is ${width} by ${height} pixels. An icon can be at most ${MAX_ICON_PIXELS} pixels on a side.` };
	}
	return { ok: true, type, width, height };
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The bytes of base64 text, or null when it is not base64. */
export function fromBase64(text: string): Uint8Array | null {
	if (text.length % 4 !== 0 || !BASE64.test(text)) return null;
	try {
		return Uint8Array.from(atob(text), letter => letter.charCodeAt(0));
	} catch {
		return null;
	}
}

/** Bytes as base64 text. */
export function toBase64(bytes: Uint8Array): string {
	let text = "";
	// In slices, so a large image never overflows the argument list.
	for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	return btoa(text);
}

/** The icon for checked image bytes. */
export function imageIcon(source: IconImageSource, bytes: Uint8Array): { ok: true; icon: SidebarIcon } | { ok: false; message: string } {
	const sniffed = sniffImage(bytes);
	if (!sniffed.ok) return sniffed;
	return { ok: true, icon: { kind: "image", source, type: sniffed.type, data: toBase64(bytes) } };
}

/** The address an `<img>` shows an image icon from. */
export const iconImageUrl = (icon: Extract<SidebarIcon, { kind: "image" }>) => `data:${icon.type};base64,${icon.data}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const IMAGE_SOURCES: readonly string[] = ["file", "github", "bitbucket"];

/**
 * One saved icon, or null when it cannot be read. An image is checked again
 * as it was when set, so a file edited by hand cannot put anything else in the
 * window, and its type is the one its bytes have.
 */
export function readIcon(value: unknown): SidebarIcon | null {
	if (!isRecord(value)) return null;
	if (value.kind === "bundled") return isBundledIcon(value.name) ? { kind: "bundled", name: value.name } : null;
	if (value.kind !== "image" || typeof value.source !== "string" || !IMAGE_SOURCES.includes(value.source) || typeof value.data !== "string") return null;
	const bytes = fromBase64(value.data);
	if (!bytes) return null;
	const sniffed = sniffImage(bytes);
	return sniffed.ok ? { kind: "image", source: value.source as IconImageSource, type: sniffed.type, data: value.data } : null;
}

function readPart(value: unknown, known: (key: string) => boolean): Record<string, SidebarIcon> {
	const part: Record<string, SidebarIcon> = {};
	if (!isRecord(value)) return part;
	for (const [key, entry] of Object.entries(value)) {
		const icon = known(key) ? readIcon(entry) : null;
		if (icon) part[key] = icon;
	}
	return part;
}

/**
 * The saved icons. Like the layout, they are only a convenience: a part that
 * cannot be read is dropped on its own, and never costs the repository list.
 * An icon of a repository or group that is not listed is dropped too.
 */
export function readIcons(value: unknown, repositories: readonly string[], groups: readonly string[]): SidebarIcons {
	if (!isRecord(value)) return emptyIcons();
	return {
		repositories: readPart(value.repositories, key => repositories.includes(key)),
		groups: readPart(value.groups, key => groups.includes(key)),
	};
}

/** The text form of the icons, each as it was read or set: an image is not checked again on every save. */
export function writeIcons(icons: SidebarIcons): { repositories?: Record<string, SidebarIcon>; groups?: Record<string, SidebarIcon> } {
	const copy = (part: Record<string, SidebarIcon>) => Object.fromEntries(Object.entries(part).map(([key, icon]) => [key, icon.kind === "bundled" ? { kind: icon.kind, name: icon.name } : { kind: icon.kind, source: icon.source, type: icon.type, data: icon.data }]));
	return {
		...(Object.keys(icons.repositories).length > 0 ? { repositories: copy(icons.repositories) } : {}),
		...(Object.keys(icons.groups).length > 0 ? { groups: copy(icons.groups) } : {}),
	};
}

/**
 * The remote a repository's icon can come from: the owner of a github.com
 * repository, whose avatar GitHub shows for it, or a bitbucket.org
 * repository, which has an icon of its own. `name` is "owner/name" or
 * "workspace/name"; `url` is the public address of the image. Neither needs
 * a login.
 */
export type RemoteIconSource =
	| { host: "github"; owner: string; name: string; url: string }
	| { host: "bitbucket"; name: string; url: string };

/** A bitbucket.org remote URL: HTTPS, maybe with a user name, SSH, or the short SSH form. */
const BITBUCKET_URL = /^(?:https:\/\/(?:[^@/\s]+@)?bitbucket\.org\/|ssh:\/\/git@bitbucket\.org\/|git@bitbucket\.org:)([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/**
 * Where the icon of a repository can come from, when `git remote get-url
 * --all -- origin` printed exactly one URL, of a github.com or bitbucket.org
 * repository. Null otherwise. A user name in a Bitbucket URL is dropped.
 */
export function remoteIconSourceOf(stdout: string): RemoteIconSource | null {
	const github = githubRepositoryOf(stdout);
	if (github) {
		const owner = github.slice(0, github.indexOf("/"));
		return { host: "github", owner, name: github, url: `https://github.com/${encodeURIComponent(owner)}.png?size=64` };
	}
	const urls = stdout.split(/\r?\n/).filter(line => line !== "");
	if (urls.length !== 1) return null;
	const match = BITBUCKET_URL.exec(urls[0]!);
	if (!match) return null;
	const [, workspace, repository] = match;
	if (repository === "" || repository === "." || repository === "..") return null;
	return { host: "bitbucket", name: `${workspace}/${repository}`, url: `https://bitbucket.org/${workspace}/${repository}/avatar/64` };
}

/** The remote whose URL the icon is read from. */
export const ICON_REMOTE = "origin";

/** The words of the button that takes a repository's icon from its remote. */
export function describeRemoteIconAction(source: Pick<RemoteIconSource, "host" | "name"> & { owner?: string }, current: SidebarIcon | null): string {
	const refresh = current?.kind === "image" && current.source === source.host;
	if (source.host === "github") return refresh ? "Refresh the GitHub avatar" : `Use the GitHub avatar of ${source.owner ?? source.name}`;
	return refresh ? "Refresh the Bitbucket icon" : `Use the Bitbucket icon of ${source.name}`;
}

/** What came of asking to set or remove an icon. A refusal or a failure changes nothing on disk. */
export type SidebarIconResult =
	| { outcome: "saved"; icons: SidebarIcons }
	/** The file picker was closed without a choice. */
	| { outcome: "cancelled" }
	/** The image is too big or is not one, or the remote gave none. `message` says why for the person. */
	| { outcome: "refused"; message: string }
	| { outcome: "failed"; message: string }
	/** The repository or group is not in the list any more. */
	| { outcome: "unknown" }
	/** The development override is set, so nothing is saved. */
	| { outcome: "overridden" };
