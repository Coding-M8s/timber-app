import type { Worktree } from "../../shared/model";
import { type IssueDescription, TRACKER_NAMES, describeIssue } from "../issue-format";
import type { AppState } from "../store/state";
import { useStore } from "../store/react";

/**
 * The description of a worktree's issue, or null when it has none. Not a
 * hook, so a component may call it after an early return.
 */
export function issueOf(state: AppState, worktree: Worktree): IssueDescription | null {
	return describeIssue(worktree.issue, state.issues[worktree.id]);
}

/**
 * The issue in the workspace header: its key and status as a link that opens
 * it in the browser, and a quiet word beside it when the status could not be
 * read. Link metadata Timber cannot use is said as a warning, with no link.
 */
export function IssueHeaderLink({ issue }: { issue: IssueDescription }) {
	const store = useStore();
	const { url, openTitle } = issue;
	return (
		<>
			{url === null || openTitle === null ? (
				<span className={issue.warning ? "saved-base-warning" : undefined} title={issue.sentence}>{issue.text}</span>
			) : (
				<button
					type="button"
					className={issue.category === null ? "issue-link" : `issue-link ${issue.category}`}
					title={issue.sentence}
					aria-label={`${issue.sentence} ${openTitle}.`}
					onClick={() => void store.openLink(url)}
				>
					{issue.text}
				</button>
			)}
			{issue.problem !== null && <span className="pull-problem" title={issue.sentence}>{issue.problem}</span>}
		</>
	);
}

/**
 * The issue above the pull request in the Pull request tab: tracker, key,
 * status, title, and assignee when Timber read them, with Open in browser.
 * When the status could not be read, the key and a quiet reason show
 * instead. Text from the tracker is shown as text only.
 */
export function IssueSection({ issue }: { issue: IssueDescription }) {
	const store = useStore();
	const { url, openTitle } = issue;
	const found = issue.issue;
	return (
		<section className="pull-tab-section issue-section" aria-labelledby="issue-heading">
			<h3 className="pull-tab-section-title" id="issue-heading">Issue</h3>
			<div className="issue-section-body">
				<div className="pull-tab-heading">
					{found ? (
						<>
							<p className="pull-tab-line"><span className="pull-tab-strong">{found.title}</span></p>
							<p className="pull-tab-meta">
								<span>{TRACKER_NAMES[found.tracker]} {issue.text}</span>
								<span>{found.assignee === null ? "Unassigned" : found.assignee}</span>
							</p>
						</>
					) : (
						<p className={issue.warning ? "pull-tab-line failing" : "pull-tab-line"}>
							<span className="pull-tab-strong">{issue.text}</span>
							{issue.problem !== null && <span className="pull-problem">, {issue.problem}</span>}
							{" "}
							<span className="quiet">{issue.sentence}</span>
						</p>
					)}
				</div>
				{url !== null && openTitle !== null && (
					<button type="button" className="button" title={openTitle} onClick={() => void store.openLink(url)}>
						Open in browser
					</button>
				)}
			</div>
		</section>
	);
}
