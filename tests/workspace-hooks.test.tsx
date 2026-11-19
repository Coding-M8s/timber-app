import { describe, expect, test } from "bun:test";
import * as React from "react";
import { Workspace } from "../src/mainview/components/Workspace";
import { PullRequestPanel } from "../src/mainview/components/PullRequestPanel";
import { createMockEngine } from "../src/mainview/engine/mock";
import { selectedWorktree } from "../src/mainview/store/state";
import { type AppStore, createAppStore } from "../src/mainview/store/store";

const settle = async () => {
	for (let round = 0; round < 10; round++) await Bun.sleep(0);
};

type Internals = { H: unknown };
const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: Internals })
	.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/**
 * Calls a component as React would, with a stand-in hook dispatcher that
 * answers the store's hooks, and returns the hooks it called in order.
 * React requires the same hooks on every render; a component that calls one
 * only on some renders throws "Rendered more hooks than during the previous
 * render" (minified error #310) and leaves the window blank.
 */
function hooksCalledBy(store: AppStore, render: () => unknown): string[] {
	const called: string[] = [];
	const dispatcher = new Proxy({}, {
		get: (_target, name: string) => (...args: unknown[]) => {
			called.push(name);
			if (name === "useContext") return store;
			if (name === "useSyncExternalStore") return (args[1] as () => unknown)();
			throw new Error(`The stand-in dispatcher does not answer ${name}.`);
		},
	});
	const previous = internals.H;
	internals.H = dispatcher;
	try {
		render();
	} finally {
		internals.H = previous;
	}
	return called;
}

describe("the workspace calls the same hooks on every render", () => {
	test("before the first answer and once a worktree is selected", async () => {
		const store = createAppStore(createMockEngine(), () => () => {});
		const empty = hooksCalledBy(store, () => Workspace());
		expect(selectedWorktree(store.getState())).toBeNull();

		store.start();
		await settle();
		const first = store.getState().repositories[0]!.worktrees[0]!;
		store.select(first.id);
		expect(selectedWorktree(store.getState())).not.toBeNull();

		expect(hooksCalledBy(store, () => Workspace())).toEqual(empty);
	});

	test("the pull request tab calls the same hooks whatever the pull request's state", async () => {
		const store = createAppStore(createMockEngine(), () => () => {});
		store.start();
		await settle();
		const repository = store.getState().repositories[0]!;
		const counts = repository.worktrees.map(worktree => hooksCalledBy(store, () => PullRequestPanel({ repository, worktree })));
		expect(new Set(counts.map(hooks => hooks.join(","))).size).toBe(1);
	});
});
