// Measures how long opening a terminal takes, from the request to the session
// being created, the way the main process wires it (see src/bun/index.ts):
// "before" asks only `RepositoryList.find`, which runs `timber ls` every time,
// and "after" asks the last listing first (`RepositoryList.findKnown`). Both
// start the person's own shell in a real pseudo terminal in the primary
// checkout, and close it again. The sidebar's read is done once first, and the
// repository's Git metadata is watched as the app watches it. Read-only: the
// settings file is a temporary one, and nothing in the repository is written.
//   bun scripts/measure-launch.ts <repository> [--runs 4] [--timber <path>]
// Without --timber, the pinned Timber from `bun run fetch:timber` is used when
// it is there, and the one on PATH otherwise.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRecentListings } from "../src/bun/recent-listings";
import { createRepositoryList } from "../src/bun/repository-list";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { createRepositoryWatcher } from "../src/bun/repository-watcher";
import { createTerminalSessions } from "../src/bun/terminals";
import { serializeSettings } from "../src/shared/settings";
import { TIMBER_PIN, timberExecutableName, timberTarget, vendorFolder } from "../src/shared/timber-pin";

function option(name: string): string | undefined {
	const at = process.argv.indexOf(name);
	return at === -1 ? undefined : process.argv[at + 1];
}

function pinnedTimber(): string | null {
	const target = timberTarget(process.platform, process.arch);
	if (target === null) return null;
	const path = resolve(import.meta.dir, "..", vendorFolder(TIMBER_PIN.version, target), timberExecutableName(target));
	return existsSync(path) ? path : null;
}

function run(executable: string, args: string[], cwd: string): string {
	const result = spawnSync(executable, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`${executable} ${args.join(" ")} failed: ${result.stderr}`);
	return result.stdout.trim();
}

const repositoryArgument = process.argv[2];
if (repositoryArgument === undefined || repositoryArgument.startsWith("--")) {
	console.error("Usage: bun scripts/measure-launch.ts <repository> [--runs 4] [--timber <path>]");
	process.exit(2);
}
const runs = Number(option("--runs") ?? 4);
const timber = option("--timber") ?? pinnedTimber() ?? Bun.which("timber");
if (timber === null) {
	console.error("No Timber: run `bun run fetch:timber`, or pass --timber.");
	process.exit(2);
}
const repository = resolve(repositoryArgument);
const commonDir = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], repository);
const version = run(timber, ["--version"], repository);

const settingsFolder = mkdtempSync(join(tmpdir(), "timber-app-measure-"));
const settingsFile = join(settingsFolder, "settings.json");
writeFileSync(settingsFile, serializeSettings({ repositories: [{ path: repository, commonDir }] }));

let reloads = 0;
const reader = createRepositoryReader(async () => ({ state: "ready", source: "path", path: timber, version }));
const counting = { find: reader.find, reload: (path: string) => (reloads += 1, reader.reload(path)) };
const watcher = createRepositoryWatcher({ onChange: path => listings.forget(path) });
const listings = createRecentListings(counting, { watching: path => watcher.watching(path) });
const repositories = createRepositoryList({ settingsFile, pickFolder: async () => null, reader: listings, environment: {} });
watcher.sync(await repositories.watchTargets());

// What the sidebar reads on start. Its first worktree is the primary checkout, as Timber names it.
const listed = await repositories.reload(repository);
const worktree = listed?.worktrees[0]?.path;
if (worktree === undefined) {
	console.error(`Timber listed no worktrees in ${repository}: ${listed?.failure ?? "not a repository"}`);
	process.exit(1);
}

const quiet = { onOutput: () => {}, onChange: () => {} };
const kinds = {
	before: createTerminalSessions({ findRepository: path => repositories.find(path), ...quiet }),
	after: createTerminalSessions({ findRepository: path => repositories.find(path), findKnownRepository: path => repositories.findKnown(path), ...quiet }),
};

console.log(`${process.platform} ${process.arch}, Bun ${Bun.version}, Timber ${version} at ${timber}`);
console.log(`${repository}: ${listed?.worktrees.length} worktrees`);
for (const [kind, sessions] of Object.entries(kinds)) {
	const times: number[] = [];
	const readsBefore = reloads;
	for (let index = 0; index < runs; index++) {
		const began = performance.now();
		const result = await sessions.open({ repository, worktree, cols: 80, rows: 24 });
		times.push(performance.now() - began);
		if (result.outcome !== "opened") {
			console.error(`${kind}: ${result.outcome}: ${"message" in result ? result.message : ""}`);
			process.exit(1);
		}
		await sessions.close(result.session.id);
	}
	const rounded = times.map(time => Math.round(time));
	console.log(`${kind}: ${rounded.join(", ")} ms (${Math.min(...rounded)} to ${Math.max(...rounded)}), timber ls runs: ${reloads - readsBefore}`);
}

for (const sessions of Object.values(kinds)) sessions.killAll();
watcher.stop();
rmSync(settingsFolder, { recursive: true, force: true });
process.exit(0);
