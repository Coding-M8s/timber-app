import { describe, expect, test } from "bun:test";
import {
	DEFAULT_DONE_OPTIONS, describeDoneApply, describeDonePreview, doneApplyArguments, donePreviewArguments, previewMatchesOptions, readDonePreview,
} from "../src/shared/timber-done";
import { readTimberResult } from "../src/shared/timber-result";
import { recordedDone } from "./support/timber";

const { previews, results } = recordedDone;

/** The recorded preview with some fields replaced. */
const changed = (text: string, change: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(text), ...change });

/** The preview in a recording, which must be readable. */
function read(text: string) {
	const reading = readDonePreview(text);
	if (!reading.ok) throw new Error(reading.message);
	return reading.preview;
}

describe("readDonePreview, on what Timber 0.1.1 printed", () => {
	test("a clean worktree: the exact target, nothing to lose, and the options as Timber understood them", () => {
		const preview = read(previews.clean);
		expect(preview).toEqual({
			snapshot: "66f870d7280021141e1535816be88f94aea6679b4b7f46547f3c52bf1d1a4f53",
			expiresAt: preview.expiresAt,
			repository: { commonGitDir: "/work/sample/.git", primaryWorktreeRoot: "/work/sample" },
			worktree: {
				path: "/work/sample-worktrees/feat-clean", canonicalPath: "/work/sample-worktrees/feat-clean", branch: "feat/clean",
				head: "55b48391fde512130fc1b1ba59c7a055efab623f", primary: false, detached: false, locked: false, prunable: false, pathExists: true,
				changes: { kind: "known", modified: [], untracked: [] },
				base: null,
				issue: null,
			},
			ignored: [],
			options: { keepBranch: false, discardIgnored: true, base: null },
		});
		expect(Number.isSafeInteger(preview.expiresAt)).toBe(true);
	});

	test("a dirty worktree: modified, staged, renamed, untracked, and ignored files, with spaces and non-ASCII names", () => {
		const preview = read(previews.dirty);
		expect(preview.worktree.changes).toEqual({
			kind: "known",
			modified: ["new name.txt", "staged.txt", "tracked.txt"],
			untracked: ["notes zażółć.txt", "src/deep/new.ts"],
		});
		expect(preview.ignored).toEqual(["build/app.js", "debug.log"]);
	});

	test("ignored files alone are listed apart from the files that changed", () => {
		const preview = read(previews.ignored);
		expect(preview.worktree.changes).toEqual({ kind: "known", modified: [], untracked: [] });
		expect(preview.ignored).toEqual(["debug.log"]);
	});

	test("the options come back as Timber understood them", () => {
		expect(read(previews.keepBranch).options).toEqual({ keepBranch: true, discardIgnored: true, base: null });
		expect(read(previews.base).options).toEqual({ keepBranch: false, discardIgnored: true, base: "main" });
		expect(read(previews.everyOption).options).toEqual({ keepBranch: true, discardIgnored: false, base: "main" });
	});

	test("every set of options has its own snapshot", () => {
		const snapshots = [previews.clean, previews.keepBranch, previews.base, previews.everyOption].map(text => read(text).snapshot);
		expect(new Set(snapshots).size).toBe(4);
	});

	test("a detached HEAD has no branch", () => {
		expect(read(previews.detached).worktree).toMatchObject({ branch: null, detached: true, head: "55b48391fde512130fc1b1ba59c7a055efab623f" });
	});

	test("a commit that exists nowhere else is not mentioned by the preview", () => {
		const preview = read(previews.unpublished);
		expect(preview.worktree.changes).toEqual({ kind: "known", modified: [], untracked: [] });
		expect(Object.keys(JSON.parse(previews.unpublished)).sort()).toEqual(["expiresAt", "options", "repository", "schemaVersion", "snapshot", "worktree"]);
	});

	test("fields this app does not use are ignored", () => {
		const record = JSON.parse(previews.dirty);
		record.later = { anything: true };
		record.worktree.sessions = [];
		record.options.later = 1;
		expect(read(JSON.stringify(record))).toEqual(read(previews.dirty));
	});
});

describe("readDonePreview, on anything else", () => {
	const message = (text: string) => {
		const reading = readDonePreview(text);
		return reading.ok ? null : reading.message;
	};

	test("nothing, text, and a cut record are not previews", () => {
		expect(message("")).toContain("it printed nothing");
		expect(message("Removed worktree\n")).toContain("not valid JSON");
		expect(message(previews.dirty.slice(0, 300))).toContain("not valid JSON");
		expect(message("[]")).toContain("not a JSON object");
		expect(message("null")).toContain("not a JSON object");
	});

	test("another schema version is refused whatever else it holds", () => {
		expect(message(changed(previews.clean, { schemaVersion: 2 }))).toBe(
			"timber __ide-done preview answered with schema version 2, and this app reads version 1 only. Update Timber app, or install a Timber that matches it.",
		);
		const { schemaVersion: _, ...without } = JSON.parse(previews.clean);
		expect(message(JSON.stringify(without))).toContain("schema version none");
	});

	test("a preview is used only as a whole", () => {
		const record = () => JSON.parse(previews.dirty);
		const without = (remove: (value: ReturnType<typeof record>) => void) => {
			const value = record();
			remove(value);
			return message(JSON.stringify(value));
		};
		expect(message(changed(previews.clean, { snapshot: "abc" }))).toContain("no snapshot");
		expect(message(changed(previews.clean, { snapshot: 5 }))).toContain("no snapshot");
		expect(message(changed(previews.clean, { expiresAt: "soon" }))).toContain("when it expires");
		expect(message(changed(previews.clean, { expiresAt: 1.5 }))).toContain("when it expires");
		expect(message(changed(previews.clean, { repository: null }))).toContain("which repository");
		expect(without(value => delete value.repository.currentWorktreeRoot)).toContain("which repository");
		expect(message(changed(previews.clean, { worktree: null }))).toContain("not a worktree record");
		expect(without(value => delete value.worktree.path)).toContain("not a worktree record");
		expect(without(value => { value.worktree.canonicalPath = null; })).toContain("not a worktree record");
		expect(without(value => { value.worktree.status = { kind: "unknown", reason: "Worktree path is missing" }; })).toContain("does not list the files");
		expect(without(value => delete value.worktree.status.ignored)).toContain("ignored files");
		expect(without(value => { value.worktree.status.ignored = [1]; })).toContain("ignored files");
		expect(without(value => { value.worktree.status.modified = "tracked.txt"; })).toContain("not a worktree record");
		expect(without(value => delete value.options)).toContain("which options");
		expect(without(value => { value.options.keepBranch = "no"; })).toContain("which options");
		expect(without(value => delete value.options.discardIgnored)).toContain("which options");
		expect(without(value => { value.options.base = 3; })).toContain("base is not text");
	});

	test("a result file is not a preview", () => {
		expect(message(results.removed)).toContain("no snapshot");
	});
});

describe("the commands", () => {
	const path = "/work/sample-worktrees/feat x";

	test("the preview takes the registered path after --, and one flag per option", () => {
		expect(donePreviewArguments(path, DEFAULT_DONE_OPTIONS)).toEqual(["__ide-done", "preview", "--", path]);
		expect(donePreviewArguments(path, { keepBranch: true, keepIgnored: true, base: "main" }))
			.toEqual(["__ide-done", "preview", "--keep-branch", "--keep-ignored", "--base=main", "--", path]);
	});

	test("a base cannot be read as another option", () => {
		expect(donePreviewArguments(path, { ...DEFAULT_DONE_OPTIONS, base: "--keep-branch" })).toEqual(["__ide-done", "preview", "--base=--keep-branch", "--", path]);
	});

	test("the removal names its two files and the same path, and repeats no option", () => {
		expect(doneApplyArguments("/tmp/a/approval.json", "/tmp/a/result.json", path))
			.toEqual(["__ide-done", "apply", "--approval-file", "/tmp/a/approval.json", "--result-file", "/tmp/a/result.json", "--", path]);
	});

	test("both are shown as they run, with placeholders for the temporary files", () => {
		expect(describeDonePreview(path, { keepBranch: true, keepIgnored: false, base: "release 1" }))
			.toBe("timber __ide-done preview --keep-branch '--base=release 1' -- '/work/sample-worktrees/feat x'");
		expect(describeDoneApply(path)).toBe("timber __ide-done apply --approval-file <approved preview> --result-file <temporary file> -- '/work/sample-worktrees/feat x'");
	});

	test("a preview matches only the options it was made for", () => {
		const preview = read(previews.everyOption);
		const options = { keepBranch: true, keepIgnored: true, base: "main" };
		expect(previewMatchesOptions(preview, options)).toBe(true);
		expect(previewMatchesOptions(preview, { ...options, keepBranch: false })).toBe(false);
		expect(previewMatchesOptions(preview, { ...options, keepIgnored: false })).toBe(false);
		expect(previewMatchesOptions(preview, { ...options, base: null })).toBe(false);
		expect(previewMatchesOptions(read(previews.clean), DEFAULT_DONE_OPTIONS)).toBe(true);
	});
});

describe("readTimberResult, on the result files of the removal", () => {
	test("removed: the record holds the worktree as it was before it was deleted", () => {
		const result = readTimberResult("done", results.removed, 0);
		expect(result).toMatchObject({ outcome: "succeeded", record: { materialized: false, worktree: { path: "/work/sample-worktrees/feat-dirty", pathExists: true } } });
	});

	test("a change after the preview is a failure with Timber's diagnostic", () => {
		expect(readTimberResult("done", results.changed, 1)).toMatchObject({
			outcome: "failed",
			diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing.",
		});
	});

	test("an approval for another worktree, and the primary checkout, are failures", () => {
		expect(readTimberResult("done", results.otherTarget, 1)).toMatchObject({ outcome: "failed", diagnostic: "Cleanup preview expired or target changed. Review the worktree again." });
		expect(readTimberResult("done", results.primary, 1)).toMatchObject({
			outcome: "failed",
			diagnostic: "Select an existing linked worktree; the primary worktree cannot be removed.",
			record: { worktree: null },
		});
	});

	test("a partial failure says that the folder is gone and the branch is not", () => {
		const result = readTimberResult("done", results.partial, 1);
		expect(result.outcome === "failed" && result.diagnostic).toBe(
			"The worktree was removed from /work/sample-worktrees/feat-partial, but local branch partial/branch was not deleted: Could not conditionally delete local branch partial/branch. Local branch partial/branch was retained at 55b48391fde512130fc1b1ba59c7a055efab623f. Inspect the branch and retry cleanup.",
		);
	});
});
