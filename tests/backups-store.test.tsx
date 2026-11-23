import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { cleanText, deleteCommandFor, describeBackupsProblem, describeCreated, formatBytes, restoreCommandFor } from "../src/mainview/backup-format";
import { DeleteBackupView, type DeleteBackupViewProps, RestoreBackupView, type RestoreBackupViewProps } from "../src/mainview/components/BackupDialogs";
import { sampleBackups } from "../src/mainview/engine/mock-backups";
import { createMockEngine, sampleRepositories, sampleStatesRepository, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { BACKUP_READ_SPACING_MS, createAppStore } from "../src/mainview/store/store";
import type { SubmissionState } from "../src/mainview/store/submission";
import type { Backup, BackupList } from "../src/shared/backups";
import type { TimberStatus } from "../src/shared/model";
import { manualClock } from "./support/clock";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const API = "/work/api-server";
const BILLING = "/work/billing";
const timberBackups = sampleBackups[TIMBER] as Extract<BackupList, { state: "listed" }>;
const [usable, protectedBackup, detached] = timberBackups.backups as [Backup, Backup, Backup];

async function startedStore(engine = createMockEngine([...sampleRepositories, sampleStatesRepository])) {
	const clock = manualClock();
	const store = createAppStore(engine, clock.schedule);
	store.start();
	await settle();
	return { store, engine, clock };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
/** The markup of one repository's group in the sidebar. */
function groupOf(markup: string, name: string): string {
	const opening = new RegExp(`<section class="group[^"]*"[^>]*aria-label="${name}"`).exec(markup);
	if (!opening) throw new Error(`No group for ${name}`);
	const start = opening.index;
	// A group holds the backups section, so it ends at the next group or the end of the list.
	const next = markup.slice(start + 1).search(/<section class="group[ "]/);
	const group = markup.slice(start, next === -1 ? markup.indexOf('class="sidebar-foot"', start) : start + 1 + next);
	if (!group.includes('class="rows"')) throw new Error(`The group for ${name} has no rows`);
	return group;
}

describe("the backups section", () => {
	test("shows each backup Timber listed with its branch, when it was made, its size, and Timber's reasons", async () => {
		const { store, engine } = await startedStore();
		expect(engine.backupReads(TIMBER)).toBe(1);
		const markup = render(store);
		expect(markup).toContain('class="backups-title"');
		expect(markup).toContain(">Backups</h3>");
		expect(markup).toContain('<span class="backup-branch">feat/github-issue-lookup</span>');
		expect(markup).toContain('<span class="backup-branch">detached HEAD</span>');
		expect(markup).toContain(`<span class="backup-detail">${describeCreated(usable.createdAt, Date.now()).text}, 46.0 MiB</span>`);
		expect(markup).toContain('<span class="backup-flag">protected</span><span class="backup-reason">its source worktree has a rebase in progress</span>');
		expect(markup).toContain('<span class="backup-flag">deletion unfinished</span>');
		expect(markup).toContain('<span class="backup-flag">not usable</span><span class="backup-reason">its private ref is missing</span>');
		expect(markup).toContain("Backups can hold copies of ignored files, such as .env, even after their worktree is gone.");
	});

	test("a protected backup offers Restore only, and other entries offer nothing", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		const actions = (label: string) => markup.split("aria-label=").filter(part => part.startsWith(`"${label}`)).length;
		expect(actions("Restore backup of")).toBe(3);
		expect(actions("Delete backup of")).toBe(2);
		expect(markup).not.toContain('aria-label="Delete backup of fix/macos-portability');
	});

	test("does not appear for a repository with no backups, or whose Timber has no backup list", async () => {
		const { store } = await startedStore();
		expect(store.getState().backups[API]).toEqual({ state: "listed", backups: [], unfinished: [], notUsable: [], totalBytes: 0 });
		expect(store.getState().backups[BILLING]).toEqual({ state: "unsupported" });
		const markup = render(store);
		expect(groupOf(markup, "api-server")).not.toContain("backups");
		expect(groupOf(markup, "billing")).not.toContain("backups");
		expect(groupOf(markup, "billing")).not.toContain("backups unknown");
	});

	test("a list that could not be read is a quiet word beside the name, never an empty section", async () => {
		const engine = createMockEngine();
		engine.setBackups(TIMBER, { state: "failed", message: "timber backup list --json failed: Backup storage is not private." });
		const { store } = await startedStore(engine);
		const markup = render(store);
		expect(markup).toContain('<span class="group-flag backups-failed" title="timber backup list --json did not say which backups there are. timber backup list --json failed: Backup storage is not private." aria-hidden="true">backups unknown</span>');
		expect(groupOf(markup, "timber")).not.toContain('class="backups"');
	});

	test("nothing is read while Timber is not ready", async () => {
		const { engine } = await startedStore(createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]));
		expect(engine.backupReads(TIMBER)).toBe(0);
	});

	test("a repository that is removed forgets its backups", async () => {
		const { store } = await startedStore();
		await store.removeRepository(TIMBER);
		await settle();
		expect(store.getState().backups[TIMBER]).toBeUndefined();
	});
});

describe("reading backups again", () => {
	test("after a change of the repository, at most once per spacing, and the last change is not missed", async () => {
		const { engine, clock } = await startedStore();
		engine.announceChange(TIMBER);
		await settle();
		expect(engine.backupReads(TIMBER)).toBe(2);
		engine.announceChange(TIMBER);
		await settle();
		engine.announceChange(TIMBER);
		await settle();
		expect(engine.backupReads(TIMBER)).toBe(2);
		clock.advance(BACKUP_READ_SPACING_MS);
		await settle();
		expect(engine.backupReads(TIMBER)).toBe(3);
		// Nothing more was asked for, so the next spacing reads nothing.
		clock.advance(BACKUP_READ_SPACING_MS);
		await settle();
		expect(engine.backupReads(TIMBER)).toBe(3);
	});

	test("a Timber without a backup list is asked again only on Refresh", async () => {
		const { store, engine } = await startedStore();
		expect(engine.backupReads(BILLING)).toBe(1);
		engine.announceChange(BILLING);
		await settle();
		expect(engine.backupReads(BILLING)).toBe(1);
		await store.refresh();
		await settle();
		expect(engine.backupReads(BILLING)).toBe(2);
	});

	test("another Timber found by Retry reads every repository's backups again", async () => {
		let timber: TimberStatus = sampleTimberStatuses.ready;
		const engine = createMockEngine([...sampleRepositories, sampleStatesRepository], () => timber);
		const { store } = await startedStore(engine);
		timber = { ...sampleTimberStatuses.ready, path: "/opt/timber/bin/timber" };
		await store.retryTimber();
		await settle();
		expect(engine.backupReads(BILLING)).toBe(2);
		expect(engine.backupReads(TIMBER)).toBe(2);
	});
});

describe("answers from a Timber that was replaced", () => {
	test("are dropped, and the new Timber is asked", async () => {
		let timber: TimberStatus = sampleTimberStatuses.ready;
		const engine = createMockEngine([...sampleRepositories, sampleStatesRepository], () => timber);
		const { store } = await startedStore(engine);
		// The old Timber is slow: its answer comes after the new one was found.
		const read = engine.readBackups;
		let release!: () => void;
		engine.readBackups = async path => {
			const answer = await read(path);
			if (path === BILLING && timber.state === "ready" && timber.path === sampleTimberStatuses.ready.path) await new Promise<void>(resolve => { release = resolve; });
			return answer;
		};
		void store.refresh();
		await settle();
		timber = { ...sampleTimberStatuses.ready, path: "/opt/timber/bin/timber" };
		engine.setBackups(BILLING, { state: "listed", backups: [usable], unfinished: [], notUsable: [], totalBytes: usable.bytes });
		await store.retryTimber();
		release();
		await settle();
		expect(store.getState().backups[BILLING]?.state).toBe("listed");
	});
});

describe("restoring and deleting through the store", () => {
	test("a restore that worked selects the recovery worktree", async () => {
		const { store } = await startedStore();
		const result = await store.restoreBackup({ repository: TIMBER, id: usable.id, destination: "/work/timber-recovery" });
		expect(result).toEqual({ outcome: "restored", worktree: "/work/timber-recovery", branch: `recovery/${usable.id}`, commit: usable.commit });
		const selected = store.getState().repositories[0]!.worktrees.find(worktree => worktree.id === store.getState().selection?.worktree);
		expect(selected?.path).toBe("/work/timber-recovery");
	});

	test("a partial restore is listed again but never selected, with Timber's cleanup commands", async () => {
		const { store, engine } = await startedStore();
		const before = store.getState().selection;
		engine.endBackupCommands("partial");
		const result = await store.restoreBackup({ repository: TIMBER, id: usable.id, destination: "/work/half done" });
		expect(result).toMatchObject({ outcome: "partial", remaining: { worktree: "/work/half done" }, cleanup: ["git worktree remove --force '/work/half done'", `git branch -D 'recovery/${usable.id}'`] });
		expect(store.getState().repositories[0]!.worktrees.some(worktree => worktree.path === "/work/half done")).toBe(true);
		expect(store.getState().selection).toEqual(before);
	});

	test("a delete removes only that backup and reads the list again", async () => {
		const { store, engine } = await startedStore();
		const result = await store.deleteBackup({ repository: TIMBER, id: usable.id, recordSha256: usable.recordSha256 });
		expect(result).toEqual({ outcome: "deleted" });
		expect(engine.backupReads(TIMBER)).toBe(2);
		const list = store.getState().backups[TIMBER];
		if (list?.state !== "listed") throw new Error("not listed");
		expect(list.backups.map(backup => backup.id)).toEqual([protectedBackup.id, detached.id]);
	});

	test("a protected backup, or one that changed, is refused and kept", async () => {
		const { store } = await startedStore();
		expect((await store.deleteBackup({ repository: TIMBER, id: protectedBackup.id, recordSha256: protectedBackup.recordSha256 })).outcome).toBe("refused");
		expect((await store.deleteBackup({ repository: TIMBER, id: usable.id, recordSha256: "0".repeat(64) })).outcome).toBe("refused");
		const list = store.getState().backups[TIMBER];
		expect(list?.state === "listed" && list.backups.length).toBe(3);
	});

	test("an engine that does not answer leaves the outcome unknown and the list read again", async () => {
		const { store, engine } = await startedStore();
		engine.deleteBackup = () => Promise.reject(new Error("bridge closed"));
		const result = await store.deleteBackup({ repository: TIMBER, id: usable.id, recordSha256: usable.recordSha256 });
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		expect(engine.backupReads(TIMBER)).toBe(2);
	});
});

const idle: SubmissionState = { running: false, failure: null };

function restore(change: Partial<RestoreBackupViewProps> = {}): string {
	return renderToStaticMarkup(
		<RestoreBackupView backup={usable} listed="same" destination="/work/timber-recovery-x" onDestination={() => {}} partial={null} ran={false} submission={idle} now={Date.now()} onSubmit={() => {}} onClose={() => {}} {...change} />,
	);
}

function remove(change: Partial<DeleteBackupViewProps> = {}): string {
	return renderToStaticMarkup(<DeleteBackupView backup={usable} listed="same" partial={null} ran={false} submission={idle} now={Date.now()} onSubmit={() => {}} onClose={() => {}} {...change} />);
}

/** What the dialog's footer shows, as React writes text. */
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;");

describe("the Restore dialog", () => {
	test("shows the backup and the exact command, worded from the arguments that run", () => {
		const markup = restore({ destination: "/work/my recovery" });
		expect(markup).toContain(`>Restore backup of feat/github-issue-lookup</h2>`);
		expect(markup).toContain(`<pre class="dialog-command" aria-label="Command that will run">${escaped(restoreCommandFor(usable.id, "/work/my recovery"))}</pre>`);
		expect(restoreCommandFor(usable.id, "/work/my recovery")).toBe(`timber backup restore --result-file <temporary file> -- ${usable.id} '/work/my recovery'`);
		expect(markup).toContain(`The new branch is recovery/${usable.id}.`);
		expect(markup).toContain("No setup script, editor, or agent runs.");
	});

	test("a folder that is not a whole path cannot be submitted", () => {
		const markup = restore({ destination: "recovered" });
		expect(markup).toContain('aria-invalid="true"');
		expect(markup).toContain('class="field-hint error">Give the whole path, such as /home/me/recovered.</span>');
		expect(markup).toMatch(/<button type="submit" class="button primary" data-reserve="[^"]*" disabled="">/);
	});

	test("a backup that left the list offers only Close", () => {
		const markup = restore({ listed: "gone" });
		expect(markup).toContain(">This backup is no longer listed</h2>");
		expect(markup).toContain(">Close</button>");
		expect(markup).not.toContain("Restore into");
	});

	test("a partial restore says what is left and shows Timber's commands whole", () => {
		const long = `/work/${"deep/".repeat(60)}recovery`;
		const markup = restore({
			partial: { worktree: long, branch: "recovery/x", cleanup: [`git worktree remove --force '${long}'`] },
			submission: { running: false, failure: { command: "timber backup restore", diagnostic: "No space left.", output: null } },
		});
		expect(markup).toContain(">The restore stopped part of the way</p>");
		expect(markup).toContain(`An incomplete recovery worktree is left at ${long}. Do not use it.`);
		expect(markup).toContain(`<pre class="dialog-command">git worktree remove --force ${escaped(`'${long}'`)}</pre>`);
	});
});

describe("the Delete dialog", () => {
	test("is destructive: Keep has the focus, and the command carries the digest the person saw", () => {
		const markup = remove();
		expect(markup).toContain(">Delete backup of feat/github-issue-lookup?</h2>");
		expect(markup).toContain('<button type="button" class="button quiet" autofocus="">Keep</button>');
		expect(markup).toContain('<button type="button" class="button danger" data-reserve="Delete\nRunning">Delete</button>');
		expect(markup).toContain(escaped(deleteCommandFor(usable)));
		expect(deleteCommandFor(usable)).toBe(`timber __app-backup delete --id ${usable.id} --record-sha256 ${usable.recordSha256} --result-file <temporary file>`);
	});

	test("a backup that changed or left the list offers only Close", () => {
		for (const listed of ["changed", "gone"] as const) {
			const markup = remove({ listed });
			expect(markup).toContain(">This backup changed</h2>");
			expect(markup).toContain('<button type="button" class="button danger" data-reserve="Delete\nRunning" disabled="">Delete</button>');
			expect(markup).toContain(">Close</button>");
		}
	});

	test("after a partial deletion it follows the result, not the list, and offers Delete again", () => {
		const remaining = { directory: "/work/timber/.git/timber/backups/.deleting-x", directoryState: "present" as const, files: 3, ref: "refs/timber/backups/x", refState: "removed" as const };
		const markup = remove({
			listed: "gone",
			ran: true,
			partial: { remaining, cleanup: ["rm -r '/work/timber/.git/timber/backups/.deleting-x'"] },
			submission: { running: false, failure: { command: "timber __app-backup delete", diagnostic: "Permission denied.", output: null } },
		});
		expect(markup).toContain(">Delete again</button>");
		expect(markup).toContain("The backup can no longer be restored.");
		expect(markup).toContain("Its folder /work/timber/.git/timber/backups/.deleting-x is still there with 3 files in it.");
		expect(markup).toContain("Its private ref refs/timber/backups/x is gone.");
		expect(markup).toContain(`<pre class="dialog-command">rm -r ${escaped("'/work/timber/.git/timber/backups/.deleting-x'")}</pre>`);
	});
});

describe("after a dialog ran its command", () => {
	test("a refusal that changed the list shows Timber's words, never Nothing was run", () => {
		const failure = { command: deleteCommandFor(usable), diagnostic: "Kept backup x: its record differs from the one that was confirmed; review it again. Nothing was deleted.", output: null };
		const markup = remove({ listed: "changed", ran: true, submission: { running: false, failure } });
		expect(markup).not.toContain("This backup changed");
		expect(markup).not.toContain("Nothing was run");
		expect(markup).toContain(">Timber kept the backup</p>");
		const restored = restore({ listed: "gone", ran: true, submission: { running: false, failure: { ...failure, diagnostic: "Backup x was not found." } } });
		expect(restored).not.toContain("no longer listed");
		expect(restored).toContain(">Could not restore the backup</p>");
	});
});

describe("backup words", () => {
	test("sizes, times, and text from elsewhere", () => {
		expect(formatBytes(12)).toBe("12 B");
		expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MiB");
		expect(describeCreated("not a time", 0)).toEqual({ text: "not a time", tooltip: "Made not a time" });
		expect(describeCreated("2026-11-18T10:00:00Z", Date.parse("2026-11-18T12:30:00Z")).text).toBe("2 hours ago");
		const long = "x".repeat(500);
		expect(cleanText(`a\u001b[31m${long}`)).toBe(`a�[31m${long}`);
		expect(describeBackupsProblem({ state: "unsupported" })).toBeNull();
		expect(describeBackupsProblem(undefined)).toBeNull();
	});
});
