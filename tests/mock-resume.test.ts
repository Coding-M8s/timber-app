import { describe, expect, test } from "bun:test";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";

const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const request = { repository: TIMBER, worktree: FEATURE, cols: 90, rows: 30 };

async function endedAgent(name = "Claude Code") {
	const engine = createMockEngine(sampleRepositories);
	const opened = await engine.openTerminal({ ...request, agent: name });
	if (opened.outcome !== "opened") throw new Error(JSON.stringify(opened));
	const id = opened.session.id;
	engine.endTerminal(id, 0);
	const session = async () => (await engine.listTerminals()).find(candidate => candidate.id === id)!;
	return { engine, id, session, conversation: engine.conversationOf(id) };
}

describe("the mock engine offers an ended agent its conversation back", () => {
	test("an agent from Settings that ends carries a ready offer with the command to run by hand", async () => {
		const { session, id, engine } = await endedAgent();
		// The conversation is the pretend one, read from the session before it ended.
		const ended = (await session()).endedAgent!;
		expect(ended.resume).toMatchObject({ state: "ready", command: expect.stringMatching(/^claude --resume [0-9a-f-]{36}/) });
		expect(engine.conversationOf(id)).toBeNull();
	});

	test("a conversation that is gone is offered as gone", async () => {
		const engine = createMockEngine(sampleRepositories);
		const opened = await engine.openTerminal({ ...request, agent: "Claude Code" });
		if (opened.outcome !== "opened") throw new Error(JSON.stringify(opened));
		engine.missingConversations([engine.conversationOf(opened.session.id)!]);
		engine.endTerminal(opened.session.id, 0);
		expect((await engine.listTerminals())[0]!.endedAgent!.resume).toEqual({ state: "unavailable", reason: "gone" });
	});

	test("a shell, which has no agent, ends with no mark", async () => {
		const engine = createMockEngine(sampleRepositories);
		const opened = await engine.openTerminal(request);
		if (opened.outcome !== "opened") throw new Error(JSON.stringify(opened));
		expect((await engine.resumeAgent(opened.session.id)).outcome).toBe("failed");
	});

	test("resumeAgent starts the agent again in the same session, in its conversation, and says so", async () => {
		const { engine, id, session } = await endedAgent();
		const conversation = (await session()).endedAgent!.conversation!;
		const result = await engine.resumeAgent(id);
		if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
		expect(result.session).toMatchObject({ id, kind: "agent", state: { kind: "running" } });
		expect(result.session.endedAgent).toBeUndefined();
		expect(result.session.command).toContain(`--resume ${conversation}`);
		expect(engine.conversationOf(id)).toBe(conversation);
		expect((await engine.readTerminal(id))!.data).toContain("Resuming Claude Code in its conversation.");
		// The same agent ending again is offered again, and a second click while it runs is refused.
		expect((await engine.resumeAgent(id)).outcome).toBe("failed");
		engine.endTerminal(id, 0);
		expect((await session()).endedAgent!.resume).toMatchObject({ state: "ready", conversation });
	});

	test("a conversation gone by the click is refused and the offer turns to gone", async () => {
		const { engine, id, session } = await endedAgent();
		engine.missingConversations([(await session()).endedAgent!.conversation!]);
		const result = await engine.resumeAgent(id);
		expect(result).toMatchObject({ outcome: "failed", message: expect.stringContaining("Nothing was started.") });
		expect(await session()).toMatchObject({ kind: "terminal", endedAgent: { resume: { state: "unavailable", reason: "gone" } } });
	});
});
