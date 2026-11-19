import { describe, expect, test } from "bun:test";
import {
	backupDeleteArguments, backupOf, backupRestoreArguments, defaultRestoreFolder, hasBackups, isAbsoluteFolder, readBackupDeleteResult, readBackupList, readBackupRestoreResult,
} from "../src/shared/backups";
import { RESULT_FILE_PLACEHOLDER, type ResultCommand, type TimberRun, describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { recordedBackup } from "./support/timber";

const output = { text: "printed", truncated: false };
function runOf(command: ResultCommand, text: string | null, exitCode: number | null): TimberRun {
	return { command: `timber ${command}`, result: readTimberResult(command, text, exitCode), output };
}
const edit = (text: string, change: (record: Record<string, any>) => void) => {
	const record = JSON.parse(text);
	change(record);
	return JSON.stringify(record);
};

describe("readBackupList", () => {
	test("reads every usable backup exactly as Timber recorded it", () => {
		const list = readBackupList(recordedBackup.list.usable, "", 0);
		expect(list.state).toBe("listed");
		if (list.state !== "listed") return;
		expect(list.backups.map(backup => backup.branch)).toEqual(["feat", "fix/zażółć", "main"]);
		const [feat] = list.backups;
		expect(feat!.id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
		expect(feat!.recordSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(feat!.worktreePath).toBe("/work/sample-worktrees/feat");
		expect(feat!.protection).toEqual({ protected: false });
		expect(list.unfinished).toEqual([]);
		expect(list.notUsable).toEqual([]);
		expect(list.totalBytes).toBe(list.backups.reduce((sum, backup) => sum + backup.bytes, 0));
	});

	test("keeps protected, unusable, and unfinished entries with Timber's reasons", () => {
		const list = readBackupList(recordedBackup.list.mixed, "", 0);
		if (list.state !== "listed") throw new Error(list.state);
		expect(list.backups.find(backup => backup.branch === "fix/zażółć")!.protection).toEqual({ protected: true, reason: "its source worktree has a rebase in progress" });
		expect(list.notUsable).toEqual([{ name: "stray", reason: "unrecognized entry in backup storage" }]);
		expect(list.unfinished).toHaveLength(1);
		expect(list.unfinished[0]!.directory).toStartWith("/work/sample/.git/timber/backups/.deleting-");
	});

	test("a failed record is a failure with Timber's diagnostic, never an empty list", () => {
		const list = readBackupList(recordedBackup.list.failed, "", 1);
		expect(list).toEqual({ state: "failed", message: "timber backup list --json failed: Not a Git repository: /work/notrepo" });
	});

	test("a Timber without the command is unsupported only in its exact shape", () => {
		expect(readBackupList("", recordedBackup.unknownCommand, 1)).toEqual({ state: "unsupported" });
		expect(readBackupList("", "error: unknown option '--json'\n", 1)).toEqual({ state: "unsupported" });
		// Commander may add a suggestion on a line of its own.
		expect(readBackupList("", "error: unknown command 'list'\n(Did you mean lost?)\n", 1)).toEqual({ state: "unsupported" });
		// Anything else that is not a record is a failure, so a crash never hides the section quietly.
		expect(readBackupList("", recordedBackup.unknownCommand, 2).state).toBe("failed");
		expect(readBackupList("x", recordedBackup.unknownCommand, 1).state).toBe("failed");
		expect(readBackupList("", "Segmentation fault\n", 1)).toEqual({ state: "failed", message: "timber backup list --json exited with code 1: Segmentation fault" });
		expect(readBackupList("", "", null)).toEqual({ state: "failed", message: "timber backup list --json did not exit by itself without saying why." });
	});

	test("refuses a record that does not agree with the process or the contract", () => {
		const cases: [string, number][] = [
			[recordedBackup.list.usable, 1],
			[edit(recordedBackup.list.usable, record => { record.schemaVersion = 2; }), 0],
			[edit(recordedBackup.list.usable, record => { record.outcome = "failed"; }), 0],
			[edit(recordedBackup.list.usable, record => { record.backups[0].recordSha256 = "ABC"; }), 0],
			[edit(recordedBackup.list.usable, record => { record.backups[0].bytes = -1; }), 0],
			[edit(recordedBackup.list.usable, record => { record.backups[0].protection = { protected: true, reason: null }; }), 0],
			[edit(recordedBackup.list.usable, record => { delete record.unfinished; }), 0],
			[edit(recordedBackup.list.usable, record => { record.totalBytes = "14"; }), 0],
			["", 0],
			["[]", 0],
		];
		for (const [text, exitCode] of cases) expect(readBackupList(text, "", exitCode).state).toBe("failed");
		expect(readBackupList(edit(recordedBackup.list.usable, record => { record.schemaVersion = 2; }), "", 0)).toEqual({
			state: "failed",
			message: "timber backup list --json answered with schema version 2, and this app reads version 1 only. Update Timber app, or install a Timber that matches it.",
		});
	});

	test("ignores expiry and fields it does not use, and keeps a creation time it cannot parse", () => {
		const text = edit(recordedBackup.list.usable, record => {
			record.backups[0].expiry = { kind: "days", days: 7 };
			record.backups[0].createdAt = "yesterday";
			record.extra = true;
		});
		const list = readBackupList(text, "", 0);
		if (list.state !== "listed") throw new Error(list.state);
		expect(list.backups[0]!.createdAt).toBe("yesterday");
	});

	test("hasBackups and backupOf", () => {
		const list = readBackupList(recordedBackup.list.usable, "", 0);
		const empty = readBackupList(edit(recordedBackup.list.failed, record => { record.outcome = "succeeded"; record.exitCode = 0; record.diagnostic = null; }), "", 0);
		expect(hasBackups(list)).toBe(true);
		expect(hasBackups(empty)).toBe(false);
		expect(hasBackups({ state: "unsupported" })).toBe(false);
		expect(hasBackups(undefined)).toBe(false);
		if (list.state !== "listed") throw new Error(list.state);
		expect(backupOf(list, list.backups[1]!.id)).toBe(list.backups[1]!);
		expect(backupOf(list, "nope")).toBeNull();
	});
});

describe("backup command arguments", () => {
	test("restore puts the ID and folder after --", () => {
		const args = backupRestoreArguments({ id: "20261119T014822Z-5795186f", destination: "/work/my folder" }, RESULT_FILE_PLACEHOLDER);
		expect(args).toEqual(["backup", "restore", "--result-file", "<temporary file>", "--", "20261119T014822Z-5795186f", "/work/my folder"]);
		expect(describeTimberCommand(args)).toBe("timber backup restore --result-file <temporary file> -- 20261119T014822Z-5795186f '/work/my folder'");
	});

	test("delete names one ID and its digest", () => {
		const digest = "a".repeat(64);
		expect(backupDeleteArguments({ id: "-x", recordSha256: digest }, "/tmp/r.json")).toEqual(["__app-backup", "delete", "--id", "-x", "--record-sha256", digest, "--result-file", "/tmp/r.json"]);
	});

	test("the default folder sits beside the primary checkout", () => {
		expect(defaultRestoreFolder("/code/app", "ID")).toBe("/code/app-recovery-ID");
		expect(defaultRestoreFolder("/code/app/", "ID")).toBe("/code/app-recovery-ID");
		expect(defaultRestoreFolder("/app", "ID")).toBe("/app-recovery-ID");
		expect(defaultRestoreFolder("C:\\code\\app", "ID")).toBe("C:\\code\\app-recovery-ID");
	});

	test("isAbsoluteFolder", () => {
		for (const path of ["/a", "C:\\a", "c:/a", "\\\\server\\share"]) expect(isAbsoluteFolder(path)).toBe(true);
		for (const path of ["a", "./a", "../a", "", "C:a"]) expect(isAbsoluteFolder(path)).toBe(false);
	});
});

describe("readBackupRestoreResult", () => {
	const restoredId = JSON.parse(recordedBackup.restore.restored).backupRestore.id as string;

	test("restored names the recovery worktree, branch, and commit", () => {
		const result = readBackupRestoreResult(runOf("backup-restore", recordedBackup.restore.restored, 0), restoredId);
		expect(result).toEqual({
			outcome: "restored",
			worktree: `/work/sample-recovery ${restoredId}`,
			branch: `recovery/${restoredId}`,
			commit: expect.stringMatching(/^[0-9a-f]{40}$/),
		});
	});

	test("refused keeps Timber's diagnostic and what it printed", () => {
		const result = readBackupRestoreResult(runOf("backup-restore", recordedBackup.restore.refused, 1), restoredId);
		expect(result.outcome).toBe("refused");
		if (result.outcome !== "refused") return;
		expect(result.failure.diagnostic).toStartWith("Destination already exists");
		expect(result.failure.output).toBe(output);
	});

	test("partial passes on what remains and the cleanup commands whole", () => {
		const text = edit(recordedBackup.restore.refused, record => {
			record.backupRestore = { ...record.backupRestore, result: "partial", remaining: { worktree: "/work/x", branch: `recovery/${restoredId}` }, cleanup: ["git worktree remove --force '/work/x'", `git branch -D 'recovery/${restoredId}'`] };
		});
		const result = readBackupRestoreResult(runOf("backup-restore", text, 1), restoredId);
		expect(result).toMatchObject({ outcome: "partial", remaining: { worktree: "/work/x", branch: `recovery/${restoredId}` }, cleanup: ["git worktree remove --force '/work/x'", `git branch -D 'recovery/${restoredId}'`] });
	});

	test("anything that does not agree is unknown, never a result", () => {
		const cases: [string | null, number][] = [
			[null, 1],
			[recordedBackup.restore.restored, 1],
			[edit(recordedBackup.restore.restored, record => { record.backupRestore.result = "refused"; }), 0],
			[edit(recordedBackup.restore.restored, record => { record.backupRestore.worktree = null; }), 0],
			[edit(recordedBackup.restore.restored, record => { record.backupRestore.cleanup = ["rm -r /"]; }), 0],
			[edit(recordedBackup.restore.refused, record => { record.backupRestore.worktree = "/work/y"; }), 1],
			[edit(recordedBackup.restore.refused, record => { record.backupRestore.remaining = { worktree: null, branch: null }; }), 1],
			[edit(recordedBackup.restore.refused, record => { record.backupRestore.result = "partial"; }), 1],
			[edit(recordedBackup.restore.restored, record => { record.outcome = "cancelled"; }), 0],
			[edit(recordedBackup.restore.restored, record => { delete record.backupRestore; }), 0],
		];
		for (const [text, exitCode] of cases) {
			const result = readBackupRestoreResult(runOf("backup-restore", text, exitCode), restoredId);
			expect(result).toMatchObject({ outcome: "failed", ran: true });
		}
	});

	test("a record about another backup is not used", () => {
		const result = readBackupRestoreResult(runOf("backup-restore", recordedBackup.restore.restored, 0), "20990101T000000Z-00000000");
		expect(result.outcome).toBe("failed");
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain(`it is about backup ${restoredId}`);
		// The ID is null only when Timber could not read it, and then the record still counts.
		const nullId = edit(recordedBackup.restore.refused, record => { record.backupRestore.id = null; });
		expect(readBackupRestoreResult(runOf("backup-restore", nullId, 1), "bad id").outcome).toBe("refused");
	});
});

describe("readBackupDeleteResult", () => {
	const idOf = (text: string) => JSON.parse(text).backupDelete.id as string;

	test("deleted, and refused for a protected or changed backup", () => {
		const deleted = recordedBackup.delete.deleted;
		expect(readBackupDeleteResult(runOf("backup-delete", deleted, 0), idOf(deleted))).toEqual({ outcome: "deleted" });
		for (const text of [recordedBackup.delete.protected, recordedBackup.delete.changed]) {
			const result = readBackupDeleteResult(runOf("backup-delete", text, 1), idOf(text));
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") expect(result.failure.diagnostic).toEndWith("Nothing was deleted.");
		}
	});

	test("partial reports the observed state and the manual commands", () => {
		const base = recordedBackup.delete.changed;
		const remaining = { directory: "/work/sample/.git/timber/backups/.deleting-x", directoryState: "present", files: 2, ref: "refs/timber/backups/x", refState: "removed" };
		const text = edit(base, record => { record.backupDelete = { ...record.backupDelete, result: "partial", remaining, cleanup: ["rm -r '/work/sample/.git/timber/backups/.deleting-x'"] }; });
		expect(readBackupDeleteResult(runOf("backup-delete", text, 1), idOf(base))).toMatchObject({ outcome: "partial", remaining, cleanup: ["rm -r '/work/sample/.git/timber/backups/.deleting-x'"] });
		const broken = edit(text, record => { record.backupDelete.remaining.refState = "gone"; });
		expect(readBackupDeleteResult(runOf("backup-delete", broken, 1), idOf(base))).toMatchObject({ outcome: "failed", ran: true });
	});

	test("a record for another command or backup is unknown", () => {
		const deleted = recordedBackup.delete.deleted;
		expect(readBackupDeleteResult(runOf("backup-delete", recordedBackup.restore.restored, 0), idOf(deleted))).toMatchObject({ outcome: "failed", ran: true });
		expect(readBackupDeleteResult(runOf("backup-delete", deleted, 0), "other")).toMatchObject({ outcome: "failed", ran: true });
		expect(readBackupDeleteResult(runOf("backup-delete", edit(deleted, record => { record.backupDelete.result = "refused"; }), 0), idOf(deleted))).toMatchObject({ outcome: "failed" });
	});
});
