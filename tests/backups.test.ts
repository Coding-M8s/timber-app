import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupCommands, readBackups } from "../src/bun/backups";
import { createRepositoryTurns } from "../src/bun/repository-turns";
import { windows } from "./support/runtime";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, isolatedEnvironment, makeRepository, readyAt, realTimber, recordedBackup, standInResultTimber, standInTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const ready = readyAt("0.1.2");

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-backups-")));
	// The working directory has a space and non-ASCII characters in it.
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("readBackups, with a stand-in Timber", () => {
	test("runs timber backup list --json in the repository and reads the record", async () => {
		const timber = standInTimber(root, "list", recordedBackup.list.usable, 0);
		const list = await readBackups(timber.path, folder);
		expect(list.state).toBe("listed");
		expect(readFileSync(join(timber.folder, "arguments"), "utf8").trim()).toBe("backup list --json");
		expect(readFileSync(join(timber.folder, "cwd"), "utf8").trim()).toBe(folder);
	});

	test("a Timber that cannot be started is a failure with the reason", async () => {
		const list = await readBackups(join(root, "no-such-timber"), folder);
		expect(list.state).toBe("failed");
		if (list.state === "failed") expect(list.message).toStartWith(`Could not run timber backup list --json in ${folder}`);
	});
});

// Skipped on Windows: these check POSIX permission bits of the private folders, and that `C:\recovered` is
// refused as a relative name, which on Windows is a whole path.
describe.skipIf(windows)("BackupCommands, with stand-ins", () => {
	const listed = (path: string) => Promise.resolve(path === folder);

	test("lists only for a repository in the app's list, and only while Timber is ready", async () => {
		const timber = standInTimber(root, "list-guard", recordedBackup.list.usable, 0);
		const commands = createBackupCommands({ timber: async () => ready(timber.path), isListed: listed });
		expect(await commands.list(join(root, "elsewhere"))).toEqual({ state: "failed", message: `${join(root, "elsewhere")} is not a repository in the app's list.` });
		expect(await commands.list("")).toEqual({ state: "failed", message: "The request for backups names no repository." });
		const notFound = createBackupCommands({ timber: async () => ({ state: "not-found", override: null }), isListed: listed });
		expect((await notFound.list(folder)).state).toBe("failed");
		expect((await commands.list(folder)).state).toBe("listed");
	});

	test("restore runs Timber with a result file and reads its record", async () => {
		const id = JSON.parse(recordedBackup.restore.restored).backupRestore.id as string;
		const scratch = join(root, "scratch-restore");
		mkdirSync(scratch);
		const timber = standInResultTimber(root, "restore", { result: recordedBackup.restore.restored });
		const commands = createBackupCommands({ timber: async () => ready(timber.path), isListed: listed, temporaryRoot: scratch });
		const result = await commands.restore({ repository: folder, id, destination: "/work/elsewhere" });
		expect(result).toMatchObject({ outcome: "restored", branch: `recovery/${id}` });
		const notes = timber.notes();
		expect(notes.arguments).toEqual(["backup", "restore", "--result-file", notes.resultFile!, "--", id, "/work/elsewhere"]);
		expect(notes.cwd).toBe(folder);
		expect(notes.resultFileExisted).toBe(false);
		expect(notes.folderMode).toBe(0o700);
	});

	test("restore refuses a folder that is not a whole path, and an incomplete request, before running anything", async () => {
		const timber = standInResultTimber(root, "restore-relative", { result: recordedBackup.restore.restored });
		const commands = createBackupCommands({ timber: async () => ready(timber.path), isListed: listed });
		const relative = await commands.restore({ repository: folder, id: "x", destination: "recovered" });
		expect(relative).toEqual({ outcome: "failed", ran: false, failure: { command: null, diagnostic: "The folder to restore into must be a whole path, such as /home/me/recovered, not recovered. Nothing was run.", output: null } });
		// A Windows path is a relative name here, and Timber would read it from the primary checkout.
		const drive = await commands.restore({ repository: folder, id: "x", destination: "C:\\recovered" });
		expect(drive).toMatchObject({ outcome: "failed", ran: false });
		const incomplete = await commands.restore({ repository: folder, id: "", destination: "/work/x" });
		expect(incomplete).toMatchObject({ outcome: "failed", ran: false });
		const notListed = await commands.restore({ repository: join(root, "elsewhere"), id: "x", destination: "/work/x" });
		expect(notListed).toMatchObject({ outcome: "failed", ran: false });
		expect(existsSync(join(root, "restore-relative", "notes.json"))).toBe(false);
	});

	test("delete passes the ID and the digest the person confirmed", async () => {
		const id = JSON.parse(recordedBackup.delete.deleted).backupDelete.id as string;
		const digest = "c".repeat(64);
		const timber = standInResultTimber(root, "delete", { result: recordedBackup.delete.deleted });
		const commands = createBackupCommands({ timber: async () => ready(timber.path), isListed: listed });
		expect(await commands.remove({ repository: folder, id, recordSha256: digest })).toEqual({ outcome: "deleted" });
		const notes = timber.notes();
		expect(notes.arguments).toEqual(["__app-backup", "delete", "--id", id, "--record-sha256", digest, "--result-file", notes.resultFile!]);
	});

	test("a delete that leaves no result is unknown, never deleted", async () => {
		const timber = standInResultTimber(root, "delete-none", { result: null, exitCode: 0, stdout: "Deleted backup.\n" });
		const commands = createBackupCommands({ timber: async () => ready(timber.path), isListed: listed });
		const result = await commands.remove({ repository: folder, id: "x", recordSha256: "c".repeat(64) });
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("what it did is unknown");
	});

	test("restore waits for the turn of other commands of the repository", async () => {
		const turns = createRepositoryTurns();
		const timber = standInResultTimber(root, "restore-turn", { result: recordedBackup.restore.refused, exitCode: 1 });
		const commands = createBackupCommands({ timber: async () => ready(timber.path), isListed: listed, turns });
		let release!: () => void;
		const order: string[] = [];
		const earlier = turns.inTurn(folder, () => new Promise<void>(resolve => {
			release = () => {
				order.push("earlier");
				resolve();
			};
		}));
		const id = JSON.parse(recordedBackup.restore.refused).backupRestore.id as string;
		const restore = commands.restore({ repository: folder, id, destination: "/work/x" }).then(result => {
			order.push("restore");
			return result;
		});
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(order).toEqual([]);
		release();
		await earlier;
		expect((await restore).outcome).toBe("refused");
		expect(order).toEqual(["earlier", "restore"]);
	});
});

/** Whether a Timber has `backup list --json`, the first with everything the app uses for backups. */
function hasBackupList(timber: string | null): boolean {
	if (timber === null) return false;
	const probe = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-probe-")));
	try {
		const result = Bun.spawnSync([timber, "backup", "list", "--json"], { cwd: probe, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000 });
		return result.stdout.toString().startsWith("{");
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

describe.skipIf(realTimber === null || hasBackupList(realTimber))("with an installed Timber that has no backup list", () => {
	test("the list is unsupported, so the section stays hidden", async () => {
		const repository = join(root, "old timber repo");
		git(root, "init", "-q", "-b", "main", repository);
		expect(await readBackups(realTimber!, repository)).toEqual({ state: "unsupported" });
	});
});

describe.skipIf(!hasBackupList(realTimber))("with an installed Timber that has backups, on a real repository", () => {
	let work: string;
	let primary: string;
	let feat: string;
	let environment: Record<string, string | undefined>;
	let commands: ReturnType<typeof createBackupCommands>;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-backups-real-")));
		primary = join(work, "my sample");
		feat = join(work, "trees", "feat");
		environment = isolatedEnvironment(work);
		makeRepository(work, "my sample", { "a.txt": "one\n" });
		git(primary, "worktree", "add", "-b", "feat", feat);
		// A synthetic secret, ignored, which a backup copies.
		writeFileSync(join(feat, ".gitignore"), ".env\n");
		writeFileSync(join(feat, ".env"), "TOKEN=not-a-real-token\n");
		writeFileSync(join(feat, "a.txt"), "changed\n");
		const made = Bun.spawnSync([realTimber!, "backup", "create", "feat"], { cwd: primary, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: environment });
		if (made.exitCode !== 0) throw new Error(`timber backup create failed: ${made.stderr.toString()}`);
		const temporaryRoot = join(work, "temporary");
		mkdirSync(temporaryRoot);
		commands = createBackupCommands({ timber: async () => ready(realTimber!), isListed: async path => path === primary, environment, temporaryRoot });
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("listing changes no file or ref", async () => {
		const before = fingerprint(primary);
		const list = await commands.list(primary);
		expect(fingerprint(primary)).toBe(before);
		expect(list.state).toBe("listed");
		if (list.state === "listed") expect(list.backups.map(backup => backup.branch)).toEqual(["feat"]);
	});

	test("restore makes the recovery worktree with the backed-up files, and delete removes only that backup", async () => {
		const list = await commands.list(primary);
		if (list.state !== "listed") throw new Error(list.state);
		const [backup] = list.backups;
		const destination = join(work, "recovered");
		const restored = await commands.restore({ repository: primary, id: backup!.id, destination });
		expect(restored).toMatchObject({ outcome: "restored", worktree: destination, branch: `recovery/${backup!.id}` });
		expect(readFileSync(join(destination, "a.txt"), "utf8")).toBe("changed\n");
		expect(readFileSync(join(destination, ".env"), "utf8")).toBe("TOKEN=not-a-real-token\n");
		expect(readFileSync(join(feat, "a.txt"), "utf8")).toBe("changed\n");

		// A digest of another state is refused and keeps the backup.
		const refused = await commands.remove({ repository: primary, id: backup!.id, recordSha256: "0".repeat(64) });
		expect(refused.outcome).toBe("refused");
		expect((await commands.list(primary)).state === "listed").toBe(true);

		const deleted = await commands.remove({ repository: primary, id: backup!.id, recordSha256: backup!.recordSha256 });
		expect(deleted).toEqual({ outcome: "deleted" });
		const after = await commands.list(primary);
		expect(after).toMatchObject({ state: "listed", backups: [], unfinished: [], notUsable: [] });
		// The recovery worktree and the source are untouched.
		expect(readFileSync(join(destination, "a.txt"), "utf8")).toBe("changed\n");
		expect(git(primary, "for-each-ref", "--format=%(refname)", "refs/timber")).toBe("");
	});
});
