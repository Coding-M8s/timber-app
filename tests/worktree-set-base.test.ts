import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryList } from "../src/bun/repository-list";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { createWorktreeCommands } from "../src/bun/worktree-commands";
import type { TimberStatus } from "../src/shared/model";
import { satisfiesTimberVersion } from "../src/shared/timber-version";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, isolatedEnvironment, makeRepository, readyAt, realTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const ready = readyAt("0.1.4");

describe("WorktreeCommands.setBase, before anything runs", () => {
	const commands = createWorktreeCommands({
		// A Timber that would fail the test if it were ever asked for.
		timber: async (): Promise<TimberStatus> => {
			throw new Error("Timber was asked for");
		},
		isListed: async () => true,
		findRepository: async () => null,
	});

	test("an incomplete request runs nothing", async () => {
		for (const request of [
			{ repository: "/work/sample", worktree: "/work/sample-worktrees/feat", base: "" },
			{ repository: "/work/sample", worktree: "/work/sample-worktrees/feat", base: 3 },
			{ repository: "/work/sample", worktree: null, base: "origin/main" },
			null,
		]) {
			expect(await commands.setBase(request as never)).toEqual({
				outcome: "failed",
				ran: false,
				failure: { command: null, diagnostic: "The request for timber base is not complete. Nothing was run.", output: null },
			});
		}
	});

	test("a repository that is not in the list runs nothing", async () => {
		const result = await commands.setBase({ repository: "/work/sample", worktree: "/work/sample-worktrees/feat", base: "origin/main" });
		expect(result).toMatchObject({ outcome: "failed", ran: false, failure: { command: null, output: null } });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toEndWith("Nothing was run.");
	});
});

const recentTimber = realTimber !== null && satisfiesTimberVersion(Bun.spawnSync([realTimber, "--version"]).stdout.toString().trim().split(/\s+/).at(-1) ?? "", "0.1.4");

/**
 * Saving a base through the installed Timber, in a real repository. The
 * worktree's base is read back the way the app lists it.
 */
describe.skipIf(!recentTimber)("WorktreeCommands.setBase, with the installed Timber", () => {
	let work: string;
	let primary: string;
	let feat: string;
	let list: ReturnType<typeof createRepositoryList>;
	let commands: ReturnType<typeof createWorktreeCommands>;

	const listedBase = async () => (await list.find(primary))?.worktrees.find(worktree => worktree.path === feat)?.base;
	const metadata = () => join(primary, ".git", "worktrees", "feat", "timber", "base.json");

	beforeAll(async () => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-set-base-")));
		primary = join(work, "my sample");
		const scratch = join(work, "temporary");
		mkdirSync(scratch);
		const environment = isolatedEnvironment(work);
		makeRepository(work, "my sample");
		git(primary, "branch", "other");
		feat = join(work, "trees", "feat");
		git(primary, "worktree", "add", "-b", "feat", feat);

		const timber = async (): Promise<TimberStatus> => ready(realTimber!);
		list = createRepositoryList({
			settingsFile: join(work, "config", "timber-app", "settings.json"),
			pickFolder: async () => null,
			reader: createRepositoryReader(timber, environment),
			environment: {},
			warn: () => {},
		});
		expect((await list.addFolder(primary)).outcome).toBe("added");
		commands = createWorktreeCommands({ timber, isListed: path => list.includes(path), findRepository: path => list.find(path), environment, temporaryRoot: scratch });
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("a worktree with no saved base gets one, the list reads it back, and the files, the index, and the refs are left alone", async () => {
		expect(await listedBase()).toEqual({ kind: "unassigned" });
		// The worktree's files, its index as Git lists it, and the refs. Timber writes only its own metadata under .git.
		const before = { feat: fingerprint(feat), refs: git(primary, "for-each-ref") };
		const result = await commands.setBase({ repository: primary, worktree: feat, base: "refs/heads/main" });
		expect(result).toEqual({ outcome: "set", previous: { kind: "unassigned" }, current: { kind: "assigned", ref: "refs/heads/main" } });
		expect(await listedBase()).toEqual({ kind: "assigned", ref: "refs/heads/main" });
		expect({ feat: fingerprint(feat), refs: git(primary, "for-each-ref") }).toEqual(before);
	});

	test("a saved base is changed", async () => {
		const result = await commands.setBase({ repository: primary, worktree: feat, base: "refs/heads/other" });
		expect(result).toEqual({ outcome: "set", previous: { kind: "assigned", ref: "refs/heads/main" }, current: { kind: "assigned", ref: "refs/heads/other" } });
		expect(await listedBase()).toEqual({ kind: "assigned", ref: "refs/heads/other" });
	});

	test("a full commit hash is saved as a commit base, and the list still reads", async () => {
		const commit = git(primary, "rev-parse", "main").trim();
		const result = await commands.setBase({ repository: primary, worktree: feat, base: commit });
		expect(result).toEqual({ outcome: "set", previous: { kind: "assigned", ref: "refs/heads/other" }, current: { kind: "commit", commit } });
		expect(await listedBase()).toEqual({ kind: "commit", commit });
		expect((await commands.setBase({ repository: primary, worktree: feat, base: "refs/heads/other" })).outcome).toBe("set");
	});

	test("a refusal shows Timber's reason and leaves the files, the refs, and the saved base as they were", async () => {
		const before = { primary: fingerprint(primary), feat: fingerprint(feat), refs: git(primary, "for-each-ref"), saved: readFileSync(metadata(), "utf8") };
		const result = await commands.setBase({ repository: primary, worktree: feat, base: "refs/heads/nope" });
		expect(result).toMatchObject({
			outcome: "refused",
			failure: { command: expect.stringContaining("timber base --set refs/heads/nope --result-file <temporary file> -- "), diagnostic: "Local base is missing or invalid; choose a replacement with --set refs/heads/<branch>." },
		});
		expect({ primary: fingerprint(primary), feat: fingerprint(feat), refs: git(primary, "for-each-ref"), saved: readFileSync(metadata(), "utf8") }).toEqual(before);
		expect(await listedBase()).toEqual({ kind: "assigned", ref: "refs/heads/other" });
	});

	test("stale metadata, which Changes cannot use, is replaced", async () => {
		const stale = JSON.parse(readFileSync(metadata(), "utf8"));
		writeFileSync(metadata(), JSON.stringify({ ...stale, worktreePath: join(work, "elsewhere") }));
		expect(await listedBase()).toEqual({ kind: "invalid", reason: "stale" });
		const result = await commands.setBase({ repository: primary, worktree: feat, base: "refs/heads/main" });
		expect(result).toEqual({ outcome: "set", previous: { kind: "invalid", reason: "stale" }, current: { kind: "assigned", ref: "refs/heads/main" } });
		expect(await listedBase()).toEqual({ kind: "assigned", ref: "refs/heads/main" });
	});

	test("malformed metadata is refused, and stays as it was", async () => {
		writeFileSync(metadata(), "not json\n");
		const result = await commands.setBase({ repository: primary, worktree: feat, base: "refs/heads/other" });
		expect(result).toMatchObject({ outcome: "refused", failure: { diagnostic: expect.stringContaining("Saved base metadata is malformed or unreadable") } });
		expect(readFileSync(metadata(), "utf8")).toBe("not json\n");
		expect(await listedBase()).toEqual({ kind: "invalid", reason: "malformed" });
		// No result file is left behind.
		expect(readdirSync(join(work, "temporary"))).toEqual([]);
	});
});
