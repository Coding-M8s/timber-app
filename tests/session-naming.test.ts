import { describe, expect, test } from "bun:test";
import { createMockTerminals } from "../src/mainview/engine/mock-terminals";
import type { Worktree } from "../src/shared/model";
import { applyPreferenceChange, defaultPreferences, readPreferences } from "../src/shared/preferences";
import {
	SESSION_NAME_LIMIT, type SessionNaming, WORKTREE_SETUP_SESSION_NAME, cleanSessionName, defaultSessionName, issueKeyOf, readSessionNaming, sessionNameBase,
} from "../src/shared/terminal";

describe("the issue key in a branch", () => {
	test("is read from the start of the branch or of a part after a slash, uppercased", () => {
		expect(issueKeyOf("gh-122-option-to-name-tab")).toBe("GH-122");
		expect(issueKeyOf("feature/PROJ-42-login")).toBe("PROJ-42");
		expect(issueKeyOf("me/gh-7")).toBe("GH-7");
		expect(issueKeyOf("ABC2-9_fix")).toBe("ABC2-9");
		expect(issueKeyOf("issue-122")).toBe("ISSUE-122");
	});

	test("is read in capitals after a hyphen or an underscore, later in the branch", () => {
		expect(issueKeyOf("feature/login-PROJ-42")).toBe("PROJ-42");
		expect(issueKeyOf("fix-PROJ-42-login")).toBe("PROJ-42");
		expect(issueKeyOf("fix_AB2-7")).toBe("AB2-7");
		// A key at the start wins over one later.
		expect(issueKeyOf("gh-1-then-PROJ-2")).toBe("GH-1");
	});

	test("is a number that starts the branch or a part of it, as #", () => {
		expect(issueKeyOf("122-fix-login")).toBe("#122");
		expect(issueKeyOf("fix/122-login")).toBe("#122");
		expect(issueKeyOf("7")).toBe("#7");
		// A key in capitals wins over a number.
		expect(issueKeyOf("122-fix-PROJ-9")).toBe("PROJ-9");
	});

	test("is null when there is none", () => {
		expect(issueKeyOf("main")).toBeNull();
		expect(issueKeyOf("feature-login")).toBeNull();
		expect(issueKeyOf("fix-login-2")).toBeNull();
		expect(issueKeyOf("feature/login-proj-42")).toBeNull();
		expect(issueKeyOf("PROJ-42x")).toBeNull();
		expect(issueKeyOf("feature/login-PROJ-42.1")).toBeNull();
		expect(issueKeyOf("2.0-cleanup")).toBeNull();
		expect(issueKeyOf("dependabot/npm_and_yarn/react-18.2.0")).toBeNull();
		expect(issueKeyOf("release-2.0")).toBeNull();
	});
});

describe("the name of a new session", () => {
	test("plain naming, or no branch, keeps Terminal and the agent's name", () => {
		expect(sessionNameBase("plain", "Terminal", "feature-login", false)).toBe("Terminal");
		expect(sessionNameBase("plain", "Codex", "feature-login", true)).toBe("Codex");
		for (const naming of ["branch", "issue"] as const) {
			expect(sessionNameBase(naming, "Terminal", null, false)).toBe("Terminal");
			expect(sessionNameBase(naming, "Codex", null, true)).toBe("Codex");
		}
	});

	test("branch naming uses the branch, after the agent's name for an agent", () => {
		expect(sessionNameBase("branch", "Terminal", "feature-login", false)).toBe("feature-login");
		expect(sessionNameBase("branch", "Codex", "feature-login", true)).toBe("Codex: feature-login");
		expect(sessionNameBase("branch", "Terminal", "gh-122-option", false)).toBe("gh-122-option");
	});

	test("issue naming uses the issue key, or the branch when it has none", () => {
		expect(sessionNameBase("issue", "Terminal", "gh-122-option-to-name-tab", false)).toBe("GH-122");
		expect(sessionNameBase("issue", "Codex", "feature/PROJ-42-login", true)).toBe("Codex: PROJ-42");
		expect(sessionNameBase("issue", "Terminal", "feature-login", false)).toBe("feature-login");
		expect(sessionNameBase("issue", "Codex", "122-fix-login", true)).toBe("Codex: #122");
		expect(sessionNameBase("issue", "Terminal", "feature/login-PROJ-42", false)).toBe("PROJ-42");
		expect(sessionNameBase("issue", "Codex", "feature-login", true)).toBe("Codex: feature-login");
	});

	test("is numbered when taken, the same way as Terminal", () => {
		const base = sessionNameBase("branch", "Terminal", "feature-login", false);
		expect(defaultSessionName(base, ["feature-login"])).toBe("feature-login 2");
		const agent = sessionNameBase("branch", "Codex", "feature-login", true);
		expect(defaultSessionName(agent, ["feature-login", "Codex: feature-login"])).toBe("Codex: feature-login 2");
	});

	test("a long branch is cut to fit, keeping room for the number", () => {
		const long = `feature/${"x".repeat(60)}`;
		const base = sessionNameBase("branch", "Terminal", long, false);
		expect(base).toBe(long.slice(0, SESSION_NAME_LIMIT));
		expect(defaultSessionName(base, [base])).toBe(`${long.slice(0, SESSION_NAME_LIMIT - 2)} 2`);
	});

	test("for an agent the branch is cut first, so the agent's name stays", () => {
		const long = "y".repeat(60);
		const base = sessionNameBase("branch", "Claude Code", long, true);
		expect(base).toBe(`Claude Code: ${"y".repeat(SESSION_NAME_LIMIT - 13)}`);
		expect(Array.from(base).length).toBe(SESSION_NAME_LIMIT);
		const second = defaultSessionName(base, [base]);
		expect(second).toBe(`Claude Code: ${"y".repeat(SESSION_NAME_LIMIT - 15)} 2`);
	});

	test("an agent's name that leaves too little room for the branch is used alone", () => {
		const name = "A".repeat(36);
		expect(sessionNameBase("branch", name, "feature-login", true)).toBe(name);
		const shorter = "A".repeat(34);
		expect(sessionNameBase("branch", shorter, "feature-login", true)).toBe(`${shorter}: feat`);
	});

	test("format and control characters in a branch are dropped, so a rename to the same name keeps it", () => {
		const base = sessionNameBase("branch", "Codex", "fea\u200bture\tlogin", true);
		expect(base).toBe("Codex: feature login");
		for (const branch of ["feature-login", "gh-1", `${"z".repeat(50)} q`, "\u200b\u200b", "a\u0007b"]) {
			for (const naming of ["branch", "issue"] as const) {
				for (const [kindBase, agent] of [["Terminal", false], ["Codex", true]] as const) {
					const made = sessionNameBase(naming, kindBase, branch, agent);
					expect(cleanSessionName(made)).toBe(made);
				}
			}
		}
		expect(sessionNameBase("branch", "Terminal", "\u200b", false)).toBe("Terminal");
	});
});

describe("the session naming preference", () => {
	test("is plain by default, and an unknown naming is refused", () => {
		expect(defaultPreferences().sessionNames).toBe("plain");
		expect(readSessionNaming("issue")).toBe("issue");
		expect(readSessionNaming("ticket")).toBeUndefined();
		expect(applyPreferenceChange(defaultPreferences(), { sessionNames: "ticket" }).unreadable).toEqual(["sessionNames"]);
		expect(applyPreferenceChange(defaultPreferences(), { sessionNames: "branch" }).preferences.sessionNames).toBe("branch");
		expect(readPreferences({ sessionNames: "ticket" }).sessionNames).toBe("plain");
		expect(readPreferences({ sessionNames: "issue" }).sessionNames).toBe("issue");
	});
});

describe("the mock engine names sessions as Settings says", () => {
	const repository = "/repos/app";
	const worktree = (path: string, branch: string | null): Worktree => ({
		id: `id:${path}`, path, canonicalPath: path, branch, head: null, primary: false, detached: branch === null,
		locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, sync: null, issue: null, baseCounts: null,
	});
	const worktrees = [worktree("/repos/app-login", "feature-login"), worktree("/repos/app-gh", "gh-122-name-tab"), worktree("/repos/app-detached", null)];

	function mock() {
		let naming: SessionNaming = "plain";
		const terminals = createMockTerminals(
			(_repository, path) => worktrees.find(candidate => candidate.path === path) ?? null,
			() => [{ name: "Codex", command: "codex" }],
			() => ({ state: "ready", source: "path", path: "/usr/local/bin/timber", version: "0.1.1" }),
			() => naming,
		);
		const open = async (path: string, extra: { agent?: string; timberWorktreeSetup?: Record<string, never> } = {}) => {
			const result = await terminals.openTerminal({ repository, worktree: path, cols: 80, rows: 24, ...extra });
			if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
			return result.session;
		};
		return { terminals, open, set: (next: SessionNaming) => { naming = next; } };
	}

	test("plain by default, as before", async () => {
		const { open } = mock();
		expect((await open("/repos/app-login")).name).toBe("Terminal");
		expect((await open("/repos/app-login", { agent: "Codex" })).name).toBe("Codex");
	});

	test("after the branch, numbered when taken, and a detached HEAD falls back", async () => {
		const { open, set } = mock();
		set("branch");
		expect((await open("/repos/app-login")).name).toBe("feature-login");
		expect((await open("/repos/app-login")).name).toBe("feature-login 2");
		expect((await open("/repos/app-login", { agent: "Codex" })).name).toBe("Codex: feature-login");
		expect((await open("/repos/app-login", { agent: "Codex" })).name).toBe("Codex: feature-login 2");
		expect((await open("/repos/app-detached")).name).toBe("Terminal");
		expect((await open("/repos/app-detached", { agent: "Codex" })).name).toBe("Codex");
	});

	test("after the issue key, and a setup session keeps its name", async () => {
		const { open, set } = mock();
		set("issue");
		expect((await open("/repos/app-gh")).name).toBe("GH-122");
		expect((await open("/repos/app-gh", { agent: "Codex" })).name).toBe("Codex: GH-122");
		expect((await open("/repos/app-login")).name).toBe("feature-login");
		expect((await open("/repos/app-gh", { timberWorktreeSetup: {} })).name).toBe(WORKTREE_SETUP_SESSION_NAME);
	});

	test("sessions already open, and renamed ones, keep their names when the setting changes", async () => {
		const { terminals, open, set } = mock();
		const first = await open("/repos/app-login");
		set("branch");
		const second = await open("/repos/app-login");
		await terminals.renameTerminal(second.id, "dev server");
		set("issue");
		await open("/repos/app-login");
		expect((await terminals.listTerminals()).map(session => session.name)).toEqual(["Terminal", "dev server", "feature-login"]);
		expect(first.name).toBe("Terminal");
	});
});
