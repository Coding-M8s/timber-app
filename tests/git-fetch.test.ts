import { describe, expect, test } from "bun:test";
import {
	MAX_FAILURE_CHARACTERS, parseRemoteRefs, parseTrackedBranches, readFetchFailure, readForcePushMarks, remoteTrackingRefspecs, trackedRemotes, withForcePushes,
	withoutCredentials,
} from "../src/shared/git-fetch";
import type { Repository, Worktree } from "../src/shared/model";

const A = "a".repeat(40);
const B = "b".repeat(40);
const SHA256 = "c".repeat(64);

describe("parseRemoteRefs", () => {
	test("reads every remote-tracking ref with its commit, keeping slashes and non-ASCII names", () => {
		const output = [
			`refs/remotes/origin/main\0${A}`,
			`refs/remotes/origin/feat/zażółć\0${B}`,
			`refs/remotes/my remote/main\0${SHA256}`,
			"",
		].join("\n");
		expect([...parseRemoteRefs(output)]).toEqual([
			["refs/remotes/origin/main", A],
			["refs/remotes/origin/feat/zażółć", B],
			["refs/remotes/my remote/main", SHA256],
		]);
	});

	test("leaves out lines it cannot read and refs outside refs/remotes", () => {
		const output = [
			`refs/heads/main\0${A}`,
			`refs/remotes/\0${A}`,
			"refs/remotes/origin/short",
			`refs/remotes/origin/odd\0not-a-commit`,
			`refs/remotes/origin/extra\0${A}\0more`,
			`refs/remotes/origin/fine\0${B}`,
		].join("\n");
		expect([...parseRemoteRefs(output)]).toEqual([["refs/remotes/origin/fine", B]]);
		expect(parseRemoteRefs("").size).toBe(0);
	});
});

describe("remoteTrackingRefspecs", () => {
	test("keeps refspecs that write remote-tracking refs, forced or not, and negative ones beside them", () => {
		expect(remoteTrackingRefspecs([
			"+refs/heads/*:refs/remotes/origin/*",
			"refs/heads/main:refs/remotes/origin/main",
			"^refs/heads/secret/*",
		])).toEqual([
			"+refs/heads/*:refs/remotes/origin/*",
			"refs/heads/main:refs/remotes/origin/main",
			"^refs/heads/secret/*",
		]);
	});

	test("drops refspecs that would write local branches, tags, or nothing at all", () => {
		expect(remoteTrackingRefspecs([
			"+refs/heads/*:refs/heads/*",
			"+refs/tags/*:refs/tags/*",
			"refs/heads/main",
			"+refs/heads/*:refs/remotes/",
			"refs/heads/main:",
			"",
			"   ",
		])).toEqual([]);
	});

	test("answers nothing when only negative refspecs are left, because they fetch nothing on their own", () => {
		expect(remoteTrackingRefspecs(["^refs/heads/secret/*", "+refs/heads/*:refs/heads/*"])).toEqual([]);
	});
});

describe("withoutCredentials", () => {
	test("takes the user name and password out of links and leaves the rest", () => {
		expect(withoutCredentials("fatal: unable to access 'https://sam:ghp_secret@github.com/acme/app.git/': The requested URL returned error: 403"))
			.toBe("fatal: unable to access 'https://github.com/acme/app.git/': The requested URL returned error: 403");
		expect(withoutCredentials("ssh://git@example.com:22/repo and http://token@host/x")).toBe("ssh://example.com:22/repo and http://host/x");
		expect(withoutCredentials("git@github.com: Permission denied (publickey).")).toBe("git@github.com: Permission denied (publickey).");
	});
});

describe("readFetchFailure", () => {
	test("reads a host that cannot be reached as offline", () => {
		const offline = [
			"fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com",
			"ssh: Could not resolve hostname github.com: Temporary failure in name resolution\nfatal: Could not read from remote repository.",
			"fatal: unable to access 'https://127.0.0.1:9/x.git/': Failed to connect to 127.0.0.1 port 9 after 0 ms: Couldn't connect to server",
			"ssh: connect to host example.com port 22: Connection refused",
			"ssh: connect to host example.com port 22: Network is unreachable",
		];
		for (const stderr of offline) expect(readFetchFailure(stderr, 5).kind).toBe("offline");
	});

	test("reads refused or missing credentials as authentication, before the hang-up that follows them", () => {
		const authentication = [
			"fatal: could not read Username for 'https://github.com': terminal prompts disabled",
			// Git 2.56, as the CI runner printed it.
			"fatal: unable to get password from user\nfatal: remote helper 'askme' aborted session",
			"git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
			"remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/acme/app.git/'",
			"Host key verification failed.\nfatal: Could not read from remote repository.",
			"remote: HTTP Basic: Access denied\nfatal: the remote end hung up unexpectedly",
		];
		for (const stderr of authentication) expect(readFetchFailure(stderr, 5).kind).toBe("authentication");
	});

	test("reads anything else as failed, and keeps what Git said without links' credentials", () => {
		const failure = readFetchFailure("fatal: 'upstream' does not appear to be a git repository\nfatal: Could not read from remote repository.\n", 42);
		expect(failure).toEqual({
			kind: "failed",
			message: "fatal: 'upstream' does not appear to be a git repository\nfatal: Could not read from remote repository.",
			at: 42,
		});
		expect(readFetchFailure("fatal: unable to access 'https://a:b@host/x/': boom", 1).message).toBe("fatal: unable to access 'https://host/x/': boom");
	});

	test("keeps only the end of a long message, and says something when Git said nothing", () => {
		const long = readFetchFailure(`${"x".repeat(2000)}\nfatal: the end`, 1).message;
		expect(long.length).toBe(MAX_FAILURE_CHARACTERS + 3);
		expect(long.startsWith("...")).toBe(true);
		expect(long.endsWith("fatal: the end")).toBe(true);
		expect(readFetchFailure("\n  \n", 1).message).toBe("Git stopped without saying why.");
	});
});

describe("parseTrackedBranches and trackedRemotes", () => {
	const line = (...fields: string[]) => `${fields.join("\0")}\n`;

	test("read the branches that track a remote-tracking branch, and the remotes they need", () => {
		const output = [
			line("refs/heads/main", A, "refs/remotes/origin/main", "origin/main", "origin"),
			line("refs/heads/feat/zażółć", B, "refs/remotes/fork/feat/zażółć", "fork/feat/zażółć", "fork"),
			line("refs/heads/other", A, "refs/remotes/origin/other", "origin/other", "origin"),
		].join("");
		const branches = parseTrackedBranches(output);
		expect(branches).toEqual([
			{ branch: "main", object: A, upstream: "refs/remotes/origin/main", upstreamName: "origin/main", remote: "origin" },
			{ branch: "feat/zażółć", object: B, upstream: "refs/remotes/fork/feat/zażółć", upstreamName: "fork/feat/zażółć", remote: "fork" },
			{ branch: "other", object: A, upstream: "refs/remotes/origin/other", upstreamName: "origin/other", remote: "origin" },
		]);
		expect(trackedRemotes(branches)).toEqual(["origin", "fork"]);
	});

	test("leave out branches with no upstream, ones that track a local branch, and lines that do not fit", () => {
		const output = [
			line("refs/heads/spike", A, "", "", ""),
			line("refs/heads/stacked", A, "refs/heads/main", "main", "."),
			line("refs/heads/odd", A, "refs/remotes/origin/odd", "origin/odd"),
			line("refs/heads/nocommit", "x", "refs/remotes/origin/nocommit", "origin/nocommit", "origin"),
			line("refs/tags/v1", A, "refs/remotes/origin/v1", "origin/v1", "origin"),
			line("refs/heads/fine", B, "refs/remotes/origin/fine", "origin/fine", "origin"),
		].join("");
		expect(parseTrackedBranches(output).map(branch => branch.branch)).toEqual(["fine"]);
		expect(trackedRemotes([])).toEqual([]);
	});
});

describe("force-push marks", () => {
	const mark = { upstream: "refs/remotes/origin/main", upstreamName: "origin/main", object: A, branchObject: B, at: 7 };

	test("read saved marks, leaving out what cannot be read and keeping the rest", () => {
		expect(readForcePushMarks({ "/work/a": { main: mark, bad: { ...mark, object: "nope" } }, "/work/b": "x", "/work/c": {} })).toEqual({ "/work/a": { main: mark } });
		for (const value of [null, "marks", [], 7]) expect(readForcePushMarks(value)).toEqual({});
		expect(readForcePushMarks({ "/work/a": { main: { ...mark, upstream: "refs/heads/main" } } })).toEqual({});
		expect(readForcePushMarks({ "/work/a": { main: { ...mark, at: "soon" } } })).toEqual({});
		const { branchObject: _missing, ...older } = mark;
		expect(readForcePushMarks({ "/work/a": { main: older } })).toEqual({});
	});

	const worktree = (branch: string | null, sync: Worktree["sync"]): Worktree => ({
		id: `id-${branch}`, path: `/work/a-${branch}`, canonicalPath: null, branch, head: A, primary: false, detached: branch === null,
		locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync,
	});
	const repository = (worktrees: Worktree[]): Repository => ({ path: "/work/a", name: "a", available: true, failure: null, setup: "unknown", worktrees });

	test("show a mark on the branch's worktree while it is behind the same upstream", () => {
		const read = repository([worktree("main", { kind: "tracking", upstream: "origin/main", ahead: 1, behind: 2 }), worktree("other", null)]);
		const { repository: shown, stale } = withForcePushes(read, { main: mark });
		expect(shown.worktrees[0]!.sync).toEqual({ kind: "tracking", upstream: "origin/main", ahead: 1, behind: 2, forcePushed: { at: 7 } });
		expect(shown.worktrees[1]).toBe(read.worktrees[1]!);
		expect(stale).toEqual([]);
		expect(withForcePushes(read, undefined).repository).toBe(read);
	});

	test("list a mark as stale once it is no longer true, and keep it while Git could not say", () => {
		// The branch moved since the rewrite (its head is not `branchObject`) and is level now, as after a pull.
		for (const sync of [
			{ kind: "tracking", upstream: "origin/main", ahead: 0, behind: 0 },
			{ kind: "tracking", upstream: "origin/other", ahead: 0, behind: 3 },
			{ kind: "gone", upstream: "origin/main" },
			{ kind: "unpublished" },
		] satisfies Worktree["sync"][]) {
			const { repository: shown, stale } = withForcePushes(repository([worktree("main", sync)]), { main: mark });
			expect(stale).toEqual([{ branch: "main", at: 7 }]);
			expect(shown.worktrees[0]!.sync).toEqual(sync);
		}
		expect(withForcePushes(repository([worktree("main", null)]), { main: mark }).stale).toEqual([]);
		// A branch that did not move keeps its mark though it is not behind, as after a rewind.
		const rewound = withForcePushes(repository([worktree("main", { kind: "tracking", upstream: "origin/main", ahead: 2, behind: 0 })]), { main: { ...mark, branchObject: A } });
		expect(rewound.stale).toEqual([]);
		expect(rewound.repository.worktrees[0]!.sync).toMatchObject({ forcePushed: { at: 7 } });
		// Level with the upstream, as after the person's own force-push of the unchanged branch, it goes even though the branch did not move.
		expect(withForcePushes(repository([worktree("main", { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 0 })]), { main: { ...mark, branchObject: A } }).stale)
			.toEqual([{ branch: "main", at: 7 }]);
		// A branch with no worktree is not listed, so its mark is left for the fetcher.
		expect(withForcePushes(repository([]), { main: mark }).stale).toEqual([]);
	});
});
