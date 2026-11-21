// Downloads the pinned Timber release for this platform into vendor/, where
// electrobun.config.ts copies it into the app, and checks every file against
// the SHA-256 in timber-pin.json. A file that does not match is deleted and
// the script exits with 1, so `bun run build` stops. Files already there that
// match are kept, so a second run downloads nothing.
//   bun scripts/fetch-timber.ts
// In GitHub Actions, `--add-to-path` also puts the folder on PATH for the
// steps after it, so the tests run the pinned Timber:
//   bun scripts/fetch-timber.ts --add-to-path
import { appendFile, chmod, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	TIMBER_PIN, type TimberPin, type TimberTarget, releaseBinaryName, releaseFileUrl, timberExecutableName, timberTarget, vendorFolder,
} from "../src/shared/timber-pin";

export interface FetchOptions {
	pin: TimberPin;
	target: TimberTarget;
	/** The repository root: the files go into `vendorFolder` under it. */
	root: string;
	fetcher?: typeof fetch;
	log?: (line: string) => void;
}

function sha256(bytes: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function readIfThere(path: string): Promise<Uint8Array | null> {
	try {
		return new Uint8Array(await readFile(path));
	} catch {
		return null;
	}
}

/** Download one release file to `path` unless it is there and matches `expected`. Throws on a mismatch, leaving no file. */
async function fetchFile(url: string, path: string, expected: string, fetcher: typeof fetch, log: (line: string) => void): Promise<void> {
	const existing = await readIfThere(path);
	if (existing !== null && sha256(existing) === expected) {
		log(`Kept ${path}, which matches the pin.`);
		return;
	}
	log(`Downloading ${url}`);
	const response = await fetcher(url, { redirect: "follow" });
	if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const found = sha256(bytes);
	if (found !== expected) {
		await rm(path, { force: true });
		throw new Error(`The SHA-256 of ${url} is ${found}, but timber-pin.json expects ${expected}. Nothing was kept.`);
	}
	const temporary = `${path}.${process.pid}.tmp`;
	await Bun.write(temporary, bytes);
	await rename(temporary, path);
}

/** Download and check the pinned Timber for `target`. Answers the folder it is in. */
export async function fetchPinnedTimber(options: FetchOptions): Promise<string> {
	const { pin, target, root, fetcher = fetch, log = console.log } = options;
	const folder = join(root, vendorFolder(pin.version, target));
	await mkdir(folder, { recursive: true });
	const executable = join(folder, timberExecutableName(target));
	await fetchFile(releaseFileUrl(pin.version, releaseBinaryName(pin.version, target)), executable, pin.binaries[target], fetcher, log);
	await chmod(executable, 0o755);
	for (const [name, sum] of Object.entries(pin.notices)) {
		await fetchFile(releaseFileUrl(pin.version, name), join(folder, name), sum, fetcher, log);
	}
	return folder;
}

if (import.meta.main) {
	const target = timberTarget(process.platform, process.arch);
	if (target === null) {
		console.log(`Timber publishes no binary for ${process.platform}-${process.arch}, so this build uses the timber on PATH.`);
	} else {
		try {
			const folder = await fetchPinnedTimber({ pin: TIMBER_PIN, target, root: join(import.meta.dir, "..") });
			console.log(`Timber ${TIMBER_PIN.version} for ${target} is in ${folder}.`);
			if (process.argv.includes("--add-to-path")) {
				const githubPath = process.env.GITHUB_PATH;
				if (!githubPath) throw new Error("--add-to-path is for GitHub Actions, and GITHUB_PATH is not set.");
				await appendFile(githubPath, `${folder}\n`);
			}
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	}
}
