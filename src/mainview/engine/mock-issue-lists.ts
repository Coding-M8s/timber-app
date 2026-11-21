import type { Engine } from "../../shared/engine";
import type { SuggestedIssue } from "../../shared/issue-search";
import type { IssueList, IssueListRequest, IssueListResult, Sprint } from "../../shared/issue-lists";
import type { Issue } from "../../shared/issues";
import type { IssueTracker, Repository, TimberStatus } from "../../shared/model";

/** The part of the engine about the issues board's lists. */
export type IssueListCapabilities = Pick<Engine, "listIssues">;

export interface IssueListControls {
	/** Decide what every list answers from now on, or only `list` when it is named; null for the samples. */
	setIssueList(result: IssueListResult | null, list?: IssueList): void;
	/** How long each list takes to answer from now on, in milliseconds. */
	setIssueListDelay(milliseconds: number): void;
	/** Every list read that reached Timber, in order. */
	issueListReads(): IssueListRequest[];
	/** A found sprint of `count` issues, for trying a big board. */
	sampleBigSprint(count: number, tracker?: IssueTracker): IssueListResult;
}

const github = (key: string, title: string, closed: boolean, assignee: string | null): Issue => ({
	tracker: "github", key, url: `https://github.com/example/timber/issues/${key}`, title,
	status: closed ? { name: "Closed", category: "closed" } : { name: "Open", category: "open" }, assignee,
});
const jira = (key: string, title: string, status: Issue["status"], assignee: string | null): Issue => ({
	tracker: "jira", key, url: `https://example.atlassian.net/browse/${key}`, title, status, assignee,
});
const linear = (key: string, title: string, status: Issue["status"], assignee: string | null): Issue => ({
	tracker: "linear", key, url: `https://linear.app/example/issue/${key}`, title, status, assignee,
});

const TO_DO = { name: "To Do", category: "open" } as const;
const SELECTED = { name: "Selected for Dev", category: "open" } as const;
const IN_PROGRESS = { name: "In Progress", category: "in-progress" } as const;
const IN_REVIEW = { name: "In Review", category: "in-progress" } as const;
const DONE = { name: "Done", category: "closed" } as const;
const WONT_DO = { name: "Won't Do", category: "closed" } as const;

/** The sample sprint of each tracker. Linear's team is not set, so its sprint is not set up. */
const sampleSprints: Readonly<Record<IssueTracker, { sprint: Sprint; issues: Issue[] } | null>> = {
	github: {
		sprint: { name: "v0.3", source: "github-milestone" },
		issues: [
			github("41", "Look up GitHub issues by number", false, "octo-sam"),
			github("42", "Show the linked issue in the header", false, null),
			github("44", "Explain why New arena is disabled", false, "jo-park"),
			github("7", "Fix the login redirect loop", true, "octo-sam"),
		],
	},
	jira: {
		sprint: { name: "TIM Sprint 14", source: "jira-board" },
		issues: [
			jira("TIM-91", "Login fails behind a proxy", TO_DO, null),
			jira("TIM-90", "Keep the filter text after a reload", SELECTED, "Sam Okafor"),
			jira("TIM-8", "Support Windows paths in the listing", TO_DO, "Alex Doe"),
			jira("TIM-88", "Timber fails on macOS without GNU tools", IN_REVIEW, "Alex Doe"),
			jira("TIM-80", "Read the base from the saved record", IN_PROGRESS, "Alex Doe"),
			jira("TIM-70", "Middle click closes a session chip", DONE, "Jo Park"),
			jira("TIM-71", "Remember the sidebar side", WONT_DO, null),
		],
	},
	linear: null,
};

/** What is open in each sample tracker, newest first, beyond its sprint. */
const sampleOpen: Readonly<Record<IssueTracker, Issue[]>> = {
	github: [github("45", "Fold long diffs by default", false, null)],
	jira: [jira("TIM-95", "Ports list misses services started by a second Compose file in a nested folder of the worktree", TO_DO, null)],
	linear: [linear("API-21", "Rotate login tokens", { name: "Backlog", category: "open" }, null), linear("API-19", "Retry failed webhooks", { name: "In Progress", category: "in-progress" }, "Alex Doe")],
};

/** The signed-in person of each sample tracker. */
const sampleLogin: Readonly<Record<IssueTracker, string>> = { github: "octo-sam", jira: "Alex Doe", linear: "Alex Doe" };

/** Linear's sprint and open issues need its team, which the samples do not set. */
const NOT_CONFIGURED: IssueListResult = { ok: true, outcome: "failed", reason: "not-configured", diagnostic: "No Linear team is configured. Set [linear].team to a team key." };

/** What Timber would answer for one list of one sample tracker, before worktrees are marked. */
export function sampleIssueList(list: IssueList, tracker: IssueTracker): IssueListResult {
	const sprint = sampleSprints[tracker];
	if (list === "sprint") {
		if (sprint === null) return NOT_CONFIGURED;
		return { ok: true, outcome: "found", issues: sprint.issues.map(issue => ({ ...issue, worktree: null })), truncated: false, sprint: sprint.sprint };
	}
	const all = [...sampleOpen[tracker], ...(sprint?.issues ?? [])].filter(issue => issue.status.category !== "closed");
	if (list === "open" && tracker === "linear") return NOT_CONFIGURED;
	const issues = list === "assigned" ? all.filter(issue => issue.assignee === sampleLogin[tracker]) : all;
	return { ok: true, outcome: "found", issues: issues.map(issue => ({ ...issue, worktree: null })), truncated: false, sprint: null };
}

const WORDS = ["Show", "Keep", "Read", "Fix", "Explain", "Fold", "Check", "Remember", "Quiet", "Ports", "Theme", "Sessions", "the", "base", "list", "header", "after", "reload"];
const STATUSES: readonly Issue["status"][] = [TO_DO, SELECTED, IN_PROGRESS, IN_REVIEW, DONE, WONT_DO];

/** A sprint of `count` made-up issues, for trying a big board. */
export function bigSprint(count: number, tracker: IssueTracker = "jira"): IssueListResult {
	const issues: SuggestedIssue[] = Array.from({ length: count }, (_, index) => {
		const number = 1000 - index;
		const title = Array.from({ length: 4 + (index % 6) }, (_, word) => WORDS[(index * 7 + word * 3) % WORDS.length]).join(" ");
		const status = tracker === "github" ? (index % 3 === 0 ? { name: "Closed", category: "closed" as const } : { name: "Open", category: "open" as const }) : STATUSES[index % STATUSES.length]!;
		const key = tracker === "github" ? String(number) : `TIM-${number}`;
		const url = tracker === "github" ? `https://github.com/example/timber/issues/${number}` : `https://example.atlassian.net/browse/TIM-${number}`;
		return { tracker, key, url, title, status, assignee: index % 4 === 0 ? null : ["Sam Okafor", "Jo Park", "Alex Doe"][index % 3]!, worktree: null };
	});
	return { ok: true, outcome: "found", issues, truncated: false, sprint: { name: "Big sprint", source: tracker === "github" ? "github-milestone" : "jira-board" } };
}

/**
 * The board's lists acted out from sample data, for the browser build and
 * tests. As the main process does, a repository must be in the list and
 * Timber must be ready. As Timber does, an issue a worktree is linked to
 * says so.
 */
export function createMockIssueLists(listed: (path: string) => Repository | undefined, timber: () => TimberStatus): IssueListCapabilities & IssueListControls {
	const chosen = new Map<IssueList | "every", IssueListResult>();
	const reads: IssueListRequest[] = [];
	let delay = 0;
	return {
		async listIssues(request) {
			const { repository, list, tracker } = request;
			if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
			const found = listed(repository);
			if (!found) return { ok: false, unsupported: false, message: `${repository} is not a repository in the app's list.` };
			const status = timber();
			if (status.state === "not-found") return { ok: false, unsupported: false, message: "Timber was not found on PATH." };
			if (status.state === "too-old") return { ok: false, unsupported: false, message: `Timber ${status.found} at ${status.path} is older than the required ${status.required}.` };
			reads.push({ repository, list, tracker });
			const answer = structuredClone(chosen.get(list) ?? chosen.get("every") ?? sampleIssueList(list, tracker));
			if (!answer.ok || answer.outcome !== "found") return answer;
			for (const issue of answer.issues) {
				const tree = found.worktrees.find(candidate => candidate.issue?.kind === "linked" && candidate.issue.tracker === issue.tracker && candidate.issue.key === issue.key);
				issue.worktree = tree ? { path: tree.path, branch: tree.branch } : null;
			}
			return answer;
		},
		setIssueList(result, list) {
			const at = list ?? "every";
			if (result === null) chosen.delete(at);
			else chosen.set(at, structuredClone(result));
		},
		setIssueListDelay(milliseconds) {
			delay = Math.max(0, milliseconds);
		},
		issueListReads: () => [...reads],
		sampleBigSprint: (count, tracker) => bigSprint(count, tracker),
	};
}
