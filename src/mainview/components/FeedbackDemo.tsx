import { useState } from "react";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, failureOf, readTimberResult } from "../../shared/timber-result";
import { useSubmission } from "../store/react";
import type { SubmissionOutcome } from "../store/submission";
import { OperationDialog } from "./OperationDialog";

/**
 * A sample dialog for the browser build (`bun run dev:web`, with
 * ?feedback=demo in the address). It acts out `timber new` without running
 * anything, to show the parts every real dialog shares: the command before it
 * runs, the running state, a failure that keeps the dialog open, and the
 * toast after a success. The desktop app never loads it.
 */

const endings = {
	"succeeds": "Timber creates the worktree",
	"refused": "Timber refuses: the branch is checked out",
	"no-result": "Timber exits with 0 but leaves no result",
	"setup-fails": "The setup script fails after the worktree was created",
} as const;

type Ending = keyof typeof endings;

const isEnding = (value: string): value is Ending => Object.hasOwn(endings, value);

const RUN_MILLISECONDS = 1500;

/** What a run of the command would have come to, read exactly as the main process reads a real one. */
function actOut(name: string, ending: Ending, command: string): TimberRun {
	const path = `/work/timber-worktrees/${name.replaceAll(/[^A-Za-z0-9]+/g, "-")}`;
	const worktree = {
		path, canonicalPath: path, branch: name, head: "0000000000000000000000000000000000000000", isPrimary: false, detached: false,
		pathExists: true, locked: null, prunable: null, status: { kind: "known", modified: [], untracked: [], ignored: [] },
	};
	const record = (fields: object) => JSON.stringify({
		schemaVersion: 1, command: "new", outcome: "succeeded", exitCode: 0, materialized: true, diagnostic: null, worktree,
		repository: { commonGitDir: "/work/timber/.git", primaryWorktreeRoot: "/work/timber", currentWorktreeRoot: "/work/timber" },
		...fields,
	});
	const run = (text: string | null, exitCode: number, printed: string): TimberRun =>
		({ command, result: readTimberResult("new", text, exitCode), output: { text: printed, truncated: ending === "setup-fails" } });
	switch (ending) {
		case "succeeds":
			return run(record({}), 0, `Created ${name} at ${path}\n`);
		case "refused": {
			const diagnostic = `Branch ${name} is already checked out at ${path}. Use timber open instead.`;
			return run(record({ outcome: "failed", exitCode: 1, materialized: false, worktree: null, diagnostic }), 1, `error: ${diagnostic}\n`);
		}
		case "no-result":
			return run(null, 0, `Created ${name} at ${path}\n`);
		case "setup-fails": {
			const lines = Array.from({ length: 40 }, (_, index) => `  resolving package ${index + 61} of 100`).join("\n");
			const diagnostic = "Setup hook failed with exit code 1: bun install --frozen-lockfile";
			return run(record({ outcome: "failed", exitCode: 1, diagnostic }), 1, `${lines}\nerror: lockfile had changes, but lockfile is frozen\nerror: ${diagnostic}\n`);
		}
	}
}

export function FeedbackDemo() {
	const [open, setOpen] = useState(true);
	const [name, setName] = useState("feat/sample");
	const [ending, setEnding] = useState<Ending>("refused");
	const { submission, state } = useSubmission(() => setOpen(false));
	const branch = name.trim();
	const command = describeTimberCommand(["new", branch, "--result-file", RESULT_FILE_PLACEHOLDER, "--no-editor", "--no-agent"]);

	const run = () => submission.submit(async (): Promise<SubmissionOutcome> => {
		await new Promise(resolve => setTimeout(resolve, RUN_MILLISECONDS));
		const failure = failureOf(actOut(branch, ending, command));
		return failure ? { ok: false, failure } : { ok: true, toast: `Created ${branch}` };
	});

	if (!open) {
		return <button type="button" className="button demo-open" onClick={() => setOpen(true)}>Sample dialog</button>;
	}
	return (
		<OperationDialog
			title="New worktree (sample)"
			command={command}
			submission={state}
			submitLabel="Create worktree"
			runningLabel="Creating the worktree"
			failureTitle="Could not create the worktree"
			canSubmit={branch !== ""}
			onSubmit={() => void run()}
			onClose={() => setOpen(false)}
		>
			<label className="field">
				<span className="field-label">Name</span>
				<input
					className="field-input"
					value={name}
					autoFocus
					onChange={event => {
						setName(event.target.value);
						submission.clearFailure();
					}}
				/>
			</label>
			<label className="field">
				<span className="field-label">What happens (sample only, nothing is run)</span>
				<select
					className="field-input"
					value={ending}
					onChange={event => {
						if (isEnding(event.target.value)) setEnding(event.target.value);
						submission.clearFailure();
					}}
				>
					{Object.entries(endings).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
				</select>
			</label>
		</OperationDialog>
	);
}
