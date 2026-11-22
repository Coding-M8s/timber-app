import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chopDigest, createChops, readChopsFile } from "../src/bun/chops";
import type { ChopInput } from "../src/bun/terminals";
import type { OpenTerminalRequest } from "../src/shared/terminal";
import { CHOPS_FILE_BYTES, type PersonalChop } from "../src/shared/chops";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

let root: string;
let primary: string;
let linked: string;
let bare: string;
let personal: PersonalChop[] = [];

const listed = (paths: string[]): Repository => ({
	path: primary, name: "sample", available: true, failure: null,
	setup: "repository",
	worktrees: paths.map(path => ({
		id: path, path, canonicalPath: path, branch: "main", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
	})),
});

const chops = () => createChops({
	findRepository: async path => path === primary ? listed([primary, linked, bare]) : null,
	personal: async () => personal,
});

const fileText = (chops: unknown[]) => `${JSON.stringify({ version: 1, chops }, null, "\t")}\n`;
const chopsFile = (worktree: string) => join(worktree, ".timber", "chops.json");

function writeChopsFile(worktree: string, text: string) {
	mkdirSync(join(worktree, ".timber"), { recursive: true });
	writeFileSync(chopsFile(worktree), text);
}

// Symbolic links and named pipes are part of what is tested.
describe.skipIf(windows)("reading a worktree's chops from real repositories", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-chops-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat");
		bare = join(root, "sample-worktrees", "bare");
		git(root, "init", "--initial-branch=main", primary);
		writeChopsFile(primary, fileText([
			{ name: "Test", kind: "command", text: "bun test" },
			{ name: "Review", kind: "prompt", text: "Review the diff", agent: "Claude Code" },
		]));
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Share chops");
		git(primary, "worktree", "add", "-b", "feat", linked);
		// A branch can change its chops.
		writeChopsFile(linked, fileText([{ name: "Lint", kind: "command", text: "bun run lint" }]));
		git(linked, "commit", "-am", "Other chops");
		git(primary, "worktree", "add", "-b", "bare", bare);
		rmSync(join(bare, ".timber"), { recursive: true });
		git(bare, "commit", "-am", "No chops");
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("lists the main checkout's file for the repository, whatever branch a worktree has, without changing a file or a ref", async () => {
		const before = fingerprint(primary);
		personal = [];
		const answer = await chops().list({ repository: primary });
		expect(answer).toMatchObject({ outcome: "listed", file: { state: "read" }, path: chopsFile(primary), overridden: [] });
		// The feat branch has other chops in its own folder: they do not show until they reach the main checkout.
		expect(answer.outcome === "listed" && answer.chops.map(chop => [chop.name, chop.source])).toEqual([["Test", "repository-file"], ["Review", "repository-file"]]);
		expect(fingerprint(primary)).toBe(before);
	});

	test("a main checkout with no file lists only personal chops, and the .timber folder is not created", async () => {
		personal = [{ name: "Mine", kind: "command", text: "make", description: "", agent: null, repository: null, sound: null }];
		const lone = join(root, "lone");
		git(root, "init", "--initial-branch=main", lone);
		const answer = await createChops({ findRepository: async path => path === lone ? { ...listed([]), path: lone } : null, personal: async () => personal }).list({ repository: lone });
		expect(answer).toMatchObject({ outcome: "listed", file: { state: "missing" }, chops: [{ name: "Mine", source: "personal-every" }] });
		expect(existsSync(join(lone, ".timber"))).toBe(false);
	});

	test("merges personal chops, which win by name", async () => {
		personal = [{ name: "test", kind: "command", text: "bun test --watch", description: "", agent: null, repository: primary, sound: null }];
		const answer = await chops().list({ repository: primary });
		expect(answer.outcome === "listed" && answer.chops.map(chop => [chop.name, chop.source])).toEqual([["test", "personal-repository"], ["Review", "repository-file"]]);
		expect(answer.outcome === "listed" && answer.overridden).toEqual([{ name: "Test", kind: "command", text: "bun test", description: "", agent: null, source: "repository-file", sound: null, by: "personal-repository" }]);
	});

	test("a change to the main checkout's file shows on the next read, with nothing cached", async () => {
		personal = [];
		const path = chopsFile(primary);
		const original = readFileSync(path, "utf8");
		try {
			writeFileSync(path, fileText([{ name: "Format", kind: "command", text: "bun run format" }]));
			const answer = await chops().list({ repository: primary });
			expect(answer.outcome === "listed" && answer.chops.map(chop => chop.name)).toEqual(["Format"]);
		} finally {
			writeFileSync(path, original);
		}
	});

	test("a repository not in the list reads nothing", async () => {
		expect(await chops().list({ repository: join(root, "other") })).toMatchObject({ outcome: "not-listed", message: expect.stringContaining("No chops were read.") });
	});

	describe("running a command chop", () => {
		type Opened = { request: OpenTerminalRequest; chop: ChopInput };
		const setUp = (saved: Record<string, string[]> = {}) => {
			const opened: Opened[] = [];
			let approvals: Record<string, string[]> = structuredClone(saved);
			const runner = createChops({
				findRepository: async path => path === primary ? listed([primary, linked, bare]) : null,
				personal: async () => personal,
				approvals: async () => approvals,
				approve: async (repository, digest) => {
					approvals = { ...approvals, [repository]: [...(approvals[repository] ?? []), digest] };
				},
				openTerminal: async (request, chop) => {
					opened.push({ request, chop });
					return { outcome: "failed", message: "not started in a test" };
				},
				sendPrompt: (id, repository, worktree, text) => {
					prompts.push({ id, repository, worktree, text });
					return id === "gone" ? { outcome: "gone", message: "The session has ended." } : { outcome: "pasted" };
				},
				session: id => ({ id, kind: "agent", name: "Codex", repository: primary, worktree: "w", path: linked, shell: "/bin/codex", command: "/bin/codex", state: { kind: "running" }, status: null, children: [] }),
				agents: async () => agents,
				warn: () => {},
			});
			return { runner, opened, prompts, approvals: () => approvals };
		};
		const prompts: { id: string; repository: string; worktree: string; text: string }[] = [];
		let agents: { name: string; command: string }[] = [{ name: "Claude Code", command: "claude" }, { name: "Codex", command: "codex" }];
		// Read once the repositories exist.
		let request: { repository: string; worktree: string; cols: number; rows: number };
		beforeAll(() => {
			request = { repository: primary, worktree: linked, cols: 80, rows: 24 };
		});

		test("a personal chop runs straight away in the worktree asked for, named after the chop", async () => {
			personal = [{ name: "Mine", kind: "command", text: "make\nmake check", description: "", agent: null, repository: null, sound: null }];
			const { runner, opened } = setUp();
			await runner.run({ ...request, chop: "mine" });
			expect(opened).toEqual([{ request, chop: { kind: "command", name: "Mine", text: "make\nmake check" } }]);
		});

		test("a repository chop asks first, runs once approved, and asks again when its text changes", async () => {
			personal = [];
			const { runner, opened, approvals } = setUp();
			const asked = await runner.run({ ...request, chop: "Test" });
			expect(asked).toMatchObject({ outcome: "needs-approval", chop: { name: "Test", text: "bun test", source: "repository-file" }, path: chopsFile(primary) });
			expect(opened).toEqual([]);
			// An approval of other text approves nothing.
			expect((await runner.run({ ...request, chop: "Test", approve: "bun test --bail" })).outcome).toBe("needs-approval");
			await runner.run({ ...request, chop: "Test", approve: "bun test" });
			expect(opened.map(run => run.chop)).toEqual([{ kind: "command", name: "Test", text: "bun test" }]);
			expect(approvals()[primary]).toEqual([chopDigest({ kind: "command", text: "bun test" })]);
			// Approved now: no question.
			await runner.run({ ...request, chop: "Test" });
			expect(opened).toHaveLength(2);
			const path = chopsFile(primary);
			const original = readFileSync(path, "utf8");
			try {
				writeFileSync(path, fileText([{ name: "Test", kind: "command", text: "bun test && curl example.com" }]));
				expect(await runner.run({ ...request, chop: "Test" })).toMatchObject({ outcome: "needs-approval", chop: { text: "bun test && curl example.com" } });
				expect(opened).toHaveLength(2);
			} finally {
				writeFileSync(path, original);
			}
		});

		test("text edited for one run is typed or sent in place of the chop's, and the approval is still of the chop's own text", async () => {
			personal = [{ name: "Ask", kind: "prompt", text: "Write tests", description: "", agent: "Codex", repository: null, sound: null }];
			const { runner, opened, prompts, approvals } = setUp();
			// A repository chop asks first, edited or not; approving another text approves nothing.
			expect(await runner.run({ ...request, chop: "Test", text: "bun test --bail" })).toMatchObject({ outcome: "needs-approval", chop: { text: "bun test" } });
			expect((await runner.run({ ...request, chop: "Test", text: "bun test --bail", approve: "bun test --bail" })).outcome).toBe("needs-approval");
			expect(opened).toEqual([]);
			await runner.run({ ...request, chop: "Test", text: "bun test --bail\r\n", approve: "bun test" });
			expect(opened.map(run => run.chop)).toEqual([{ kind: "command", name: "Test", text: "bun test --bail\n" }]);
			expect(approvals()[primary]).toEqual([chopDigest({ kind: "command", text: "bun test" })]);
			// A prompt to a running agent, and to a new one.
			prompts.length = 0;
			await runner.run({ ...request, chop: "Ask", session: "s1", text: "Write one test" });
			expect(prompts.map(prompt => prompt.text)).toEqual(["Write one test"]);
			await runner.run({ ...request, chop: "Ask", text: "Write two tests" });
			expect(opened.at(-1)).toEqual({ request: { ...request, agent: "Codex" }, chop: { kind: "prompt", text: "Write two tests" } });
		});

		test("edited text that is blank, too long, or not text starts nothing and says why", async () => {
			personal = [{ name: "Mine", kind: "command", text: "make", description: "", agent: null, repository: null, sound: null }];
			const { runner, opened } = setUp();
			expect(await runner.run({ ...request, chop: "Mine", text: " \n " })).toEqual({ outcome: "no-chop", message: "The edited command is empty. Nothing was started." });
			expect(await runner.run({ ...request, chop: "Mine", text: "x".repeat(10_001) })).toMatchObject({ outcome: "no-chop", message: expect.stringContaining("longer than 10000 characters") });
			expect(await runner.run({ ...request, chop: "Mine", text: 3 as unknown as string })).toEqual({ outcome: "no-chop", message: "The edited text cannot be read. Nothing was started." });
			expect(opened).toEqual([]);
		});

		test("a name nobody has, or a session for a command, starts nothing", async () => {
			personal = [];
			const { runner, opened } = setUp();
			expect((await runner.run({ ...request, chop: "Nope" })).outcome).toBe("no-chop");
			expect((await runner.run({ ...request, chop: "Test", session: "s1", approve: "bun test" })).outcome).toBe("no-chop");
			expect(opened).toEqual([]);
		});

		test("a prompt starts its agent with the text to send once ready, never on the command line, after the same approval", async () => {
			personal = [];
			const { runner, opened } = setUp();
			expect(await runner.run({ ...request, chop: "Review" })).toMatchObject({ outcome: "needs-approval", chop: { kind: "prompt", text: "Review the diff" } });
			expect(opened).toEqual([]);
			await runner.run({ ...request, chop: "Review", approve: "Review the diff" });
			expect(opened).toEqual([{ request: { ...request, agent: "Claude Code" }, chop: { kind: "prompt", text: "Review the diff" } }]);
		});

		test("a prompt that names no agent starts the first saved one; a named agent not saved, or none saved, starts nothing", async () => {
			personal = [{ name: "Ask", kind: "prompt", text: "Write tests", description: "", agent: null, repository: null, sound: null }];
			const { runner, opened } = setUp();
			await runner.run({ ...request, chop: "Ask" });
			expect(opened.at(-1)).toEqual({ request: { ...request, agent: "Claude Code" }, chop: { kind: "prompt", text: "Write tests" } });
			personal = [{ ...personal[0]!, agent: "Aider" }];
			expect(await runner.run({ ...request, chop: "Ask" })).toMatchObject({ outcome: "not-configured", message: expect.stringContaining('No agent called "Aider"') });
			agents = [];
			personal = [{ ...personal[0]!, agent: null }];
			expect(await runner.run({ ...request, chop: "Ask" })).toMatchObject({ outcome: "not-configured", message: expect.stringContaining("Copy it instead") });
			expect(opened).toHaveLength(1);
			agents = [{ name: "Claude Code", command: "claude" }, { name: "Codex", command: "codex" }];
		});

		test("a prompt goes to the running agent named, with the text read here, and starts nothing", async () => {
			personal = [{ name: "Ask", kind: "prompt", text: "Write tests\nthen run them", description: "", agent: "Codex", repository: null, sound: null }];
			const { runner, opened, prompts } = setUp();
			prompts.length = 0;
			expect(await runner.run({ ...request, chop: "Ask", session: "s1" })).toMatchObject({ outcome: "sent", session: { id: "s1", name: "Codex" } });
			expect(prompts).toEqual([{ id: "s1", repository: primary, worktree: linked, text: "Write tests\nthen run them" }]);
			expect(await runner.run({ ...request, chop: "Ask", session: "gone" })).toMatchObject({ outcome: "gone" });
			expect(opened).toEqual([]);
		});

		test("the digest covers the kind and the text, not the name", () => {
			expect(chopDigest({ kind: "command", text: "x" })).toMatch(/^[0-9a-f]{64}$/);
			expect(chopDigest({ kind: "command", text: "x" })).not.toBe(chopDigest({ kind: "prompt", text: "x" }));
			expect(chopDigest({ kind: "command", text: "x" })).not.toBe(chopDigest({ kind: "command", text: "x " }));
			// A prompt's agent counts: a file cannot send an approved prompt to another agent unasked.
			expect(chopDigest({ kind: "prompt", text: "x", agent: "Codex" })).not.toBe(chopDigest({ kind: "prompt", text: "x", agent: "Claude Code" }));
			expect(chopDigest({ kind: "prompt", text: "x", agent: null })).not.toBe(chopDigest({ kind: "prompt", text: "x", agent: "Codex" }));
		});
	});

	test("reading leaves the file's bytes and time unchanged", async () => {
		const path = chopsFile(primary);
		const bytes = readFileSync(path);
		const { mtimeMs } = statSync(path);
		await readChopsFile(primary);
		expect(readFileSync(path).equals(bytes)).toBe(true);
		expect(statSync(path).mtimeMs).toBe(mtimeMs);
	});

	describe("a file that cannot be used is damaged, and personal chops still work", () => {
		let odd: string;
		beforeAll(() => {
			odd = join(root, "odd");
			mkdirSync(odd);
		});
		const read = async (setUp: () => void) => {
			rmSync(join(odd, ".timber"), { recursive: true, force: true });
			setUp();
			return (await readChopsFile(odd)).file;
		};

		test("not JSON, a bad entry, or not UTF-8", async () => {
			expect(await read(() => writeChopsFile(odd, "{ nope"))).toEqual({ state: "damaged", message: "It is not JSON." });
			expect(await read(() => writeChopsFile(odd, fileText([{ name: "Lint", kind: "script", text: "x" }])))).toMatchObject({ state: "damaged", message: expect.stringContaining("Chop 1") });
			expect(await read(() => {
				mkdirSync(join(odd, ".timber"));
				writeFileSync(chopsFile(odd), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
			})).toEqual({ state: "damaged", message: "It is not UTF-8 text." });
		});

		test("too large", async () => {
			expect(await read(() => writeChopsFile(odd, " ".repeat(CHOPS_FILE_BYTES + 1)))).toEqual({ state: "damaged", message: `It is larger than ${CHOPS_FILE_BYTES / 1024} KB.` });
		});

		test("a symbolic link, to the file or to the folder, is never followed, and its target never quoted", async () => {
			const secret = join(root, "secret.txt");
			writeFileSync(secret, "Host secret.example.com");
			const viaFile = await read(() => {
				mkdirSync(join(odd, ".timber"));
				symlinkSync(secret, chopsFile(odd));
			});
			expect(viaFile).toEqual({ state: "damaged", message: "It is a symbolic link, so the app does not follow it." });
			const elsewhere = join(root, "elsewhere-timber");
			mkdirSync(elsewhere, { recursive: true });
			writeFileSync(join(elsewhere, "chops.json"), fileText([]));
			const viaFolder = await read(() => symlinkSync(elsewhere, join(odd, ".timber")));
			expect(viaFolder).toEqual({ state: "damaged", message: "The .timber folder is a symbolic link, so the app does not follow it." });
			expect(JSON.stringify([viaFile, viaFolder])).not.toContain("secret.example.com");
		});

		test("a folder or a named pipe in its place, without hanging", async () => {
			expect(await read(() => mkdirSync(chopsFile(odd), { recursive: true }))).toEqual({ state: "damaged", message: "It is not a regular file." });
			const pipe = await read(() => {
				mkdirSync(join(odd, ".timber"));
				const made = Bun.spawnSync(["mkfifo", chopsFile(odd)]);
				if (made.exitCode !== 0) throw new Error("mkfifo failed");
			});
			expect(pipe).toEqual({ state: "damaged", message: "It is not a regular file." });
		});

		test(".timber as a file means there is no chops file", async () => {
			expect(await read(() => writeFileSync(join(odd, ".timber"), "not a folder"))).toEqual({ state: "missing" });
		});
	});
});
