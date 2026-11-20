import { describe, expect, test } from "bun:test";
import {
	type TrackerSettings, githubRemoteName, isGithubRemote, issueSelector, issueTrackersOf, remoteUrlArguments,
} from "../src/shared/issue-trackers";

/** Settings as Timber reports them for a repository: nothing set and no logins, unless changed. */
function settings(change: { effective?: TrackerSettings["effective"]; jira?: Partial<TrackerSettings["credentials"]["jira"]>; linear?: Partial<TrackerSettings["credentials"]["linear"]> } = {}): TrackerSettings {
	return {
		effective: change.effective ?? {},
		credentials: {
			jira: { configured: false, state: "none", environmentOverride: false, ...change.jira },
			linear: { state: "none", environmentOverride: false, ...change.linear },
		},
	};
}

describe("issueSelector", () => {
	test("Default passes the name unchanged", () => {
		expect(issueSelector(null, "42")).toBe("42");
		expect(issueSelector(null, "ENG-42")).toBe("ENG-42");
	});

	test("prefixes an issue number for GitHub", () => {
		expect(issueSelector("github", "42")).toBe("github:42");
		expect(issueSelector("github", "1")).toBe("github:1");
	});

	test("prefixes an issue key for Jira and Linear", () => {
		expect(issueSelector("jira", "ENG-42")).toBe("jira:ENG-42");
		expect(issueSelector("linear", "ENG-42")).toBe("linear:ENG-42");
		expect(issueSelector("jira", "A1-7")).toBe("jira:A1-7");
	});

	test("passes a sentence or a branch name unchanged", () => {
		for (const tracker of ["github", "jira", "linear"] as const) {
			expect(issueSelector(tracker, "Fix login bug")).toBe("Fix login bug");
			expect(issueSelector(tracker, "feature/ENG-42-login")).toBe("feature/ENG-42-login");
			expect(issueSelector(tracker, "")).toBe("");
		}
	});

	test("passes a name that only Timber would refuse as a selector unchanged", () => {
		// Each of these would make Timber throw "Invalid ... selector" with a prefix.
		expect(issueSelector("github", "042")).toBe("042");
		expect(issueSelector("github", "0")).toBe("0");
		expect(issueSelector("github", "#42")).toBe("#42");
		expect(issueSelector("github", "99999999999999999999")).toBe("99999999999999999999");
		expect(issueSelector("github", "ENG-42")).toBe("ENG-42");
		expect(issueSelector("jira", "42")).toBe("42");
		expect(issueSelector("jira", "eng-42")).toBe("eng-42");
		expect(issueSelector("jira", "ENG-42a")).toBe("ENG-42a");
		expect(issueSelector("linear", "-42")).toBe("-42");
	});

	test("leaves a name that already names a tracker alone", () => {
		expect(issueSelector("jira", "github:42")).toBe("github:42");
		expect(issueSelector("github", "github:42")).toBe("github:42");
		expect(issueSelector("linear", "jira:ENG-1")).toBe("jira:ENG-1");
	});
});

describe("issueTrackersOf", () => {
	test("lists GitHub when the repository has a GitHub remote", () => {
		expect(issueTrackersOf(settings(), true)).toEqual({ ok: true, defaultTracker: null, available: ["github"] });
		expect(issueTrackersOf(settings(), false)).toEqual({ ok: true, defaultTracker: null, available: [] });
	});

	test("lists Jira only when a site and a login apply", () => {
		const site = { configured: true };
		expect(issueTrackersOf(settings({ jira: { ...site, state: "saved" } }), false)).toMatchObject({ available: ["jira"] });
		expect(issueTrackersOf(settings({ jira: { ...site, environmentOverride: true } }), false)).toMatchObject({ available: ["jira"] });
		expect(issueTrackersOf(settings({ jira: { ...site, state: "none" } }), false)).toMatchObject({ available: [] });
		expect(issueTrackersOf(settings({ jira: { ...site, state: "unreadable" } }), false)).toMatchObject({ available: [] });
		// A login with no site that applies is not enough.
		expect(issueTrackersOf(settings({ jira: { configured: false, state: "saved", environmentOverride: true } }), false)).toMatchObject({ available: [] });
	});

	test("lists Linear when its login applies", () => {
		expect(issueTrackersOf(settings({ linear: { state: "saved" } }), false)).toMatchObject({ available: ["linear"] });
		expect(issueTrackersOf(settings({ linear: { environmentOverride: true } }), false)).toMatchObject({ available: ["linear"] });
		expect(issueTrackersOf(settings({ linear: { state: "unreadable" } }), false)).toMatchObject({ available: [] });
	});

	test("lists them in one order: GitHub, Jira, Linear", () => {
		const all = settings({ jira: { configured: true, state: "saved" }, linear: { state: "saved" } });
		expect(issueTrackersOf(all, true)).toMatchObject({ available: ["github", "jira", "linear"] });
	});

	test("takes the default from Timber's effective settings", () => {
		expect(issueTrackersOf(settings({ effective: { default_tracker: "github" } }), true)).toMatchObject({ defaultTracker: "github" });
		expect(issueTrackersOf(settings({ effective: { default_tracker: "linear" } }), true)).toMatchObject({ defaultTracker: "linear" });
		expect(issueTrackersOf(settings({ effective: { default_tracker: "none" } }), true)).toMatchObject({ defaultTracker: null });
	});

	test("with no default set, a Jira site is the default, as Timber reads a bare key then", () => {
		expect(issueTrackersOf(settings({ jira: { configured: true } }), true)).toMatchObject({ defaultTracker: "jira" });
		expect(issueTrackersOf(settings({ effective: { default_tracker: "none" }, jira: { configured: true } }), true)).toMatchObject({ defaultTracker: null });
	});
});

describe("the GitHub remote", () => {
	test("is the remote Timber is set to, or origin", () => {
		expect(githubRemoteName({})).toBe("origin");
		expect(githubRemoteName({ remote: "upstream" })).toBe("upstream");
	});

	test("is read with every URL of that remote, and the name after --", () => {
		expect(remoteUrlArguments("/work/my repo", "-x")).toEqual(["-C", "/work/my repo", "remote", "get-url", "--all", "--", "-x"]);
	});

	test("counts only one github.com URL, in the forms Timber accepts", () => {
		expect(isGithubRemote("https://github.com/Coding-M8s/timber-app.git\n")).toBe(true);
		expect(isGithubRemote("https://github.com/Coding-M8s/timber-app\n")).toBe(true);
		expect(isGithubRemote("git@github.com:Coding-M8s/timber-app.git\n")).toBe(true);
		expect(isGithubRemote("ssh://git@github.com/Coding-M8s/timber-app.git\r\n")).toBe(true);
		expect(isGithubRemote("https://gitlab.com/group/project.git\n")).toBe(false);
		expect(isGithubRemote("https://github.example.com/owner/name.git\n")).toBe(false);
		expect(isGithubRemote("https://github.com/owner/..\n")).toBe(false);
		expect(isGithubRemote("https://github.com/owner/.git\n")).toBe(false);
		expect(isGithubRemote("")).toBe(false);
		expect(isGithubRemote("https://github.com/a/b.git\nhttps://github.com/a/c.git\n")).toBe(false);
	});
});
