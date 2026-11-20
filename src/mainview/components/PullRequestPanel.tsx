import type { Repository, Worktree } from "../../shared/model";
import { pullRequestOf } from "../../shared/pull-requests";
import { NO_DESCRIPTION, OPEN_IN_BROWSER, RUN_STATUS_LABELS, describePullRequestTab } from "../pull-request-tab-format";
import { useAppState, useStore } from "../store/react";
import { IssueSection, issueOf } from "./IssueSummary";

/**
 * The Pull request tab: the selected worktree's pull request as Timber last
 * read it. Read-only. It runs no command; its only controls open links in
 * the browser, through the engine. It follows the store, so it changes
 * whenever the pull requests are read again. The worktree's linked issue,
 * when it has one, shows above the pull request in every state.
 */
export function PullRequestPanel({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const list = state.pullRequests[repository.path];
	const view = describePullRequestTab(list, pullRequestOf(list, worktree.path), worktree.branch);
	const issue = issueOf(state, worktree);

	if (view.kind !== "found") {
		const note = (
			<div className={`empty pull-tab-note ${view.kind}`}>
				<p className="empty-title">{view.title}</p>
				<p className="empty-text">{view.text}</p>
			</div>
		);
		return issue === null ? note : (
			<div className="pull-tab">
				<IssueSection issue={issue} />
				{note}
			</div>
		);
	}

	const pull = view.pullRequest;
	return (
		<div className="pull-tab">
			{issue && <IssueSection issue={issue} />}
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
