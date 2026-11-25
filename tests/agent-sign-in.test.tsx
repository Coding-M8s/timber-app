import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createSignInReader } from "../src/bun/agent-sign-in";
import { locateAgent } from "../src/bun/find-executable";
import { agentDraftsOf, agentSignInLine, editAgentDraft } from "../src/mainview/agent-format";
import { AgentsSectionView } from "../src/mainview/components/settings/AgentsSection";
import { AgentField } from "../src/mainview/components/NewWorktreeDialog";
import { agentOptionLabel, agentPickHint, chosenAgent } from "../src/mainview/components/worktree-modes/agent-choice";
import { createWorktreeDialogController } from "../src/mainview/components/worktree-modes/dialog-controller";
import { createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import { type AgentSetting, DEFAULT_AGENTS } from "../src/shared/agent";
import type { AgentLocation } from "../src/shared/agent-lookup";
import { AGENTS, agentById } from "../src/shared/agent-registry";
import { type AgentSignIn, type SignInAnswer, type SignInState, readSignIn } from "../src/shared/agent-sign-in";
import { HANDOFF_VARIABLE } from "../src/shared/handoff";
import { STATUS_VARIABLE } from "../src/shared/status-hooks";
import { until, windows } from "./support/runtime";

const CLAUDE: AgentSetting = { name: "Claude Code", command: "claude" };
const CODEX: AgentSetting = { name: "Codex", command: "codex" };
const CURSOR: AgentSetting = { name: "Cursor CLI", command: "cursor-agent" };
const GEMINI: AgentSetting = { name: "Gemini CLI", command: "gemini" };
const WORK: AgentSetting = { name: "Claude work", command: "claude-work", agent: "claude" };
const UNREADABLE: SignInState = { state: "not-known", reason: "unreadable" };

const settle = async () => {
	for (let round = 0; round < 8; round += 1) await Bun.sleep(0);
};

describe("what a status command's answer says", () => {
	const answer = (exitCode: number | null, out: string, err = ""): SignInAnswer => ({ exitCode, out: { text: out, truncated: false }, err: { text: err, truncated: false } });
	const read = (id: "claude" | "codex" | "cursor", given: SignInAnswer, environment: Record<string, string | undefined> = {}) => readSignIn(agentById(id).signIn.status!, given, environment);

	test("Claude Code's: the exit code and loggedIn must agree", () => {
		expect(read("claude", answer(0, `{\n  "loggedIn": true,\n  "email": "sam@example.com"\n}\n`))).toEqual({ state: "signed-in" });
		expect(read("claude", answer(1, `{"loggedIn":false,"authMethod":"none"}`))).toEqual({ state: "signed-out" });
		for (const given of [answer(1, `{"loggedIn":true}`), answer(0, `{"loggedIn":false}`), answer(1, ""), answer(0, ""), answer(0, `{"loggedIn":"true"}`), answer(0, "[true]"), answer(0, "null"), answer(null, `{"loggedIn":false}`), answer(2, `{"loggedIn":false}`), answer(0, `warning\n{"loggedIn":true}`)]) {
			expect(read("claude", given)).toEqual(UNREADABLE);
		}
	});

	test("Codex's: a broken config, which also ends with 1, is not signed out", () => {
		expect(read("codex", answer(0, "", "Logged in using ChatGPT\n"))).toEqual({ state: "signed-in" });
		expect(read("codex", answer(1, "", "WARNING: could not create PATH aliases\nNot logged in\n"))).toEqual({ state: "signed-out" });
		expect(read("codex", answer(1, "", "Error loading configuration: config.toml:1:12: unclosed array\n"))).toEqual(UNREADABLE);
		for (const given of [answer(0, "", "Not logged in"), answer(1, "", "Logged in using ChatGPT"), answer(1, "", "Error: Not logged in to the server"), answer(0, "", ""), answer(1, "Not logged in"), answer(null, "", "Not logged in")]) {
			expect(read("codex", given)).toEqual(UNREADABLE);
		}
	});

	test("Cursor CLI's: the status says, and a key it does not count makes signed out not known", () => {
		const out = `{"status":"unauthenticated","isAuthenticated":false}`;
		expect(read("cursor", answer(0, `{"status":"authenticated","isAuthenticated":true,"userInfo":{"email":"sam@example.com"}}`))).toEqual({ state: "signed-in" });
		expect(read("cursor", answer(0, out))).toEqual({ state: "signed-out" });
		expect(read("cursor", answer(0, out), { CURSOR_API_KEY: "" })).toEqual({ state: "signed-out" });
		expect(read("cursor", answer(0, out), { CURSOR_API_KEY: "key" })).toEqual({ state: "not-known", reason: "key-set", variable: "CURSOR_API_KEY" });
		for (const given of [answer(0, `{"status":"partially-authenticated","isAuthenticated":false}`), answer(1, out), answer(0, `{"status":"authenticated","isAuthenticated":false}`), answer(0, "Not logged in")]) {
			expect(read("cursor", given)).toEqual(UNREADABLE);
		}
	});

	test("an answer that was cut is not read", () => {
		expect(read("claude", { ...answer(0, `{"loggedIn":true}`), out: { text: `{"loggedIn":true}`, truncated: true } })).toEqual(UNREADABLE);
		expect(read("codex", { ...answer(1, ""), err: { text: "Not logged in", truncated: true } })).toEqual(UNREADABLE);
	});

	test("the registry gives a command only with the version it was run with, and none to the others", () => {
		expect(AGENTS.filter(agent => agent.signIn.status).map(agent => agent.id)).toEqual(["claude", "codex", "cursor"]);
		for (const agent of AGENTS) if (agent.signIn.status) expect(agent.signIn.status.checked).toMatch(/\d.* on Linux on \d{4}-\d{2}-\d{2}$/);
	});
});

let root: string;
const RECORD = `printf '%s\\n' "$@" > "$OUT/args"; env > "$OUT/env"; pwd > "$OUT/cwd"; ls -A > "$OUT/listing"; echo run >> "$OUT/runs"`;
const SIGNED_IN = `echo '{"loggedIn":true,"email":"sam@example.com","orgName":"Secret Org"}'`;

/** A PATH folder with stand-in agents, each a script, and a reader that finds them there. */
function sample(name: string, scripts: Record<string, string>, agents: readonly AgentSetting[], { timeout, environment = {} }: { timeout?: number; environment?: Record<string, string> } = {}) {
	const folder = join(root, name);
	const bin = join(folder, "bin");
	const temporaryRoot = join(folder, "tmp");
	for (const made of [bin, temporaryRoot]) mkdirSync(made, { recursive: true });
	for (const [executable, script] of Object.entries(scripts)) {
		const out = join(folder, executable);
		mkdirSync(out);
		writeFileSync(join(bin, executable), `#!/bin/sh\nOUT='${out}'\n${script}\n`);
		chmodSync(join(bin, executable), 0o755);
	}
	const reader = createSignInReader({
		agents: async () => agents, locate: agent => locateAgent(agent, bin, false), environment: { ...process.env, CURSOR_API_KEY: undefined, ...environment }, temporaryRoot,
		...(timeout === undefined ? {} : { timeoutMilliseconds: timeout }),
	});
	return {
		reader, folder,
		file: (executable: string, file: string) => join(folder, executable, file),
		read: (executable: string, file: string) => readFileSync(join(folder, executable, file), "utf8"),
		ran: (executable: string) => existsSync(join(folder, executable, "runs")),
		left: () => readdirSync(temporaryRoot),
	};
}

async function gone(pid: number): Promise<boolean> {
	return until(() => {
		// A killed child of a killed shell is reaped by init, or stays a zombie.
		const state = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();
		return state === "" || state.startsWith("Z");
	});
}

// The stand-ins are shell scripts, and Windows has no process groups: not tried there.
describe.skipIf(windows)("asking the agents, with stand-ins", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-sign-in-test-")));
	});
	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("each found agent the registry knows is asked, in the order saved, and only its state is answered", async () => {
		const OTHER: AgentSetting = { name: "Aider", command: "aider" };
		const MISSING: AgentSetting = { name: "Grok Build", command: "grok" };
		const s = sample("each", { claude: `${RECORD}\n${SIGNED_IN}`, codex: `${RECORD}\necho 'Not logged in' >&2\nexit 1`, gemini: RECORD, aider: RECORD }, [CODEX, OTHER, GEMINI, MISSING, CLAUDE, CURSOR]);
		const answers = await s.reader.read();
		expect(answers).toEqual([
			{ setting: CODEX, agent: "codex", shown: "codex login status", signIn: { state: "signed-out" } },
			{ setting: GEMINI, agent: "gemini", shown: null, signIn: { state: "not-known", reason: "no-command" } },
			{ setting: CLAUDE, agent: "claude", shown: "claude auth status --json", signIn: { state: "signed-in" } },
		]);
		// What a command printed never leaves.
		expect(JSON.stringify(answers)).not.toContain("sam@example.com");
		expect(JSON.stringify(answers)).not.toContain("Secret Org");
		expect(s.read("claude", "args")).toBe("auth\nstatus\n--json\n");
		expect(s.read("codex", "args")).toBe("login\nstatus\n");
		expect(s.ran("gemini")).toBe(false);
		expect(s.ran("aider")).toBe(false);
	});

	test("only the registry's arguments, nothing to read, an empty folder that is removed, and no session's variables", async () => {
		const setting = { ...CLAUDE, command: "claude --dangerously-skip-permissions 'do this'", configFolder: "~/work-claude" };
		// Reading to the end returns at once: there is nothing to read, so it can never wait for a person.
		const s = sample("plain", { claude: `${RECORD}\ncat > "$OUT/stdin"\nif [ -t 0 ] || [ -t 1 ]; then echo terminal > "$OUT/terminal"; fi\n${SIGNED_IN}` }, [setting], {
			environment: { HOME: "/home/sam", [HANDOFF_VARIABLE]: "/handoff", [STATUS_VARIABLE]: "/status" },
		});
		expect(await s.reader.read()).toEqual([{ setting, agent: "claude", shown: "claude auth status --json", signIn: { state: "signed-in" } }]);
		expect(s.read("claude", "args")).toBe("auth\nstatus\n--json\n");
		expect(s.read("claude", "stdin")).toBe("");
		expect(existsSync(s.file("claude", "terminal"))).toBe(false);
		expect(s.read("claude", "listing")).toBe("");
		expect(s.read("claude", "cwd").trim()).toStartWith(join(s.folder, "tmp", "timber-app-sign-in-"));
		const env = s.read("claude", "env").split("\n");
		expect(env).toContain("CLAUDE_CONFIG_DIR=/home/sam/work-claude");
		expect(env.some(line => line.startsWith(`${HANDOFF_VARIABLE}=`) || line.startsWith(`${STATUS_VARIABLE}=`))).toBe(false);
		expect(s.left()).toEqual([]);
	});

	test("a wrapper picked as an agent, and an agent's name picked as another, are not run", async () => {
		const swapped: AgentSetting = { name: "Swapped", command: "claude", agent: "codex" };
		const s = sample("wrapper", { "claude-work": `${RECORD}\n${SIGNED_IN}`, claude: `${RECORD}\n${SIGNED_IN}` }, [WORK, swapped]);
		expect((await s.reader.read()).map(answer => answer.signIn)).toEqual([{ state: "not-known", reason: "not-asked" }, { state: "not-known", reason: "not-asked" }]);
		expect(s.ran("claude-work")).toBe(false);
		expect(s.ran("claude")).toBe(false);
	});

	test("one that hangs is killed with what it started, and is not known", async () => {
		const s = sample("hang", { claude: `trap '' TERM\nsleep 60 & echo $! > "$OUT/child"; echo run > "$OUT/runs"; wait`, codex: `echo 'Not logged in' >&2; exit 1` }, [CLAUDE, CODEX], { timeout: 1500 });
		const start = Date.now();
		expect((await s.reader.read()).map(answer => answer.signIn)).toEqual([{ state: "not-known", reason: "too-long" }, { state: "signed-out" }]);
		expect(Date.now() - start).toBeLessThan(10_000);
		expect(await gone(Number(s.read("claude", "child")))).toBe(true);
		expect(s.left()).toEqual([]);
	}, 30_000);

	test("one that cannot start, fails, or prints without end is not known", async () => {
		const s = sample("bad", { claude: `exit 3`, codex: `head -c 300000 /dev/zero | tr '\\0' 'x' >&2; echo 'Not logged in' >&2; exit 1` }, [CLAUDE, CODEX]);
		expect((await s.reader.read()).map(answer => answer.signIn)).toEqual([UNREADABLE, UNREADABLE]);
		const gone = sample("gone", { claude: "" }, [CLAUDE]);
		writeFileSync(join(gone.folder, "bin", "claude"), "#!/no/such/interpreter\n");
		expect((await gone.reader.read()).map(answer => answer.signIn)).toEqual([{ state: "not-known", reason: "not-started" }]);
		expect(gone.left()).toEqual([]);
	}, 30_000);

	test.skipIf(Bun.which("setsid") === null)("one that answered in time is read, though a process it left holds its output past the time", async () => {
		const s = sample("left-behind", { claude: `setsid sleep 60 & echo $! > "$OUT/child"; ${SIGNED_IN}` }, [CLAUDE], { timeout: 900 });
		const start = Date.now();
		expect((await s.reader.read()).map(answer => answer.signIn)).toEqual([{ state: "signed-in" }]);
		expect(Date.now() - start).toBeLessThan(10_000);
		Bun.spawnSync(["kill", "-9", s.read("claude", "child").trim()]);
	}, 30_000);

	test("rows that ask the same, and a read during another, share one run; another config folder is its own", async () => {
		const again = { ...CLAUDE, name: "Claude again", command: "claude --continue" };
		const work = { ...CLAUDE, name: "Claude other", configFolder: "/home/sam/other" };
		const s = sample("shared", { claude: `${RECORD}\nsleep 0.4\n${SIGNED_IN}` }, [CLAUDE, again, work]);
		const [one, other] = await Promise.all([s.reader.read(), s.reader.read()]);
		expect(one).toEqual(other);
		expect(one).toHaveLength(3);
		expect(s.read("claude", "runs")).toBe("run\nrun\n");
		// Nothing is kept: a later read asks again.
		await s.reader.read();
		expect(s.read("claude", "runs").trim().split("\n")).toHaveLength(4);
	}, 30_000);

	test("quitting ends every run, and nothing starts after it", async () => {
		const s = sample("quit", { claude: `sleep 60 & echo $! > "$OUT/child"; echo run > "$OUT/runs"; wait` }, [CLAUDE]);
		const reading = s.reader.read();
		expect(await until(() => s.ran("claude"))).toBe(true);
		s.reader.stopAll();
		expect((await reading)[0]!.signIn.state).toBe("not-known");
		expect(await gone(Number(s.read("claude", "child")))).toBe(true);
		expect(await s.reader.read()).toEqual([]);
		expect(s.left()).toEqual([]);
	}, 30_000);

	test("nothing is logged, and the app opens no file", async () => {
		const spies = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error"), spyOn(console, "info"), spyOn(console, "debug")];
		const written = [spyOn(process.stdout, "write"), spyOn(process.stderr, "write")];
		try {
			const s = sample("quiet", { claude: SIGNED_IN, codex: `echo 'Logged in using an API key - sk-***' >&2`, "cursor-agent": `echo '{"status":"authenticated","isAuthenticated":true}'` }, [CLAUDE, CODEX, CURSOR]);
			expect((await s.reader.read()).map(answer => answer.signIn.state)).toEqual(["signed-in", "signed-in", "signed-in"]);
			for (const spy of [...spies, ...written]) expect(spy).not.toHaveBeenCalled();
		} finally {
			for (const spy of [...spies, ...written]) spy.mockRestore();
		}
		// The modules of the read open no file at all: they only make and remove the folder, and follow links.
		for (const module of ["src/bun/agent-sign-in.ts", "src/bun/run-agent.ts", "src/shared/agent-sign-in.ts"]) {
			expect(readFileSync(join(import.meta.dir, "..", module), "utf8")).not.toMatch(/readFile|Bun\.file|createReadStream|\bopen(?:Sync)?\(/);
		}
	}, 30_000);
});

const located = (...agents: AgentSetting[]): AgentLocation[] => agents.map(agent => ({ name: agent.name, command: agent.command, lookup: { state: "found", path: `/usr/local/bin/${agent.command}` } }));
const said = (setting: AgentSetting, signIn: SignInState, shown: string | null = "codex login status", agent: AgentSignIn["agent"] = "codex"): AgentSignIn => ({ setting, agent, shown, signIn });

describe("the Sign-in line in Settings, Agents", () => {
	const line = (setting: AgentSetting, answer: AgentSignIn, locations = located(setting)) => agentSignInLine(setting, [setting], locations, [answer]);

	test("says each state with the command, and why it is not known", () => {
		expect(line(CODEX, said(CODEX, { state: "signed-in" }))).toEqual({ text: "Signed in, says codex login status.", signedOut: false });
		expect(line(CODEX, said(CODEX, { state: "signed-out" }))).toEqual({ text: "Signed out, says codex login status.", signedOut: true });
		const unknown = (why: Extract<SignInState, { state: "not-known" }>) => line(CODEX, said(CODEX, why))!.text;
		expect(unknown({ state: "not-known", reason: "too-long" })).toBe("Not known. codex login status took longer than 5 seconds.");
		expect(unknown({ state: "not-known", reason: "unreadable" })).toBe("Not known. codex login status gave an answer the app does not know.");
		expect(unknown({ state: "not-known", reason: "not-started" })).toBe("Not known. codex login status could not be started.");
		expect(unknown({ state: "not-known", reason: "key-set", variable: "CURSOR_API_KEY" })).toBe("Not known. codex login status says signed out, but CURSOR_API_KEY is set.");
		expect(line(GEMINI, said(GEMINI, { state: "not-known", reason: "no-command" }, null, "gemini"))!.text).toBe("Not known. The app knows no command of Gemini CLI that says.");
		expect(line(WORK, said(WORK, { state: "not-known", reason: "not-asked" }, "claude-work auth status --json", "claude"))!.text).toBe("Not known. The app does not ask claude-work, as it is not named claude.");
	});

	test("is not there for a row not saved as it is, not found, or not asked yet", () => {
		const answer = said(CODEX, { state: "signed-in" });
		expect(agentSignInLine(CODEX, [CODEX], located(CODEX), null)).toBeNull();
		expect(agentSignInLine(CODEX, [CODEX], null, [answer])).toBeNull();
		expect(agentSignInLine(CODEX, [CODEX], [{ ...CODEX, lookup: { state: "not-found" } }], [answer])).toBeNull();
		expect(agentSignInLine({ ...CODEX, configFolder: "/other" }, [CODEX], located(CODEX), [answer])).toBeNull();
		// Saved since with another config folder: the answer was for the old one.
		const moved = { ...CODEX, configFolder: "/other" };
		expect(agentSignInLine(moved, [moved], located(CODEX), [answer])).toBeNull();
	});

	test("is drawn under the Found line, signed out in the error color, and goes while the row is edited", () => {
		const noop = () => {};
		const signIns = [said(CLAUDE, { state: "signed-in" }, "claude auth status --json", "claude"), said(CODEX, { state: "signed-out" })];
		const drafts = agentDraftsOf(DEFAULT_AGENTS);
		const view = (shown: typeof drafts) => renderToStaticMarkup(
			<AgentsSectionView drafts={shown} saved={DEFAULT_AGENTS} locations={located(CLAUDE, CODEX)} signIns={signIns} save={{ state: "idle" }} onAdd={noop} onEdit={noop} onRemove={noop} onSave={noop} />,
		);
		const markup = view(drafts);
		expect(markup).toContain('Found at /usr/local/bin/claude</p><div class="agent-sign-in"><p class="field-hint"><span class="agent-status-label">Sign-in</span> Signed in, says claude auth status --json.</p></div>');
		expect(markup).toContain('<p class="field-error" role="status">Sign-in: Signed out, says codex login status.</p>');
		expect(view(editAgentDraft(drafts, drafts[1]!.key, { command: "codex --model big" }))).not.toContain("Signed out");
	});
});

describe("the Agent field", () => {
	const signedOut = [said(CODEX, { state: "signed-out" })];
	const pick = (agent: AgentSetting, unread = false) => ({ source: "pick" as const, agent, workflow: unread ? "review" : null, unread });

	test("marks a signed out agent and says so when picked, without changing what is picked", () => {
		const locations = located(CLAUDE, CODEX);
		expect(agentOptionLabel(CODEX, locations, signedOut)).toBe("Codex (signed out)");
		expect(agentOptionLabel(CLAUDE, locations, signedOut)).toBe("Claude Code");
		expect(agentPickHint([CLAUDE, CODEX], locations, pick(CODEX), null, signedOut)).toBe("Codex says it is signed out. Starts in the worktree once this dialog has created it, never in one that was already there.");
		expect(agentPickHint([CLAUDE, CODEX], locations, pick(CODEX, true), null, signedOut)).toStartWith("Codex says it is signed out. The review workflow could not be read yet.");
		expect(agentPickHint([CLAUDE, CODEX], locations, pick(CODEX), "Codex", signedOut)).toStartWith("This repository's default agent. Codex says it is signed out. Starts in the worktree");
		expect(agentPickHint([CLAUDE, CODEX], locations, pick(CLAUDE), null, signedOut)).toStartWith("Starts in the worktree");
		// Signed out never changes the default agent: it is not asked for.
		expect(chosenAgent([CODEX, CLAUDE], undefined, located(CODEX, CLAUDE), null)).toEqual(CODEX);
		const markup = renderToStaticMarkup(<AgentField agents={[CLAUDE, CODEX]} locations={locations} signIns={signedOut} plan={pick(CODEX)} repositoryAgent={null} onPick={() => {}} />);
		expect(markup).toContain("Codex (signed out)</option>");
		expect(markup).toContain("Codex says it is signed out.");
	});

	test("marks neither signed in nor not known, and not found wins", () => {
		const locations = located(CODEX);
		expect(agentOptionLabel(CODEX, locations, [said(CODEX, { state: "signed-in" })])).toBe("Codex");
		expect(agentOptionLabel(CODEX, locations, [said(CODEX, { state: "not-known", reason: "too-long" })])).toBe("Codex");
		const missing: AgentLocation[] = [{ ...CODEX, lookup: { state: "not-found" } }];
		expect(agentOptionLabel(CODEX, missing, signedOut)).toBe("Codex (not found)");
		expect(agentPickHint([CODEX], missing, pick(CODEX), null, signedOut)).toStartWith("Codex was not found");
		// The answer was for another command.
		expect(agentOptionLabel({ ...CODEX, command: "codex --oss" }, [{ ...CODEX, command: "codex --oss", lookup: { state: "found", path: "/usr/local/bin/codex" } }], signedOut)).toBe("Codex");
	});
});

describe("when the store asks", () => {
	async function started() {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		return { engine, store };
	}

	test("never at start, and again when the saved agents change", async () => {
		const { engine, store } = await started();
		expect(engine.signInRequests()).toBe(0);
		expect(store.getState().agentSignIns).toBeNull();
		engine.setSignIn("codex", { state: "signed-out" });
		await store.savePreferences({ sidebarSide: "right" });
		await settle();
		expect(engine.signInRequests()).toBe(0);
		await store.savePreferences({ agents: [CODEX, WORK, GEMINI] });
		await settle();
		expect(engine.signInRequests()).toBe(1);
		expect(store.getState().agentSignIns?.map(answer => answer.signIn)).toEqual([{ state: "signed-out" }, { state: "not-known", reason: "not-asked" }, { state: "not-known", reason: "no-command" }]);
	});

	test("a dialog asks only when the last answer is over a minute old; Settings always asks", async () => {
		const { engine, store } = await started();
		const controller = createWorktreeDialogController(store, "/work/timber", createSubmission(() => {}));
		const clock = spyOn(Date, "now");
		try {
			clock.mockReturnValue(1_000_000);
			controller.readSignIns();
			controller.readSignIns();
			await settle();
			expect(engine.signInRequests()).toBe(1);
			clock.mockReturnValue(1_059_000);
			controller.readSignIns();
			await settle();
			expect(engine.signInRequests()).toBe(1);
			await store.loadAgentSignIns();
			expect(engine.signInRequests()).toBe(2);
			clock.mockReturnValue(1_119_000);
			controller.readSignIns();
			await settle();
			expect(engine.signInRequests()).toBe(3);
			// A clock set back does not keep an old answer.
			clock.mockReturnValue(500);
			controller.readSignIns();
			await settle();
			expect(engine.signInRequests()).toBe(4);
		} finally {
			clock.mockRestore();
		}
	});

	test("a look that fails keeps what was known, and the next one asks again", async () => {
		const { engine, store } = await started();
		engine.setSignIn("codex", { state: "signed-out" });
		await store.loadAgentSignIns();
		const known = store.getState().agentSignIns;
		engine.failSignIns(true);
		await store.loadAgentSignIns();
		expect(store.getState().agentSignIns).toBe(known);
		engine.failSignIns(false);
		await store.loadAgentSignIns(60_000);
		expect(engine.signInRequests()).toBe(3);
	});

	test("an answer older than the one shown is dropped", async () => {
		const { engine, store } = await started();
		const answers: ((value: AgentSignIn[]) => void)[] = [];
		engine.agentSignIns = () => new Promise(resolve => answers.push(resolve));
		const first = store.loadAgentSignIns();
		const second = store.loadAgentSignIns();
		answers[1]!([said(CODEX, { state: "signed-in" })]);
		await second;
		answers[0]!([said(CODEX, { state: "signed-out" })]);
		await first;
		expect(store.getState().agentSignIns?.[0]!.signIn).toEqual({ state: "signed-in" });
	});
});
