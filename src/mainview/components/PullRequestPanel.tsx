import { type SubmitEvent, useEffect, useId } from "react";
import type { Repository, Worktree } from "../../shared/model";
import { pullRequestOf } from "../../shared/pull-requests";
import { BASE_HINT, CREATE_HEADING, CREATE_NOTE, CREATE_RUNNING, CREATE_SUBMIT, type PullRequestFields, issueMentionHint, type ReportedPullRequestView, type ReviewerFailuresView, type ReviewerSuggestion, pullRequestCommandFor, reviewerSuggestions } from "../pull-request-create-format";
import { NO_DESCRIPTION, OPEN_IN_BROWSER, RUN_STATUS_LABELS, describePullRequestTab } from "../pull-request-tab-format";
import { useAppState, useStore } from "../store/react";
import type { PullRequestForm } from "../store/state";
import { IssueSection, issueOf } from "./IssueSummary";
import { ReviewersField } from "./ReviewersField";
import { TimberFailureDetails } from "./TimberFailureDetails";

/**
 * The Pull request tab: the selected worktree's pull request as Timber last
 * read it. It follows the store, so it changes whenever the pull requests
 * are read again. The worktree's linked issue, when it has one, shows above
 * the pull request in every state.
 *
 * A worktree on a branch with no pull request yet gets a form that runs
 * `timber pr`, which publishes the branch and opens one. The form and its
 * run live in the store (`pullRequestForms`), so leaving the tab while
 * Timber runs loses nothing and cannot start a second run. Every other
 * control opens a link in the browser, through the engine.
 */
export function PullRequestPanel({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const list = state.pullRequests[repository.path];
	const view = describePullRequestTab(list, pullRequestOf(list, worktree.path), worktree.branch);
	const issue = issueOf(state, worktree);
	const form = state.pullRequestForms[worktree.id];
	const offersForm = view.kind === "none" && worktree.branch !== null;

	useEffect(() => {
		if (offersForm) store.startPullRequestForm(repository.path, worktree);
	}, [offersForm, store, repository.path, worktree]);

	if (view.kind !== "found") {
		// Reviewers the last run could not request show whatever the tab shows now: GitHub may not list the
		// pull request yet, or the pull requests may not be readable, and the toast alone does not name them.
		const failures = form?.reviewerFailures
			? <ReviewerFailures failures={form.reviewerFailures} onDismiss={() => store.dismissReviewerFailures(worktree.id)} />
			: null;
		if (offersForm && form) {
			return (
				<div className="pull-tab">
					{issue && <IssueSection issue={issue} />}
					{form.reported && <ReportedNote reported={form.reported} onOpen={() => void store.openLink(form.reported!.url)} />}
					{failures}
					{!form.reported && (
						<PullRequestFormView
							form={form}
							afterIssue={issue !== null}
							mentionHint={issueMentionHint(worktree.issue)}
							suggestions={reviewerSuggestions(list)}
							onChange={change => store.editPullRequestForm(worktree.id, change)}
							onSubmit={() => void store.createPullRequest(worktree.id)}
						/>
					)}
				</div>
			);
		}
		const note = (
			<div className={`empty pull-tab-note ${view.kind}`}>
				<p className="empty-title">{view.title}</p>
				<p className="empty-text">{view.text}</p>
			</div>
		);
		return issue === null && failures === null ? note : (
			<div className="pull-tab">
				{issue && <IssueSection issue={issue} />}
				{failures}
				{note}
			</div>
		);
	}

	const pull = view.pullRequest;
	const existed = form?.reported?.outcome === "exists" && form.reported.number === pull.number ? form.reported.note : null;
	const reviewerFailures = form?.reviewerFailures?.number === pull.number ? form.reviewerFailures : null;
	return (
		<div className="pull-tab">
			{issue && <IssueSection issue={issue} />}
			{existed && <p className="pull-tab-line pull-tab-existed" role="status">{existed}</p>}
			{reviewerFailures && <ReviewerFailures failures={reviewerFailures} onDismiss={() => store.dismissReviewerFailures(worktree.id)} />}
			<header className={issue ? "pull-tab-header after-issue" : "pull-tab-header"}>
				<div className="pull-tab-heading">
					<h2 className="pull-tab-title">{view.heading}</h2>
					<p className="pull-tab-meta">
						<span className={`pull-state ${pull.state}`}>{view.state}</span>
						<span>#{pull.number}</span>
						<span>{view.base}</span>
					</p>
				</div>
				<button type="button" className="button" title={view.openTitle} onClick={() => void store.openLink(pull.url)}>
					{OPEN_IN_BROWSER}
				</button>
			</header>

			<section className="pull-tab-section" aria-labelledby="pull-review">
				<h3 className="pull-tab-section-title" id="pull-review">Review</h3>
				<p className={view.review.warning ? "pull-tab-line failing" : "pull-tab-line"}>
					<span className="pull-tab-strong">{view.review.label}.</span> {view.review.sentence}
				</p>
				{view.reviewers.length > 0 && (
					<ul className="pull-reviewers">
						{view.reviewers.map((reviewer, index) => (
							<li key={`${index}\0${reviewer.name}`} className="pull-reviewer">
								<span className={reviewer.warning ? "pull-reviewer-state failing" : "pull-reviewer-state"}>{reviewer.state}</span>
								<span className="pull-reviewer-name" title={reviewer.name}>
									{reviewer.name}
									{reviewer.kind !== null && <span className="pull-reviewer-kind">{reviewer.kind}</span>}
								</span>
								{reviewer.url !== null && (
									<button type="button" className="text-button" title={reviewer.openTitle} onClick={() => void store.openLink(reviewer.url!)}>
										Open
									</button>
								)}
							</li>
						))}
					</ul>
				)}
				{view.reviewersNote !== null && <p className="pull-tab-line quiet">{view.reviewersNote}</p>}
			</section>

			<section className="pull-tab-section" aria-labelledby="pull-checks">
				<h3 className="pull-tab-section-title" id="pull-checks">Checks</h3>
				<p className={view.checks.warning ? "pull-tab-line failing" : "pull-tab-line"}>{view.checks.text}</p>
				{pull.checks.runs.length > 0 && (
					<ul className="pull-checks">
						{pull.checks.runs.map((run, index) => (
							<li key={`${index}\0${run.name}`} className="pull-check">
								<span className={`pull-check-status ${run.status}`}>{RUN_STATUS_LABELS[run.status]}</span>
								<span className="pull-check-name" title={run.name}>{run.name}</span>
								{run.url !== null && (
									<button type="button" className="text-button" title={`Open ${run.name} in the browser`} onClick={() => void store.openLink(run.url!)}>
										Open
									</button>
								)}
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="pull-tab-section" aria-labelledby="pull-description">
				<h3 className="pull-tab-section-title" id="pull-description">Description</h3>
				{/* Text from GitHub, shown as text: never rendered as markup. */}
				{pull.description === "" ? <p className="pull-tab-line quiet">{NO_DESCRIPTION}</p> : <div className="pull-description">{pull.description}</div>}
			</section>
		</div>
	);
}

/**
 * What Timber reported, until the pull requests read again list it: GitHub
 * can take a moment to list a pull request it just opened.
 */
function ReportedNote({ reported, onOpen }: { reported: ReportedPullRequestView; onOpen: () => void }) {
	const title = reported.outcome === "created" ? `Pull request #${reported.number} opened` : `Pull request #${reported.number} was already open`;
	return (
		<div className="pull-tab-reported" role="status">
			<p className="pull-tab-line"><span className="pull-tab-strong">{title}.</span> {reported.note ?? "It shows here once GitHub lists it, after the next read."}</p>
			<button type="button" className="button" title={`Open pull request #${reported.number} on GitHub in the browser`} onClick={onOpen}>{OPEN_IN_BROWSER}</button>
		</div>
	);
}

/**
 * The reviewers Timber could not request on the pull request it created or
 * found, each with Timber's reason. It shows with that pull request, below
 * what says it was opened or already open, so it never hides that, and
 * stays until put away or the next run.
 */
function ReviewerFailures({ failures, onDismiss }: { failures: ReviewerFailuresView; onDismiss: () => void }) {
	return (
		<div className="pull-tab-reviewer-failures" role="status">
			<ul className="pull-tab-failure-lines">
				{failures.lines.map((line, index) => <li key={`${index}\0${line}`} className="pull-tab-line failing">{line}</li>)}
			</ul>
			<button type="button" className="text-button" onClick={onDismiss}>Dismiss</button>
		</div>
	);
}

export interface PullRequestFormViewProps {
	form: PullRequestForm;
	/** The Issue section shows above, so the form starts with a hairline. */
	afterIssue: boolean;
	/** Which issue Timber mentions in the body (`issueMentionHint` of the saved link), shown under Description. Null for none. */
	mentionHint: string | null;
	/** The people and teams to offer in the Reviewers field. */
	suggestions: readonly ReviewerSuggestion[];
	onChange: (change: Partial<PullRequestFields>) => void;
	onSubmit: () => void;
}

/**
 * The form that opens a pull request with `timber pr`: title, description,
 * base, reviewers, and a draft switch, then the exact command, which follows what is
 * typed. It holds no state of its own. While Timber runs, everything is
 * disabled and a progress bar shows. A failure stays above the command, with
 * what Timber printed in a details area that starts closed, until a field
 * changes or the next run.
 */
export function PullRequestFormView({ form, afterIssue, mentionHint, suggestions, onChange, onSubmit }: PullRequestFormViewProps) {
	const headingId = useId();
	const { running, failure } = form;
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!running) onSubmit();
	};
	return (
		<form className={afterIssue ? "pull-create after-issue" : "pull-create"} aria-labelledby={headingId} aria-busy={running} onSubmit={submit}>
			<h2 id={headingId} className="pull-tab-title">{CREATE_HEADING}</h2>
			<p className="pull-tab-line quiet">{CREATE_NOTE}</p>
			<fieldset className="pull-create-fields" disabled={running}>
				<label className="field">
					<span className="field-label">Title</span>
					<input className="field-input" name="title" value={form.title} onChange={event => onChange({ title: event.target.value })} />
				</label>
				<label className="field">
					<span className="field-label">Description</span>
					<textarea className="field-input pull-create-body" name="body" rows={6} value={form.body} onChange={event => onChange({ body: event.target.value })} />
					{mentionHint && <span className="field-hint">{mentionHint}</span>}
				</label>
				<label className="field">
					<span className="field-label">Base</span>
					<input className="field-input mono" name="base" value={form.base} placeholder="Saved base" spellCheck={false} onChange={event => onChange({ base: event.target.value })} />
					<span className="field-hint">{BASE_HINT}</span>
				</label>
				<ReviewersField value={form.reviewers} suggestions={suggestions} disabled={running} onChange={reviewers => onChange({ reviewers })} />
				<label className="check">
					<input type="checkbox" role="switch" name="draft" checked={form.draft} onChange={event => onChange({ draft: event.target.checked })} />
					<span>Open as a draft</span>
				</label>
			</fieldset>
			{failure && <TimberFailureDetails title={failure.title} failure={failure.failure} />}
			{failure?.note && <p className="dialog-note">{failure.note}</p>}
			{running && (
				<div className="dialog-progress">
					<div className="progress" role="progressbar" aria-label={CREATE_RUNNING} />
					<p className="dialog-progress-text" role="status">{CREATE_RUNNING}</p>
				</div>
			)}
			<footer className="pull-create-foot">
				<pre className="dialog-command" aria-label="Command that will run">{pullRequestCommandFor(form.worktree, form)}</pre>
				<div className="dialog-buttons">
					<button type="submit" className="button primary" disabled={running}>{running ? CREATE_RUNNING : CREATE_SUBMIT}</button>
				</div>
			</footer>
		</form>
	);
}
