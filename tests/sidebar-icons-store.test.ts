import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryList } from "../src/bun/repository-list";
import { type RepositoryReader } from "../src/bun/repository-reader";
import { createSettingsHolder, writeSettings } from "../src/bun/settings";
import { createSidebarIcons, fetchRemoteIcon } from "../src/bun/sidebar-icons";
import { type Settings, parseSettings } from "../src/shared/settings";
import { MAX_ICON_BYTES, type SidebarIcon, fromBase64, remoteIconSourceOf } from "../src/shared/sidebar-icons";
import { SAMPLE_AVATAR_PNG } from "../src/mainview/engine/mock-sidebar-icons";
import { fingerprint, git, makeRepository } from "./support/timber";
import { png } from "./support/images";

let root: string;
let onGithub: string;
let onBitbucket: string;
let noOrigin: string;
let settingsFile: string;
let cases = 0;
const avatar = fromBase64(SAMPLE_AVATAR_PNG)!;
const star: SidebarIcon = { kind: "bundled", name: "star" };

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-icons-")));
	onGithub = makeRepository(root, "shop");
	git(onGithub, "remote", "add", "origin", "git@github.com:acme/shop.git");
	onBitbucket = makeRepository(root, "store");
	git(onBitbucket, "remote", "add", "origin", "https://sam@bitbucket.org/acme/store.git");
	noOrigin = makeRepository(root, "local");
	git(noOrigin, "remote", "add", "upstream", "git@github.com:acme/local.git");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
	settingsFile = join(root, `config-${cases++}`, "timber-app", "settings.json");
	await writeSettings(settingsFile, {
		repositories: [onGithub, onBitbucket, noOrigin].map(path => ({ path, commonDir: join(path, ".git") })),
		groups: [{ id: "work", name: "Work" }],
	});
});

/** Bytes as a response body. */
const body = (bytes: Uint8Array): BodyInit => new Uint8Array(bytes);

const saved = (): Settings => parseSettings(readFileSync(settingsFile, "utf8"))!;

interface Fetched {
	url: string;
	init: RequestInit | undefined;
}

/** A network that answers every request with `answer`, and records what was asked. */
function network(answer: (url: string, init?: RequestInit) => Promise<Response> | Response) {
	const asked: Fetched[] = [];
	const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
		asked.push({ url: String(url), init });
		return answer(String(url), init);
	}) as typeof fetch;
	return { fetcher, asked };
}

function iconsOn(options: { pickFile?: (types: string) => Promise<string | null>; fetch?: typeof fetch; environment?: Record<string, string | undefined>; timeoutMs?: number } = {}) {
	const settings = createSettingsHolder(settingsFile, () => {});
	const icons = createSidebarIcons({
		settings,
		pickFile: options.pickFile ?? (async () => null),
		fetch: options.fetch ?? network(() => new Response(body(avatar))).fetcher,
		environment: options.environment ?? {},
		...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
	});
	return { icons, settings };
}

/** A file in the test folder with these bytes. */
function file(name: string, bytes: Uint8Array): string {
	const path = join(root, `${cases}-${name}`);
	writeFileSync(path, bytes);
	return path;
}

describe("setting an icon", () => {
	test("a bundled icon is saved for a repository and a group, and removed again", async () => {
		const { icons } = iconsOn();
		expect(await icons.set({ kind: "repository", path: onGithub }, star)).toMatchObject({ outcome: "saved" });
		const result = await icons.set({ kind: "group", id: "work" }, { kind: "bundled", name: "briefcase" });
		expect(result).toEqual({ outcome: "saved", icons: { repositories: { [onGithub]: star }, groups: { work: { kind: "bundled", name: "briefcase" } } } });
		expect(saved().icons).toEqual({ repositories: { [onGithub]: star }, groups: { work: { kind: "bundled", name: "briefcase" } } });
		expect(await icons.list()).toEqual(result.outcome === "saved" ? result.icons : { repositories: {}, groups: {} });

		await icons.set({ kind: "repository", path: onGithub }, null);
		await icons.set({ kind: "group", id: "work" }, null);
		expect(saved().icons).toBeUndefined();
		expect(JSON.parse(readFileSync(settingsFile, "utf8"))).not.toHaveProperty("icons");
	});

	test("a repository or group not in the list changes nothing", async () => {
		const { icons } = iconsOn();
		const before = readFileSync(settingsFile, "utf8");
		expect(await icons.set({ kind: "repository", path: join(root, "elsewhere") }, star)).toEqual({ outcome: "unknown" });
		expect(await icons.set({ kind: "group", id: "gone" }, star)).toEqual({ outcome: "unknown" });
		expect(readFileSync(settingsFile, "utf8")).toBe(before);
	});

	test("a request whose shape is wrong is refused before anything runs", async () => {
		const { icons } = iconsOn();
		for (const [target, choice] of [
			[{ kind: "repository" }, star], [null, star], [{ kind: "group", id: "" }, star],
			[{ kind: "repository", path: onGithub }, { kind: "bundled", name: "unicorn" }], [{ kind: "repository", path: onGithub }, "star"], [{ kind: "repository", path: onGithub }, { kind: "url", url: "https://example.com/x.png" }],
		] as const) {
			expect(await icons.set(target as never, choice as never)).toEqual({ outcome: "failed", message: "The request for an icon is not complete." });
		}
	});

	test("nothing is saved while the development override is set", async () => {
		const { icons } = iconsOn({ environment: { TIMBER_APP_REPOS: onGithub } });
		expect(await icons.set({ kind: "repository", path: onGithub }, star)).toEqual({ outcome: "overridden" });
		expect(await icons.list()).toEqual({ repositories: {}, groups: {} });
		expect(await icons.remoteSource(onGithub)).toBeNull();
	});
});

describe("an image file", () => {
	test("is read, checked, and kept in the settings, with the picker offering image types", async () => {
		const picked = file("icon.png", png(32, 32));
		let types = "";
		const { icons } = iconsOn({ pickFile: async offered => (types = offered, picked) });
		const result = await icons.set({ kind: "group", id: "work" }, { kind: "file" });
		expect(types).toBe("png,jpg,jpeg,webp");
		expect(result).toMatchObject({ outcome: "saved" });
		expect(saved().icons?.groups.work).toEqual({ kind: "image", source: "file", type: "image/png", data: Buffer.from(png(32, 32)).toString("base64") });
	});

	test("a closed picker changes nothing", async () => {
		const { icons } = iconsOn({ pickFile: async () => null });
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "file" })).toEqual({ outcome: "cancelled" });
		expect(saved().icons).toBeUndefined();
	});

	test("a big file, a file that is no image, and a folder are refused clearly, and leave the icon as it was", async () => {
		const big = file("big.png", new Uint8Array(3 * 1024 * 1024));
		const text = file("notes.png", new TextEncoder().encode("not really a picture, only a name that says so"));
		const huge = file("huge.png", png(2000, 10));
		const folder = join(root, `${cases}-folder.png`);
		mkdirSync(folder);
		const answers = [big, text, huge, folder];
		const { icons } = iconsOn({ pickFile: async () => answers.shift()! });
		await icons.set({ kind: "repository", path: onGithub }, star);
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "file" })).toEqual({ outcome: "refused", message: "That image is 3.0 MB. An icon can be at most 32 KB." });
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "file" })).toEqual({ outcome: "refused", message: "That file is not a PNG, JPEG, or WebP image." });
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "file" })).toEqual({ outcome: "refused", message: "That image is 2000 by 10 pixels. An icon can be at most 512 pixels on a side." });
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "file" })).toEqual({ outcome: "refused", message: "That is not a file." });
		expect(saved().icons?.repositories[onGithub]).toEqual(star);
	});

	test("a repository removed while the picker was open gets no icon", async () => {
		const picked = file("late.png", png(16, 16));
		let holder: ReturnType<typeof createSettingsHolder> | undefined;
		const { icons, settings } = iconsOn({
			pickFile: async () => {
				const current = await holder!.current();
				await holder!.save({ ...current, repositories: current.repositories.filter(entry => entry.path !== onGithub) });
				return picked;
			},
		});
		holder = settings;
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "file" })).toEqual({ outcome: "unknown" });
		expect(saved().icons).toBeUndefined();
	});
});

describe("the icon of a repository's remote", () => {
	test("reads only the origin remote, with Git, and changes nothing in the repository", async () => {
		const { icons } = iconsOn();
		const before = [onGithub, onBitbucket, noOrigin].map(fingerprint);
		const config = readFileSync(join(onBitbucket, ".git", "config"), "utf8");
		expect(await icons.remoteSource(onGithub)).toEqual({ host: "github", owner: "acme", name: "acme/shop", url: "https://github.com/acme.png?size=64" });
		expect(await icons.remoteSource(onBitbucket)).toEqual({ host: "bitbucket", name: "acme/store", url: "https://bitbucket.org/acme/store/avatar/64" });
		expect(await icons.remoteSource(noOrigin)).toBeNull();
		expect(await icons.remoteSource(join(root, "elsewhere"))).toBeNull();
		expect(await icons.remoteSource("" as string)).toBeNull();
		expect([onGithub, onBitbucket, noOrigin].map(fingerprint)).toEqual(before);
		expect(readFileSync(join(onBitbucket, ".git", "config"), "utf8")).toBe(config);
	});

	test("the GitHub avatar is fetched once, with no login, and a copy kept; asking again refreshes it", async () => {
		const { fetcher, asked } = network(() => new Response(body(avatar), { headers: { "content-type": "image/png" } }));
		const { icons } = iconsOn({ fetch: fetcher });
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "remote" })).toMatchObject({ outcome: "saved" });
		expect(asked).toHaveLength(1);
		expect(asked[0]!.url).toBe("https://github.com/acme.png?size=64");
		expect(asked[0]!.init).toMatchObject({ redirect: "manual" });
		expect(new Headers(asked[0]!.init?.headers).has("authorization")).toBe(false);
		expect(new Headers(asked[0]!.init?.headers).has("cookie")).toBe(false);
		expect(saved().icons?.repositories[onGithub]).toEqual({ kind: "image", source: "github", type: "image/png", data: SAMPLE_AVATAR_PNG });
		// Listing never goes to the network.
		await icons.list();
		expect(asked).toHaveLength(1);
		await icons.set({ kind: "repository", path: onGithub }, { kind: "remote" });
		expect(asked).toHaveLength(2);
	});

	test("the Bitbucket icon is the repository's own, with the user name left out", async () => {
		const { fetcher, asked } = network(() => new Response(body(png(64, 64))));
		const { icons } = iconsOn({ fetch: fetcher });
		expect(await icons.set({ kind: "repository", path: onBitbucket }, { kind: "remote" })).toMatchObject({ outcome: "saved" });
		expect(asked.map(({ url }) => url)).toEqual(["https://bitbucket.org/acme/store/avatar/64"]);
		expect(saved().icons?.repositories[onBitbucket]).toMatchObject({ kind: "image", source: "bitbucket", type: "image/png" });
	});

	test("a failed fetch says why and leaves the current icon in place", async () => {
		const cases: [() => Response | Promise<Response>, string, "refused" | "failed"][] = [
			[() => new Response("Not Found", { status: 404 }), "Bitbucket shows no icon for acme/store without a login. The repository may be private, or gone. The icon was not changed.", "refused"],
			[() => new Response("busy", { status: 503 }), "Bitbucket answered 503 for https://bitbucket.org/acme/store/avatar/64. The icon was not changed.", "failed"],
			[() => Promise.reject(new TypeError("getaddrinfo ENOTFOUND bitbucket.org")), "Could not reach Bitbucket: getaddrinfo ENOTFOUND bitbucket.org. The icon was not changed.", "failed"],
			[() => new Response("<html>login</html>"), "Bitbucket sent something that is not a PNG, JPEG, or WebP image. The icon was not changed.", "refused"],
			[() => new Response(body(new Uint8Array(MAX_ICON_BYTES * 2))), "Bitbucket sent an image bigger than 32 KB. An icon can be at most 32 KB. The icon was not changed.", "refused"],
			[() => new Response(body(new Uint8Array(10)), { headers: { "content-length": String(MAX_ICON_BYTES * 3) } }), "Bitbucket sent an image of 96 KB. An icon can be at most 32 KB. The icon was not changed.", "refused"],
		];
		for (const [answer, message, outcome] of cases) {
			const { icons } = iconsOn({ fetch: network(answer).fetcher });
			await icons.set({ kind: "repository", path: onBitbucket }, star);
			expect(await icons.set({ kind: "repository", path: onBitbucket }, { kind: "remote" })).toEqual({ outcome, message });
			expect(saved().icons?.repositories[onBitbucket]).toEqual(star);
		}
	});

	test("a body sent without a length is read only up to the limit", async () => {
		let pulled = 0;
		const endless = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += 1;
				controller.enqueue(new Uint8Array(16 * 1024));
				if (pulled > 1000) controller.close();
			},
		});
		const source = remoteIconSourceOf("git@github.com:acme/shop.git")!;
		const fetched = await fetchRemoteIcon(source, (async () => new Response(endless)) as unknown as typeof fetch);
		expect(fetched).toMatchObject({ ok: false, outcome: "refused" });
		expect(pulled).toBeLessThan(10);
	});

	test("a server that does not answer in time is given up on", async () => {
		const hanging = network((_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))));
		const { icons } = iconsOn({ fetch: hanging.fetcher, timeoutMs: 50 });
		expect(await icons.set({ kind: "repository", path: onGithub }, { kind: "remote" })).toEqual({ outcome: "failed", message: "GitHub did not answer within 1 second. The icon was not changed." });
	});

	test("redirects are followed one by one, each only to HTTPS, so nothing is asked in the clear", async () => {
		const source = remoteIconSourceOf("git@github.com:acme/shop.git")!;
		const moved = (location: string) => new Response(null, { status: 302, headers: { location } });
		const followed = network(url => (url.startsWith("https://github.com/") ? moved("https://avatars.example/u/1?s=64") : new Response(body(avatar))));
		expect(await fetchRemoteIcon(source, followed.fetcher)).toEqual({ ok: true, bytes: avatar });
		expect(followed.asked.map(({ url }) => url)).toEqual(["https://github.com/acme.png?size=64", "https://avatars.example/u/1?s=64"]);

		const clear = network(() => moved("http://avatars.example/u/1"));
		expect(await fetchRemoteIcon(source, clear.fetcher)).toEqual({ ok: false, outcome: "refused", message: "GitHub sent the icon on to an address that is not HTTPS, so it was not fetched." });
		expect(clear.asked).toHaveLength(1);

		const nowhere = network(() => new Response(null, { status: 302 }));
		expect(await fetchRemoteIcon(source, nowhere.fetcher)).toEqual({ ok: false, outcome: "failed", message: "GitHub answered 302 without saying where the icon is." });

		const relative = network(url => (url === "https://github.com/acme.png?size=64" ? moved("/avatars/acme.png") : new Response(body(avatar))));
		expect(await fetchRemoteIcon(source, relative.fetcher)).toEqual({ ok: true, bytes: avatar });
		expect(relative.asked.map(({ url }) => url)).toEqual(["https://github.com/acme.png?size=64", "https://github.com/avatars/acme.png"]);

		const loop = network(() => moved("https://github.com/acme.png?size=64"));
		expect(await fetchRemoteIcon(source, loop.fetcher)).toEqual({ ok: false, outcome: "failed", message: "GitHub sent the icon on too many times." });
		expect(loop.asked).toHaveLength(6);
	});

	test("a body that stops coming is given up on too", async () => {
		const source = remoteIconSourceOf("git@github.com:acme/shop.git")!;
		const stalled = network((_url, init) => new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(8));
				init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
			},
		})));
		expect(await fetchRemoteIcon(source, stalled.fetcher, 50)).toEqual({ ok: false, outcome: "failed", message: "GitHub did not answer within 1 second." });
	});

	test("a repository whose origin is elsewhere, and a group, cannot take one", async () => {
		const { fetcher, asked } = network(() => new Response(body(avatar)));
		const { icons } = iconsOn({ fetch: fetcher });
		expect(await icons.set({ kind: "repository", path: noOrigin }, { kind: "remote" })).toEqual({ outcome: "refused", message: "This repository has no GitHub or Bitbucket remote named origin." });
		expect(await icons.set({ kind: "group", id: "work" }, { kind: "remote" })).toEqual({ outcome: "refused", message: "Only a repository can take its icon from a remote." });
		expect(asked).toHaveLength(0);
	});
});

describe("removing a repository or deleting a group", () => {
	const reader: RepositoryReader = {
		find: async () => ({ outcome: "not-a-repository" }),
		reload: async () => null,
	} as unknown as RepositoryReader;

	test("drops its icon in the same save, and keeps the others", async () => {
		const settings = createSettingsHolder(settingsFile, () => {});
		const icons = createSidebarIcons({ settings, pickFile: async () => null, environment: {} });
		const list = createRepositoryList({ settingsFile, settings, pickFolder: async () => null, reader, environment: {} });
		await icons.set({ kind: "repository", path: onGithub }, star);
		await icons.set({ kind: "repository", path: onBitbucket }, star);
		await icons.set({ kind: "group", id: "work" }, star);
		expect(await list.remove(onGithub)).toEqual({ outcome: "removed" });
		expect(saved().icons).toEqual({ repositories: { [onBitbucket]: star }, groups: { work: star } });
		expect(await list.deleteGroup("work")).toMatchObject({ outcome: "saved" });
		expect(saved().icons).toEqual({ repositories: { [onBitbucket]: star }, groups: {} });
		expect(await icons.list()).toEqual({ repositories: { [onBitbucket]: star }, groups: {} });
	});
});
