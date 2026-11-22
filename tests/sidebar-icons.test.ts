import { describe, expect, test } from "bun:test";
import {
	MAX_ICON_BYTES,
	MAX_ICON_PIXELS,
	NOT_AN_IMAGE,
	type SidebarIcon,
	describeBytes,
	describeRemoteIconAction,
	emptyIcons,
	fromBase64,
	groupIcon,
	imageIcon,
	readIcon,
	readIcons,
	remoteIconSourceOf,
	repositoryIcon,
	sniffImage,
	toBase64,
	withIcon,
} from "../src/shared/sidebar-icons";
import { parseSettings, serializeSettings } from "../src/shared/settings";
import { SAMPLE_AVATAR_PNG } from "../src/mainview/engine/mock-sidebar-icons";
import { png } from "./support/images";

/** The start of a JPEG: an APP0 segment, then a baseline frame of this size. Enough for the header to be read. */
function jpeg(width: number, height: number): Uint8Array {
	return new Uint8Array([
		0xff, 0xd8,
		0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
		0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00,
		0xff, 0xd9,
	]);
}

/** The start of a lossless WebP of this size. */
function webpLossless(width: number, height: number): Uint8Array {
	const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
	const bytes = new Uint8Array(30);
	bytes.set(new TextEncoder().encode("RIFF"), 0);
	bytes.set(new TextEncoder().encode("WEBPVP8L"), 8);
	bytes.set([0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 20);
	return bytes;
}

/** The start of a lossy WebP key frame of this size. */
function webpLossy(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(30);
	bytes.set(new TextEncoder().encode("RIFF"), 0);
	bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
	bytes.set([0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8], 23);
	return bytes;
}

/** The start of an extended WebP of this size. */
function webpExtended(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(30);
	bytes.set(new TextEncoder().encode("RIFF"), 0);
	bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
	bytes.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, (width - 1) >> 16, (height - 1) & 0xff, ((height - 1) >> 8) & 0xff, (height - 1) >> 16], 24);
	return bytes;
}

describe("sniffImage", () => {
	test("knows PNG, JPEG, and WebP by their first bytes, with their size", () => {
		expect(sniffImage(png(16, 20))).toEqual({ ok: true, type: "image/png", width: 16, height: 20 });
		expect(sniffImage(jpeg(64, 48))).toEqual({ ok: true, type: "image/jpeg", width: 64, height: 48 });
		expect(sniffImage(webpLossless(40, 30))).toEqual({ ok: true, type: "image/webp", width: 40, height: 30 });
		expect(sniffImage(webpLossy(33, 17))).toEqual({ ok: true, type: "image/webp", width: 33, height: 17 });
		expect(sniffImage(webpExtended(300, 200))).toEqual({ ok: true, type: "image/webp", width: 300, height: 200 });
		expect(sniffImage(fromBase64(SAMPLE_AVATAR_PNG)!)).toMatchObject({ ok: true, type: "image/png", width: 16, height: 16 });
	});

	test("refuses anything else, as not an image", () => {
		const text = new TextEncoder();
		for (const bytes of [
			new Uint8Array(),
			text.encode("just some text that is long enough to be read as a header"),
			text.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
			text.encode("GIF89a\x10\x00\x10\x00 and more bytes to fill it up"),
			png(16, 16).slice(0, 20),
			jpeg(16, 16).slice(0, 8),
			new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08]),
			webpLossy(16, 16).fill(0, 23, 26),
		]) {
			expect(sniffImage(bytes)).toEqual({ ok: false, message: NOT_AN_IMAGE });
		}
		expect(sniffImage(png(0, 16))).toEqual({ ok: false, message: NOT_AN_IMAGE });
	});

	test("refuses a big image clearly, by bytes or by pixels", () => {
		const big = new Uint8Array(MAX_ICON_BYTES + 1);
		big.set(png(16, 16));
		expect(sniffImage(big)).toEqual({ ok: false, message: "That image is 33 KB. An icon can be at most 32 KB." });
		expect(sniffImage(new Uint8Array(2_500_000))).toEqual({ ok: false, message: "That image is 2.4 MB. An icon can be at most 32 KB." });
		expect(sniffImage(jpeg(4000, 3000))).toEqual({ ok: false, message: `That image is 4000 by 3000 pixels. An icon can be at most ${MAX_ICON_PIXELS} pixels on a side.` });
		expect(sniffImage(png(MAX_ICON_PIXELS, MAX_ICON_PIXELS))).toMatchObject({ ok: true });
		expect(sniffImage(webpExtended(MAX_ICON_PIXELS + 1, 1))).toMatchObject({ ok: false });
	});

	test("says sizes as a person reads them", () => {
		expect(describeBytes(812)).toBe("812 bytes");
		expect(describeBytes(48 * 1024)).toBe("48 KB");
		expect(describeBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
	});
});

describe("base64", () => {
	test("round-trips bytes, and refuses text that is not base64", () => {
		const bytes = png(30, 30);
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
		expect(fromBase64("not base64!")).toBeNull();
		expect(fromBase64("abc")).toBeNull();
	});
});

describe("reading saved icons", () => {
	const image = imageIcon("file", png(16, 16));
	if (!image.ok) throw new Error("the sample image should be an icon");

	test("reads a bundled icon and an image, with the type its bytes have", () => {
		expect(readIcon({ kind: "bundled", name: "star" })).toEqual({ kind: "bundled", name: "star" });
		expect(readIcon({ ...image.icon, type: "image/jpeg" })).toEqual(image.icon);
		expect(readIcon({ kind: "image", source: "github", type: "image/png", data: SAMPLE_AVATAR_PNG })).toEqual({ kind: "image", source: "github", type: "image/png", data: SAMPLE_AVATAR_PNG });
	});

	test("drops one that cannot be read, or whose bytes are no icon", () => {
		for (const value of [
			null, "star", { kind: "bundled", name: "unicorn" }, { kind: "emoji", emoji: "x" },
			{ kind: "image", source: "somewhere", type: "image/png", data: SAMPLE_AVATAR_PNG },
			{ kind: "image", source: "file", type: "image/png", data: "%%%" },
			{ kind: "image", source: "file", type: "image/svg+xml", data: btoa("<svg><script>alert(1)</script></svg>") },
			{ kind: "image", source: "file", type: "image/png", data: toBase64(jpeg(4000, 4000)) },
		]) {
			expect(readIcon(value)).toBeNull();
		}
	});

	test("keeps only icons of listed repositories and groups, and drops the rest one by one", () => {
		const icons = readIcons({
			repositories: { "/work/timber": { kind: "bundled", name: "code" }, "/work/gone": { kind: "bundled", name: "star" }, "/work/api": { kind: "bundled", name: "nope" } },
			groups: { work: image.icon, gone: { kind: "bundled", name: "box" } },
		}, ["/work/timber", "/work/api"], ["work"]);
		expect(icons).toEqual({ repositories: { "/work/timber": { kind: "bundled", name: "code" } }, groups: { work: image.icon } });
		expect(readIcons("damaged", [], [])).toEqual(emptyIcons());
		expect(readIcons({ repositories: [], groups: 3 }, [], [])).toEqual(emptyIcons());
	});

	test("looks icons up safely, and sets and removes them", () => {
		const star: SidebarIcon = { kind: "bundled", name: "star" };
		const icons = withIcon(withIcon(emptyIcons(), { kind: "repository", path: "/work/timber" }, star), { kind: "group", id: "work" }, image.icon);
		expect(repositoryIcon(icons, "/work/timber")).toEqual(star);
		expect(repositoryIcon(icons, "__proto__")).toBeNull();
		expect(repositoryIcon(icons, "toString")).toBeNull();
		expect(groupIcon(icons, "work")).toEqual(image.icon);
		const removed = withIcon(icons, { kind: "repository", path: "/work/timber" }, null);
		expect(repositoryIcon(removed, "/work/timber")).toBeNull();
		expect(repositoryIcon(icons, "/work/timber")).toEqual(star);
	});
});

describe("icons in the settings file", () => {
	const one = { path: "/work/timber", commonDir: "/work/timber/.git" };
	const group = { id: "work", name: "Work" };
	const avatar: SidebarIcon = { kind: "image", source: "github", type: "image/png", data: SAMPLE_AVATAR_PNG };

	test("round-trip beside the repositories and groups", () => {
		const settings = { repositories: [{ ...one, group: "work" }], groups: [group], icons: { repositories: { [one.path]: avatar }, groups: { work: { kind: "bundled", name: "briefcase" } as SidebarIcon } } };
		const text = serializeSettings(settings);
		expect(JSON.parse(text).icons).toEqual({ repositories: { [one.path]: avatar }, groups: { work: { kind: "bundled", name: "briefcase" } } });
		expect(parseSettings(text)).toEqual(settings);
	});

	test("are left out of a file without any, so an older file stays as it was", () => {
		expect(JSON.parse(serializeSettings({ repositories: [one], icons: emptyIcons() }))).toEqual({ version: 1, repositories: [one] });
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [one] }))).toEqual({ repositories: [one] });
	});

	test("that cannot be read never make the file count as damaged", () => {
		for (const icons of [null, "x", [], { repositories: { [one.path]: { kind: "image", data: "!!" } } }, { repositories: { "/elsewhere": { kind: "bundled", name: "star" } } }]) {
			expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], icons }))).toEqual({ repositories: [one] });
		}
	});
});

describe("remoteIconSourceOf", () => {
	test("takes the owner's avatar of a github.com origin", () => {
		for (const url of ["https://github.com/Coding-M8s/timber-app.git", "git@github.com:Coding-M8s/timber-app.git", "ssh://git@github.com/Coding-M8s/timber-app"]) {
			expect(remoteIconSourceOf(`${url}\n`)).toEqual({ host: "github", owner: "Coding-M8s", name: "Coding-M8s/timber-app", url: "https://github.com/Coding-M8s.png?size=64" });
		}
	});

	test("takes the repository's own icon of a bitbucket.org origin, dropping a user name", () => {
		for (const url of ["https://bitbucket.org/acme/shop.git", "https://sam@bitbucket.org/acme/shop.git", "git@bitbucket.org:acme/shop.git", "ssh://git@bitbucket.org/acme/shop.git", "https://bitbucket.org/acme/shop"]) {
			expect(remoteIconSourceOf(`${url}\n`)).toEqual({ host: "bitbucket", name: "acme/shop", url: "https://bitbucket.org/acme/shop/avatar/64" });
		}
		expect(remoteIconSourceOf("https://bitbucket.org/acme/my.site.git")).toMatchObject({ name: "acme/my.site" });
	});

	test("takes nothing from another host, more than one URL, or a URL that is not a repository", () => {
		for (const stdout of [
			"", "https://gitlab.com/acme/shop.git", "https://github.com/acme/shop.git\nhttps://github.com/acme/other.git",
			"https://bitbucket.org/acme/shop.git\nhttps://bitbucket.org/acme/other.git", "https://bitbucket.org/acme", "https://bitbucket.org/acme/../x",
			"https://evil.example/bitbucket.org/acme/shop", "https://bitbucket.org.evil.example/acme/shop", "https://sam:secret@github.com/acme/shop",
		]) {
			expect(remoteIconSourceOf(stdout)).toBeNull();
		}
	});

	test("names the button by whose icon it is, or Refresh when that is the icon now", () => {
		const github = remoteIconSourceOf("git@github.com:acme/shop.git")!;
		const bitbucket = remoteIconSourceOf("git@bitbucket.org:acme/shop.git")!;
		expect(describeRemoteIconAction(github, null)).toBe("Use the GitHub avatar of acme");
		expect(describeRemoteIconAction(github, { kind: "bundled", name: "star" })).toBe("Use the GitHub avatar of acme");
		expect(describeRemoteIconAction(github, { kind: "image", source: "github", type: "image/png", data: "" })).toBe("Refresh the GitHub avatar");
		expect(describeRemoteIconAction(bitbucket, null)).toBe("Use the Bitbucket icon of acme/shop");
		expect(describeRemoteIconAction(bitbucket, { kind: "image", source: "bitbucket", type: "image/png", data: "" })).toBe("Refresh the Bitbucket icon");
		expect(describeRemoteIconAction(bitbucket, { kind: "image", source: "github", type: "image/png", data: "" })).toBe("Use the Bitbucket icon of acme/shop");
	});
});
