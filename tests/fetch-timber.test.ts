import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchPinnedTimber } from "../scripts/fetch-timber";
import type { TimberPin } from "../src/shared/timber-pin";

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

const files: Record<string, string> = {
	"timber-v9.9.9-linux-x64": "#!/bin/sh\necho 9.9.9\n",
	"timber-v9.9.9-windows-x64.exe": "MZ",
	LICENSE: "MIT License\n",
};
const pin: TimberPin = {
	version: "9.9.9",
	binaries: {
		"linux-x64": sha256(files["timber-v9.9.9-linux-x64"]!),
		"windows-x64": sha256(files["timber-v9.9.9-windows-x64.exe"]!),
		"darwin-arm64": "0".repeat(64),
		"darwin-x64": "0".repeat(64),
	},
	notices: { LICENSE: sha256(files.LICENSE!) },
};

let root: string;
let requested: string[];
const fetcher = (async (url: string | URL | Request) => {
	const href = String(url);
	requested.push(href);
	const name = href.split("/").at(-1)!;
	const body = files[name];
	return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
const quiet = () => {};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "fetch-timber-"));
	requested = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("fetchPinnedTimber", () => {
	test("downloads the binary and the notices of the pinned release, and makes the binary executable", async () => {
		const folder = await fetchPinnedTimber({ pin, target: "linux-x64", root, fetcher, log: quiet });
		expect(folder).toBe(join(root, "vendor/timber/v9.9.9/linux-x64"));
		expect(requested).toEqual([
			"https://github.com/Coding-M8s/timber/releases/download/v9.9.9/timber-v9.9.9-linux-x64",
			"https://github.com/Coding-M8s/timber/releases/download/v9.9.9/LICENSE",
		]);
		expect(readFileSync(join(folder, "timber"), "utf8")).toBe(files["timber-v9.9.9-linux-x64"]!);
		expect(readFileSync(join(folder, "LICENSE"), "utf8")).toBe(files.LICENSE!);
		if (process.platform !== "win32") expect(statSync(join(folder, "timber")).mode & 0o111).not.toBe(0);
	});

	test("names the Windows binary timber.exe", async () => {
		const folder = await fetchPinnedTimber({ pin, target: "windows-x64", root, fetcher, log: quiet });
		expect(readFileSync(join(folder, "timber.exe"), "utf8")).toBe("MZ");
	});

	test("fails on a binary whose checksum does not match, and keeps nothing of it", async () => {
		const wrong = { ...pin, binaries: { ...pin.binaries, "linux-x64": "f".repeat(64) } };
		await expect(fetchPinnedTimber({ pin: wrong, target: "linux-x64", root, fetcher, log: quiet })).rejects.toThrow("expects ffff");
		expect(existsSync(join(root, "vendor/timber/v9.9.9/linux-x64/timber"))).toBe(false);
	});

	test("fails on a notice whose checksum does not match", async () => {
		const wrong = { ...pin, notices: { LICENSE: "e".repeat(64) } };
		await expect(fetchPinnedTimber({ pin: wrong, target: "linux-x64", root, fetcher, log: quiet })).rejects.toThrow("LICENSE");
	});

	test("fails when the release has no such file", async () => {
		const missing = { ...pin, notices: { NOTICE: sha256("x") } };
		await expect(fetchPinnedTimber({ pin: missing, target: "linux-x64", root, fetcher, log: quiet })).rejects.toThrow("HTTP 404");
	});

	test("keeps files that already match, and replaces one that was changed", async () => {
		const folder = await fetchPinnedTimber({ pin, target: "linux-x64", root, fetcher, log: quiet });
		requested = [];
		await fetchPinnedTimber({ pin, target: "linux-x64", root, fetcher, log: quiet });
		expect(requested).toEqual([]);
		writeFileSync(join(folder, "timber"), "tampered");
		await fetchPinnedTimber({ pin, target: "linux-x64", root, fetcher, log: quiet });
		expect(requested).toHaveLength(1);
		expect(readFileSync(join(folder, "timber"), "utf8")).toBe(files["timber-v9.9.9-linux-x64"]!);
	});
});
