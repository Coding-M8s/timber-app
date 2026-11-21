import { describe, expect, test } from "bun:test";
import {
	type TrackerSettings, githubRemoteName, githubRepositoryOf, isIssueLinkSelector, issueLinkSelector, issueSelector, issueTrackersOf, remoteUrlArguments,
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

describe("issueLinkSelector", () => {
	test("names an issue of its tracker only when the key has that tracker's whole shape, and never passes a name unchanged", () => {
		expect(issueLinkSelector("github", "42")).toBe("github:42");
		expect(issueLinkSelector("jira", "ENG-12")).toBe("jira:ENG-12");
		expect(issueLinkSelector("linear", "API-3")).toBe("linear:API-3");
		// Timber reads a Jira or Linear key in any case, and saves it uppercased.
		expect(issueLinkSelector("jira", "eng-12")).toBe("jira:eng-12");
		for (const [tracker, key] of [["github", "042"], ["github", "ENG-1"], ["github", "99999999999999999999"], ["jira", "42"], ["jira", "ENG"], ["linear", ""], ["jira", "ENG-1 "]] as const) {
			expect(issueLinkSelector(tracker, key)).toBeNull();
		}
	});

	test("is checked whole by the main process", () => {
		for (const good of ["github:42", "jira:ENG-12", "linear:API-3"]) expect(isIssueLinkSelector(good)).toBe(true);
		for (const bad of ["42", ":42", "github:", "github:042", "gitlab:1", "jira:ENG-1\n", " github:42", "--issue", 42, null, undefined]) expect(isIssueLinkSelector(bad)).toBe(false);
	});
});

describe("issueSelector", () => {
	test("Default passes the name unchanged", () => {
		expect(issueSelector(null, "42")).toBe("42");
		expect(issueSelector(null, "ENG-42")).toBe("ENG-42");
		expect(issueSelector(null, "eng-42")).toBe("eng-42");
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

	test("prefixes a Jira or Linear key in any case, as typed, since Timber uppercases it", () => {
		expect(issueSelector("jira", "eng-42")).toBe("jira:eng-42");
		expect(issueSelector("linear", "eng-42")).toBe("linear:eng-42");
		expect(issueSelector("jira", "Eng-42")).toBe("jira:Eng-42");
		expect(issueSelector("linear", "a1-7")).toBe("linear:a1-7");
	});

	test("reads a key-shaped branch name as a key with Jira or Linear picked, as Timber would", () => {
		expect(issueSelector("jira", "fix-2")).toBe("jira:fix-2");
		expect(issueSelector("linear", "fix-2")).toBe("linear:fix-2");
		expect(issueSelector("jira", "feature/fix-2")).toBe("feature/fix-2");
		expect(issueSelector(null, "fix-2")).toBe("fix-2");
	});

	test("passes a sentence or a branch name unchanged", () => {
		for (const tracker of ["github", "jira", "linear"] as const) {
			expect(issueSelector(tracker, "Fix login bug")).toBe("Fix login bug");
			expect(issueSelector(tracker, "feature/ENG-42-login")).toBe("feature/ENG-42-login");
			expect(issueSelector(tracker, "feature/eng-42-login")).toBe("feature/eng-42-login");
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
		expect(issueSelector("github", "eng-42")).toBe("eng-42");
		expect(issueSelector("jira", "42")).toBe("42");
		expect(issueSelector("jira", "eng")).toBe("eng");
		expect(issueSelector("jira", "ENG-42a")).toBe("ENG-42a");
		expect(issueSelector("jira", "eng-42a")).toBe("eng-42a");
		expect(issueSelector("linear", "-42")).toBe("-42");
	});

	test("leaves a name that already names a tracker alone", () => {
		expect(issueSelector("jira", "github:42")).toBe("github:42");
		expect(issueSelector("github", "github:42")).toBe("github:42");
		expect(issueSelector("linear", "jira:ENG-1")).toBe("jira:ENG-1");
		expect(issueSelector("jira", "jira:eng-42")).toBe("jira:eng-42");
		expect(issueSelector("linear", "linear:eng-42")).toBe("linear:eng-42");
	});
});

describe("issueTrackersOf", () => {
	test("lists GitHub when the repository has a GitHub remote", () => {
		expect(issueTrackersOf(settings(), "a/b")).toEqual({ ok: true, defaultTracker: null, available: ["github"], githubRepository: "a/b" });
		expect(issueTrackersOf(settings(), null)).toEqual({ ok: true, defaultTracker: null, available: [], githubRepository: null });
	});

	test("lists Jira only when a site and a login apply", () => {
		const site = { configured: true };
		expect(issueTrackersOf(settings({ jira: { ...site, state: "saved" } }), null)).toMatchObject({ available: ["jira"] });
		expect(issueTrackersOf(settings({ jira: { ...site, environmentOverride: true } }), null)).toMatchObject({ available: ["jira"] });
		expect(issueTrackersOf(settings({ jira: { ...site, state: "none" } }), null)).toMatchObject({ available: [] });
		expect(issueTrackersOf(settings({ jira: { ...site, state: "unreadable" } }), null)).toMatchObject({ available: [] });
		// A login with no site that applies is not enough.
		expect(issueTrackersOf(settings({ jira: { configured: false, state: "saved", environmentOverride: true } }), null)).toMatchObject({ available: [] });
	});

	test("lists Linear when its login applies", () => {
		expect(issueTrackersOf(settings({ linear: { state: "saved" } }), null)).toMatchObject({ available: ["linear"] });
		expect(issueTrackersOf(settings({ linear: { environmentOverride: true } }), null)).toMatchObject({ available: ["linear"] });
		expect(issueTrackersOf(settings({ linear: { state: "unreadable" } }), null)).toMatchObject({ available: [] });
	});

	test("lists them in one order: GitHub, Jira, Linear", () => {
		const all = settings({ jira: { configured: true, state: "saved" }, linear: { state: "saved" } });
		expect(issueTrackersOf(all, "a/b")).toMatchObject({ available: ["github", "jira", "linear"] });
	});

	test("takes the default from Timber's effective settings", () => {
		expect(issueTrackersOf(settings({ effective: { default_tracker: "github" } }), "a/b")).toMatchObject({ defaultTracker: "github" });
		expect(issueTrackersOf(settings({ effective: { default_tracker: "linear" } }), "a/b")).toMatchObject({ defaultTracker: "linear" });
		expect(issueTrackersOf(settings({ effective: { default_tracker: "none" } }), "a/b")).toMatchObject({ defaultTracker: null });
	});

	test("with no default set, there is none, even with a Jira site, as Timber then reads a bare name as a branch", () => {
		expect(issueTrackersOf(settings({ jira: { configured: true } }), "a/b")).toMatchObject({ defaultTracker: null });
		expect(issueTrackersOf(settings({ jira: { configured: true, state: "saved" } }), "a/b")).toMatchObject({ defaultTracker: null });
		expect(issueTrackersOf(settings({ effective: { default_tracker: "none" }, jira: { configured: true } }), "a/b")).toMatchObject({ defaultTracker: null });
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
		expect(githubRepositoryOf("https://github.com/Coding-M8s/timber-app.git\n")).toBe("Coding-M8s/timber-app");
		expect(githubRepositoryOf("https://github.com/Coding-M8s/timber-app\n")).toBe("Coding-M8s/timber-app");
		expect(githubRepositoryOf("git@github.com:Coding-M8s/timber-app.git\n")).toBe("Coding-M8s/timber-app");
		expect(githubRepositoryOf("ssh://git@github.com/Coding-M8s/timber-app.git\r\n")).toBe("Coding-M8s/timber-app");
		expect(githubRepositoryOf("https://gitlab.com/group/project.git\n")).toBeNull();
		expect(githubRepositoryOf("https://github.example.com/owner/name.git\n")).toBeNull();
		expect(githubRepositoryOf("https://github.com/owner/..\n")).toBeNull();
		expect(githubRepositoryOf("https://github.com/owner/.git\n")).toBeNull();
		expect(githubRepositoryOf("")).toBeNull();
		expect(githubRepositoryOf("https://github.com/a/b.git\nhttps://github.com/a/c.git\n")).toBeNull();
	});
});
