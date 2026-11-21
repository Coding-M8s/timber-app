import { describe, expect, test } from "bun:test";
import { type QuitGuardDependencies, createQuitGuard } from "../src/bun/quit-guard";

function setup(overrides: Partial<QuitGuardDependencies> = {}) {
	const events: string[] = [];
	let live = 2;
	let asked = 0;
	const dependencies: QuitGuardDependencies = {
		liveCount: () => live,
		ask: async () => {
			asked += 1;
			events.push("ask");
			return true;
		},
		endAll: async () => {
			events.push("endAll");
			live = 0;
		},
		quit: () => {
			events.push("quit");
			return true;
		},
		save: () => events.push(`save:${live}`),
		resume: () => events.push("resume"),
		...overrides,
	};
	const guard = createQuitGuard(dependencies);
	return { guard, events, asked: () => asked, setLive: (count: number) => { live = count; } };
}

const settle = () => Bun.sleep(0);

describe("asking before quitting", () => {
	test("with nothing running, quitting may go ahead and nobody is asked", () => {
		const { guard, events, setLive } = setup();
		setLive(0);
		expect(guard.mayQuit()).toBe(true);
		expect(events).toEqual([]);
	});

	test("while a session runs, quitting waits and the window is asked once", async () => {
		const { guard, asked } = setup();
		expect(guard.mayQuit()).toBe(false);
		expect(guard.mayQuit()).toBe(false);
		await settle();
		expect(asked()).toBe(1);
	});

	test("the person agreed: saved, then ended, then quit", async () => {
		const { guard, events } = setup();
		expect(await guard.confirm()).toBe(true);
		expect(events).toEqual(["save:2", "endAll", "quit"]);
		expect(guard.mayQuit()).toBe(true);
	});

	test("a window that cannot show the question: still saved, then quit", async () => {
		for (const ask of [async () => false, async () => { throw new Error("no window"); }]) {
			const { guard, events } = setup({ ask });
			expect(guard.mayQuit()).toBe(false);
			await settle();
			await settle();
			expect(events).toEqual(["save:2", "endAll", "quit"]);
		}
	});

	test("a save that throws does not keep the app open", async () => {
		const { guard, events } = setup({ save: () => { throw new Error("disk full"); } });
		expect(await guard.confirm()).toBe(true);
		expect(events).toEqual(["endAll", "quit"]);
	});

	test("when quitting did not start, saving is resumed and the next try asks again", async () => {
		const { guard, events, asked, setLive } = setup({ quit: () => false });
		expect(await guard.confirm()).toBe(false);
		expect(events).toEqual(["save:2", "endAll", "resume"]);
		setLive(1);
		expect(guard.mayQuit()).toBe(false);
		await settle();
		expect(asked()).toBe(1);
	});

	test("the save runs before any session ends", async () => {
		const { guard, events } = setup();
		await guard.confirm();
		expect(events[0]).toBe("save:2");
	});

	test("agreeing takes no longer than ending the sessions", async () => {
		const { guard } = setup();
		const started = performance.now();
		await guard.confirm();
		expect(performance.now() - started).toBeLessThan(50);
	});

	test("without a save, quitting works as before", async () => {
		const events: string[] = [];
		const guard = createQuitGuard({ liveCount: () => 1, ask: async () => true, endAll: async () => { events.push("endAll"); }, quit: () => (events.push("quit"), true) });
		expect(await guard.confirm()).toBe(true);
		expect(events).toEqual(["endAll", "quit"]);
	});

	test("an update quits its own way: saved, ended, then its quit, and the quit it asks for goes ahead", async () => {
		const { guard, events } = setup();
		const started = await guard.confirmWith(async () => {
			events.push("apply");
			// The updater asks before quitting, as any quit does.
			events.push(`mayQuit:${guard.mayQuit()}`);
			return true;
		});
		expect(started).toBe(true);
		expect(events).toEqual(["save:2", "endAll", "apply", "mayQuit:true"]);
	});

	test("an update whose quit did not start resumes saving, and the next quit asks again", async () => {
		const { guard, events, setLive } = setup();
		expect(await guard.confirmWith(async () => false)).toBe(false);
		expect(events).toContain("resume");
		setLive(1);
		expect(guard.mayQuit()).toBe(false);
	});
});
