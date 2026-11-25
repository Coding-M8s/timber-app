import { describe, expect, test } from "bun:test";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";

const TIMBER = sampleRepositories[0]!.path;
const paths = (repositories: readonly { path: string; worktrees: readonly { path: string }[] }[], repository: string) =>
	repositories.find(candidate => candidate.path === repository)!.worktrees.map(worktree => worktree.path);

describe("the mock engine's worktree order", () => {
	test("is kept for that repository, read back by a list and by a single read, and leaves the others alone", async () => {
		const engine = createMockEngine();
		const natural = paths(await engine.listRepositories(), TIMBER);
		const reversed = [...natural].reverse();
		expect(await engine.reorderWorktrees(TIMBER, reversed)).toEqual({ outcome: "saved" });
		expect(paths(await engine.listRepositories(), TIMBER)).toEqual(reversed);
		expect((await engine.loadRepository(TIMBER))!.worktrees.map(worktree => worktree.path)).toEqual(reversed);
		const others = (await engine.listRepositories()).filter(repository => repository.path !== TIMBER);
		expect(others.map(repository => repository.worktrees.map(worktree => worktree.path))).toEqual(sampleRepositories.filter(repository => repository.path !== TIMBER).map(repository => repository.worktrees.map(worktree => worktree.path)));
	});

	test("shows a worktree it does not name after the ones it names, and skips a path that is not listed", async () => {
		const engine = createMockEngine();
		const natural = paths(await engine.listRepositories(), TIMBER);
		await engine.reorderWorktrees(TIMBER, ["/never/listed", natural[1]!]);
		expect(paths(await engine.listRepositories(), TIMBER)).toEqual([natural[1]!, ...natural.filter(path => path !== natural[1])]);
	});

	test("changes nothing for a repository it does not list, and an empty order forgets it", async () => {
		const engine = createMockEngine();
		const natural = paths(await engine.listRepositories(), TIMBER);
		expect(await engine.reorderWorktrees("/work/never-listed", ["/x"])).toEqual({ outcome: "saved" });
		await engine.reorderWorktrees(TIMBER, [...natural].reverse());
		await engine.reorderWorktrees(TIMBER, []);
		expect(paths(await engine.listRepositories(), TIMBER)).toEqual(natural);
	});
});
