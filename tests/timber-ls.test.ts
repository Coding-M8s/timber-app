import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorktrees } from "../src/bun/timber-ls";
import { recorded, standInTimber } from "./support/timber";

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-ls-")));
	// The working directory has a space and non-ASCII characters in it.
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** A stand-in Timber that answers every call with this output and exit code. */
const answering = (name: string, output: string, exitCode: number) => standInTimber(root, name, output, exitCode);

describe("listWorktrees", () => {
	test("runs timber ls --json in the repository folder and reads the recorded list", async () => {
		const timber = answering("succeeds", recorded.succeeded, 0);
		const listing = await listWorktrees(timber.path, folder);
		expect(listing.ok).toBe(true);
		expect(listing.ok && listing.worktrees.length).toBe(7);
		expect(listing.ok && listing.repository.primaryWorktreeRoot).toBe("/work/sample");
		expect(readFileSync(join(timber.folder, "arguments"), "utf8").trim()).toBe("ls --json");
		expect(realpathSync(readFileSync(join(timber.folder, "cwd"), "utf8").trim())).toBe(folder);
	});

	test("works when the executable itself sits in a folder with spaces", async () => {
		const timber = answering("with spaces zażółć", recorded.succeeded, 0);
		expect((await listWorktrees(timber.path, folder)).ok).toBe(true);
	});

	test("a recorded failure is reported with Timber's diagnostic", async () => {
		const timber = answering("fails", recorded.failed, 1);
		expect(await listWorktrees(timber.path, folder)).toEqual({ ok: false, message: "Not a Git repository: /work/plain" });
	});

	test("a good list with a failing exit code is an error, not a list", async () => {
		const timber = answering("mismatch", recorded.succeeded, 1);
		const listing = await listWorktrees(timber.path, folder);
		expect(listing).toEqual({ ok: false, message: "timber ls --json exited with code 1, but its record says exit code 0. The list was not used." });
	});

	test("a failure record with a passing exit code is an error as well", async () => {
		const listing = await listWorktrees(answering("mismatch-other", recorded.failed, 0).path, folder);
		expect(listing.ok).toBe(false);
		expect(!listing.ok && listing.message).toContain("exited with code 0, but its record says exit code 1");
	});

	test("an unsupported schema version is an error", async () => {
		const later = recorded.succeeded.replace('"schemaVersion":1', '"schemaVersion":2');
		const listing = await listWorktrees(answering("later", later, 0).path, folder);
		expect(listing.ok).toBe(false);
		expect(!listing.ok && listing.message).toContain("schema version 2");
	});

	test("malformed or missing output is an error", async () => {
		const cut = await listWorktrees(answering("cut", recorded.succeeded.slice(0, 900), 0).path, folder);
		expect(cut.ok).toBe(false);
		expect(!cut.ok && cut.message).toContain("not valid JSON");
		const silent = await listWorktrees(answering("silent", "", 0).path, folder);
		expect(!silent.ok && silent.message).toContain("it printed nothing");
		const crashed = await listWorktrees(answering("crashed", "", 2).path, folder);
		expect(crashed.ok).toBe(false);
	});

	test("an executable or a folder that is not there is an error", async () => {
		const missing = await listWorktrees(join(root, "no-such", "timber"), folder);
		expect(missing.ok).toBe(false);
		expect(!missing.ok && missing.message).toContain("Could not run timber ls --json");
		const timber = answering("no-folder", recorded.succeeded, 0);
		expect((await listWorktrees(timber.path, join(root, "no-such-folder"))).ok).toBe(false);
	});
});
