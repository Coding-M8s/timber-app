import { useEffect, useRef, useState } from "react";
import { describeChanged, describeGenerateCommand } from "../../shared/generate-text";
import { CREATE_RUNNING, CREATE_SUBMIT, type PullRequestCreationFailure, pullRequestCommandFor } from "../pull-request-create-format";
import { GENERATE_FAILED, describeGenerating, describeLeftOut, describeUncommitted, generatorOf } from "../generate-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { DialogRequest } from "../store/state";
import type { SubmissionOutcome } from "../store/submission";
import { GeneratedNotices } from "./GenerateText";
import { OperationDialog } from "./OperationDialog";

type Draft =
	| { state: "writing" }
	| { state: "failed"; command: string | null; message: string }
	| { state: "written"; title: string; body: string; note: string };

/**
 * One click to a pull request: the agent writes its title and description,
 * then they show here, editable, with the exact `timber pr` command. Nothing
 * is published before the button. The text stays in the dialog until then:
 * Cancel stops the agent and leaves the Pull request tab's form as it was.
 * A failure of Timber stays in the dialog, and only a pull request that was
 * opened, or found open, closes it.
 */
export function GeneratePullRequestDialog({ request }: { request: Extract<DialogRequest, { kind: "generate-pull-request" }> }) {
	const store = useStore();
	const state = useAppState();
	const { submission, state: submissionState } = useSubmission(() => {
		store.closeDialog();
		store.showTab("pull-request");
	});
	const [draft, setDraft] = useState<Draft>({ state: "writing" });
	const [failed, setFailed] = useState<PullRequestCreationFailure | null>(null);
	const run = useRef<string | null>(null);
	const [by] = useState(() => {
		const choice = generatorOf(state);
		return choice.ok ? { name: choice.generator.setting.name, command: describeGenerateCommand(choice.generator) } : { name: "The agent", command: "" };
	});
	const form = state.pullRequestForms[request.worktree];
	const listed = state.repositories.find(candidate => candidate.path === request.repository)?.worktrees.some(candidate => candidate.id === request.worktree) === true;

	useEffect(() => {
		// Not in the same turn, so an effect that React runs twice starts one agent.
		const id = crypto.randomUUID();
		const timer = setTimeout(() => {
			run.current = id;
			void store.writePullRequest(request.repository, request.worktree, id).then(result => {
				if (run.current !== id) return;
				run.current = null;
				if (result.outcome === "generated" && result.text.kind === "pull-request") {
					const changed = result.changed.length === 0 ? "" : ` While it wrote, ${describeChanged(result.changed)} changed, so it may not fit what is there now.`;
					setDraft({ state: "written", title: result.text.title, body: result.text.body, note: `Written by ${by.name}. Nothing has been published. Cancel leaves the form as it was.${describeLeftOut(result.leftOut)}${changed}` });
				} else if (result.outcome === "failed") setDraft({ state: "failed", command: result.command, message: result.message });
				else setDraft({ state: "failed", command: null, message: result.outcome === "refused" ? result.message : "It was stopped." });
			});
		}, 0);
		return () => {
			clearTimeout(timer);
			if (run.current === id) {
				run.current = null;
				store.stopRun(id);
			}
		};
	}, [store, request.repository, request.worktree, by]);

	const written = draft.state === "written" ? draft : null;
	const command = written && form ? pullRequestCommandFor(form.worktree, { ...form, title: written.title, body: written.body }) : by.command;
	const uncommitted = state.changes?.worktree === request.worktree && state.changes.compared === "uncommitted" ? describeUncommitted(new Set((state.changes.files ?? []).map(file => file.path)).size) : null;
	const edit = (change: Partial<{ title: string; body: string }>) => {
		if (written) setDraft({ ...written, ...change });
		submission.clearFailure();
	};
	const publish = () => {
		if (!written) return;
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const shown = await store.createPullRequest(request.worktree, { announce: false, text: { title: written.title, body: written.body } });
			setFailed(shown?.failure ?? null);
			if (shown?.failure) return { ok: false, failure: shown.failure.failure };
			if (!shown) return { ok: false, failure: { command: null, diagnostic: "The pull request is already being created, or the worktree left the list. Nothing was run.", output: null } };
			return { ok: true, toast: shown.toast ?? `Pull request #${shown.reported?.number ?? ""} was already open` };
		});
	};
	const failureNote = failed?.note;

	return (
		<OperationDialog
			title={written ? "Open this pull request?" : "Writing the pull request"}
			command={command}
			submission={submissionState}
			submitLabel={CREATE_SUBMIT}
			runningLabel={CREATE_RUNNING}
			failureTitle={failed?.title ?? "The pull request was not opened"}
			{...(failureNote ? { failureNote: <p className="dialog-note">{failureNote}</p> } : {})}
			canSubmit={written !== null && listed && written.title.trim() !== ""}
			cancelLabel={draft.state === "failed" ? "Close" : "Cancel"}
			onSubmit={publish}
			onClose={() => store.closeDialog()}
		>
			{draft.state === "writing" && (
				<div className="dialog-progress">
					<div className="progress" role="progressbar" aria-label={describeGenerating(by.name, "pull-request")} />
					<p className="dialog-progress-text" role="status">{describeGenerating(by.name, "pull-request")} Nothing is published: you see it first.</p>
				</div>
			)}
			{draft.state === "failed" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">{GENERATE_FAILED["pull-request"]}</p>
					{draft.command !== null && <p className="sidebar-error-text"><code>{draft.command}</code></p>}
					<pre className="commit-output">{draft.message}</pre>
				</div>
			)}
			{written && (
				<>
					<p className="dialog-note">{written.note}</p>
					{uncommitted !== null && <p className="dialog-note">{uncommitted}</p>}
					<label className="field">
						<span className="field-label">Title</span>
						<input className="field-input" name="title" value={written.title} onChange={event => edit({ title: event.target.value })} />
					</label>
					<label className="field">
						<span className="field-label">Description</span>
						<textarea className="field-input pull-create-body" name="body" rows={9} value={written.body} onChange={event => edit({ body: event.target.value })} />
					</label>
					<GeneratedNotices text={`${written.title}\n${written.body}`} />
				</>
			)}
		</OperationDialog>
	);
}
