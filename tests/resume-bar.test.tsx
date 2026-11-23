import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { sessionsOf } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { describeResumeOffer } from "../src/mainview/terminal-format";
import type { EndedAgent } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

const ended = (change: Partial<EndedAgent> = {}): EndedAgent => ({
	name: "Claude", agent: "Claude Code", program: "claude", resumable: "claude", conversation: "abc", command: "claude", exitCode: 0, signal: null,
	resume: { state: "ready", conversation: "abc", command: "claude --resume abc" }, ...change,
});

describe("the words of the resume bar", () => {
	test("a ready offer leads with how the agent ended and offers Resume and the command", () => {
		expect(describeResumeOffer(ended())).toEqual({
			lead: "Claude ended. Exited with code 0.",
			canResume: true,
			resumeTitle: "Ends this shell and starts Claude again in its conversation.",
			reason: null,
			command: "claude --resume abc",
		});
		expect(describeResumeOffer(ended({ exitCode: null, signal: "SIGKILL", resume: { state: "ready", conversation: "abc", command: null } }))).toMatchObject({ lead: "Claude ended. Stopped by SIGKILL.", canResume: true, command: null });
	});

	test("each reason an agent cannot go back is a sentence naming the agent", () => {
		const reason = (why: "never-saved" | "gone" | "not-known") => describeResumeOffer(ended({ resume: { state: "unavailable", reason: why } }));
		expect(reason("never-saved")).toMatchObject({ canResume: false, command: null, reason: "Claude saved no conversation, so there is nothing to resume." });
		expect(reason("gone")!.reason).toBe("Claude's conversation is no longer in its folder, so it cannot be resumed.");
		expect(reason("not-known")!.reason).toBe("The app could not tell which conversation Claude was in, so it cannot be resumed.");
	});

	test("nothing is shown when no offer was made", () => {
		expect(describeResumeOffer(ended({ resume: null }))).toBeNull();
	});
});

/** A store with an agent from Settings that ended in the feature worktree, which shows. */
async function withEnded(agent = "Claude Code", gone = false) {
	const engine = createMockEngine();
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	// An agent the registry has no way back for, saved the way Settings saves it.
	await store.savePreferences({ agents: [...store.getState().preferences.agents, { name: "Gemini CLI", command: "gemini" }] });
	store.select(featureId);
	await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, agent });
	await settle();
	const [opened] = sessionsOf(store.getState(), featureId);
	if (gone) engine.missingConversations([engine.conversationOf(opened!.id)!]);
	engine.endTerminal(opened!.id, 0);
	await settle();
	store.showSession(opened!.id);
	const current = () => store.getState().terminals.find(session => session.id === opened!.id)!;
	return { engine, store, id: opened!.id, current };
}

describe("the resume bar over a shell an agent left", () => {
	test("Resume is offered, and using it makes the chip an agent again", async () => {
		const { store, id, current } = await withEnded();
		const before = render(store);
		expect(before).toContain("Claude Code ended. Exited with code 0.");
		expect(before).toContain('title="Ends this shell and starts Claude Code again in its conversation."');
		expect(before).toContain(">Resume</button>");
		expect(current().kind).toBe("terminal");
		await store.resumeAgent(id);
		await settle();
		expect(current()).toMatchObject({ kind: "agent", state: { kind: "running" } });
		expect(current().endedAgent).toBeUndefined();
		expect(render(store)).not.toContain("resume-bar");
		expect(store.getState().terminalProblem).toBeNull();
	});

	test("Resume says Resuming and waits while a session starts in the worktree", async () => {
		const { store, id } = await withEnded();
		const starting = store.resumeAgent(id);
		const during = render(store);
		expect(during).toContain("Resuming</button>");
		expect(during).toMatch(/<button[^>]*disabled=""[^>]*title="Ends this shell/);
		await starting;
	});

	test("a conversation that is gone shows the reason and no button", async () => {
		const { store } = await withEnded("Claude Code", true);
		const markup = render(store);
		expect(markup).toContain("Claude Code&#x27;s conversation is no longer in its folder, so it cannot be resumed.");
		expect(markup).not.toContain(">Resume</button>");
		expect(markup).not.toContain("Copy command");
	});

	test("the command shows with Copy, which writes it to the clipboard", async () => {
		const { engine, store, current } = await withEnded();
		const offer = current().endedAgent!.resume;
		if (offer?.state !== "ready" || offer.command === null) throw new Error("no command");
		expect(render(store)).toContain(`aria-label="Command to resume by hand">${offer.command}</code>`);
		expect(render(store)).toContain(">Copy command</button>");
		await store.copyText(offer.command);
		expect(await engine.readClipboard()).toBe(offer.command);
	});

	test("an agent with no way back leaves the plain shell, with no bar", async () => {
		const { store, current } = await withEnded("Gemini CLI");
		expect(current().endedAgent).toMatchObject({ name: "Gemini CLI", resume: null });
		expect(render(store)).not.toContain("resume-bar");
	});
});
