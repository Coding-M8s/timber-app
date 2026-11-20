import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChops, readChopsFile } from "../src/bun/chops";
import { CHOPS_FILE_BYTES, type PersonalChop } from "../src/shared/chops";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

let root: string;
let primary: string;
let linked: string;
let bare: string;
let personal: PersonalChop[] = [];

const listed = (paths: string[]): Repository => ({
	path: primary, name: "sample", available: true, failure: null,
	setup: "repository",
	worktrees: paths.map(path => ({
		id: path, path, canonicalPath: path, branch: "main", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
	})),
});

const chops = () => createChops({
	findRepository: async path => path === primary ? listed([primary, linked, bare]) : null,
	personal: async () => personal,
});

const fileText = (chops: unknown[]) => `${JSON.stringify({ version: 1, chops }, null, "\t")}\n`;
const chopsFile = (worktree: string) => join(worktree, ".timber", "chops.json");

function writeChopsFile(worktree: string, text: string) {
	mkdirSync(join(worktree, ".timber"), { recursive: true });
	writeFileSync(chopsFile(worktree), text);
}

// Symbolic links and named pipes are part of what is tested.
describe.skipIf(windows)("reading a worktree's chops from real repositories", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-chops-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat");
		bare = join(root, "sample-worktrees", "bare");
		git(root, "init", "--initial-branch=main", primary);
		writeChopsFile(primary, fileText([
			{ name: "Test", kind: "command", text: "bun test" },
			{ name: "Review", kind: "prompt", text: "Review the diff", agent: "Claude Code" },
		]));
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Share chops");
		git(primary, "worktree", "add", "-b", "feat", linked);
		// A branch can change its chops.
		writeChopsFile(linked, fileText([{ name: "Lint", kind: "command", text: "bun run lint" }]));
		git(linked, "commit", "-am", "Other chops");
		git(primary, "worktree", "add", "-b", "bare", bare);
		rmSync(join(bare, ".timber"), { recursive: true });
		git(bare, "commit", "-am", "No chops");
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("lists the file's chops of each worktree's own branch, without changing a file or a ref", async () => {
		const before = fingerprint(primary);
		personal = [];
		const main = await chops().list({ repository: primary, worktree: primary });
		expect(main).toMatchObject({ outcome: "listed", file: { state: "read" }, path: chopsFile(primary), overridden: [] });
		expect(main.outcome === "listed" && main.chops.map(chop => [chop.name, chop.source])).toEqual([["Test", "repository-file"], ["Review", "repository-file"]]);
		const feat = await chops().list({ repository: primary, worktree: linked });
		expect(feat.outcome === "listed" && feat.chops.map(chop => chop.name)).toEqual(["Lint"]);
		expect(fingerprint(primary)).toBe(before);
	});

	test("a missing file lists only personal chops, and the .timber folder is not created", async () => {
		personal = [{ name: "Mine", kind: "command", text: "make", description: "", agent: null, repository: null }];
		const answer = await chops().list({ repository: primary, worktree: bare });
		expect(answer).toMatchObject({ outcome: "listed", file: { state: "missing" }, chops: [{ name: "Mine", source: "personal-every" }] });
		expect(existsSync(join(bare, ".timber"))).toBe(false);
	});

	test("merges personal chops, which win by name", async () => {
		personal = [{ name: "test", kind: "command", text: "bun test --watch", description: "", agent: null, repository: primary }];
		const answer = await chops().list({ repository: primary, worktree: primary });
		expect(answer.outcome === "listed" && answer.chops.map(chop => [chop.name, chop.source])).toEqual([["test", "personal-repository"], ["Review", "repository-file"]]);
		expect(answer.outcome === "listed" && answer.overridden).toEqual([{ name: "Test", kind: "command", text: "bun test", description: "", agent: null, source: "repository-file", by: "personal-repository" }]);
	});

	test("a change to the file shows on the next read, with nothing cached", async () => {
		personal = [];
		const path = chopsFile(linked);
		const original = readFileSync(path, "utf8");
		try {
			writeFileSync(path, fileText([{ name: "Format", kind: "command", text: "bun run format" }]));
			const answer = await chops().list({ repository: primary, worktree: linked });
			expect(answer.outcome === "listed" && answer.chops.map(chop => chop.name)).toEqual(["Format"]);
		} finally {
			writeFileSync(path, original);
		}
	});

	test("reading leaves the file's bytes and time unchanged", async () => {
		const path = chopsFile(primary);
		const bytes = readFileSync(path);
		const { mtimeMs } = statSync(path);
		await readChopsFile(primary);
		expect(readFileSync(path).equals(bytes)).toBe(true);
		expect(statSync(path).mtimeMs).toBe(mtimeMs);
	});

	test("a worktree Timber does not list, or a repository not in the list, reads nothing", async () => {
		expect(await chops().list({ repository: primary, worktree: join(root, "elsewhere") })).toMatchObject({ outcome: "not-listed", message: expect.stringContaining("No chops were read.") });
		expect(await chops().list({ repository: join(root, "other"), worktree: primary })).toMatchObject({ outcome: "not-listed" });
		expect(await chops().list({ repository: primary, worktree: "relative/path" })).toMatchObject({ outcome: "not-listed" });
	});

	describe("a file that cannot be used is damaged, and personal chops still work", () => {
		let odd: string;
		beforeAll(() => {
			odd = join(root, "odd");
			mkdirSync(odd);
		});
		const read = async (setUp: () => void) => {
			rmSync(join(odd, ".timber"), { recursive: true, force: true });
			setUp();
			return (await readChopsFile(odd)).file;
		};

		test("not JSON, a bad entry, or not UTF-8", async () => {
			expect(await read(() => writeChopsFile(odd, "{ nope"))).toEqual({ state: "damaged", message: "It is not JSON." });
			expect(await read(() => writeChopsFile(odd, fileText([{ name: "Lint", kind: "script", text: "x" }])))).toMatchObject({ state: "damaged", message: expect.stringContaining("Chop 1") });
			expect(await read(() => {
				mkdirSync(join(odd, ".timber"));
				writeFileSync(chopsFile(odd), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
			})).toEqual({ state: "damaged", message: "It is not UTF-8 text." });
		});

		test("too large", async () => {
			expect(await read(() => writeChopsFile(odd, " ".repeat(CHOPS_FILE_BYTES + 1)))).toEqual({ state: "damaged", message: `It is larger than ${CHOPS_FILE_BYTES / 1024} KB.` });
		});

		test("a symbolic link, to the file or to the folder, is never followed, and its target never quoted", async () => {
			const secret = join(root, "secret.txt");
			writeFileSync(secret, "Host secret.example.com");
			const viaFile = await read(() => {
				mkdirSync(join(odd, ".timber"));
				symlinkSync(secret, chopsFile(odd));
			});
			expect(viaFile).toEqual({ state: "damaged", message: "It is a symbolic link, so the app does not follow it." });
			const elsewhere = join(root, "elsewhere-timber");
			mkdirSync(elsewhere, { recursive: true });
			writeFileSync(join(elsewhere, "chops.json"), fileText([]));
			const viaFolder = await read(() => symlinkSync(elsewhere, join(odd, ".timber")));
			expect(viaFolder).toEqual({ state: "damaged", message: "The .timber folder is a symbolic link, so the app does not follow it." });
			expect(JSON.stringify([viaFile, viaFolder])).not.toContain("secret.example.com");
		});

		test("a folder or a named pipe in its place, without hanging", async () => {
			expect(await read(() => mkdirSync(chopsFile(odd), { recursive: true }))).toEqual({ state: "damaged", message: "It is not a regular file." });
			const pipe = await read(() => {
				mkdirSync(join(odd, ".timber"));
				const made = Bun.spawnSync(["mkfifo", chopsFile(odd)]);
				if (made.exitCode !== 0) throw new Error("mkfifo failed");
			});
			expect(pipe).toEqual({ state: "damaged", message: "It is not a regular file." });
		});

		test(".timber as a file means there is no chops file", async () => {
			expect(await read(() => writeFileSync(join(odd, ".timber"), "not a folder"))).toEqual({ state: "missing" });
		});
	});
});
