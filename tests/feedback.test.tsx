import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { OperationDialog } from "../src/mainview/components/OperationDialog";
import { TimberFailureDetails } from "../src/mainview/components/TimberFailureDetails";
import { createMockEngine } from "../src/mainview/engine/mock";
import { OUTPUT_PRIVACY_NOTE } from "../src/mainview/format";
import { TOAST_MILLISECONDS } from "../src/mainview/store/state";
import { type Schedule, createAppStore } from "../src/mainview/store/store";
import { type SubmissionOutcome, createSubmission } from "../src/mainview/store/submission";
import type { TimberFailure } from "../src/shared/model";

const settle = () => Bun.sleep(0);

/** A clock the test moves by hand, in place of real timers. */
function manualClock() {
	let now = 0;
	let waiting: { at: number; task: () => void }[] = [];
	const schedule: Schedule = (task, milliseconds) => {
		const entry = { at: now + milliseconds, task };
		waiting.push(entry);
		return () => {
			waiting = waiting.filter(candidate => candidate !== entry);
		};
	};
	return {
		schedule,
		waiting: () => waiting.length,
		advance(milliseconds: number) {
			now += milliseconds;
			const due = waiting.filter(entry => entry.at <= now);
			waiting = waiting.filter(entry => entry.at > now);
			for (const entry of due) entry.task();
		},
	};
}

async function startedStore() {
	const clock = manualClock();
	const engine = createMockEngine();
	const store = createAppStore(engine, clock.schedule);
	store.start();
	await settle();
	return { store, engine, clock };
}

const texts = (store: { getState(): { toasts: readonly { text: string }[] } }) => store.getState().toasts.map(toast => toast.text);

describe("toasts", () => {
	test("a toast disappears on its own after its time", async () => {
		const { store, clock } = await startedStore();
		store.showToast("Worktree created");
		expect(texts(store)).toEqual(["Worktree created"]);
		clock.advance(TOAST_MILLISECONDS - 1);
		expect(texts(store)).toEqual(["Worktree created"]);
		clock.advance(1);
		expect(texts(store)).toEqual([]);
	});

	test("each toast keeps its own time", async () => {
		const { store, clock } = await startedStore();
		store.showToast("Worktree created");
		clock.advance(2000);
		store.showToast("Removed feature/login");
		clock.advance(TOAST_MILLISECONDS - 2000);
		expect(texts(store)).toEqual(["Removed feature/login"]);
		clock.advance(2000);
		expect(texts(store)).toEqual([]);
	});

	test("a dismissed toast goes at once, and its timer is called off", async () => {
		const { store, clock } = await startedStore();
		store.showToast("Worktree created");
		store.showToast("Removed feature/login");
		store.dismissToast(store.getState().toasts[0]!.id);
		expect(texts(store)).toEqual(["Removed feature/login"]);
		expect(clock.waiting()).toBe(1);
		store.dismissToast(999);
		expect(texts(store)).toEqual(["Removed feature/login"]);
	});

	test("listeners hear a toast arrive and leave", async () => {
		const { store, clock } = await startedStore();
		let heard = 0;
		store.subscribe(() => heard++);
		store.showToast("Worktree created");
		clock.advance(TOAST_MILLISECONDS);
		expect(heard).toBe(2);
	});

	test("adding a repository shows a toast, which the app renders and then drops", async () => {
		const { store, clock } = await startedStore();
		await store.addRepository();
		expect(texts(store)).toEqual(["Added docs-site"]);
		let markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toMatch(/class="toasts" aria-live="polite">.*?class="toast-text">Added docs-site</);
		expect(markup).toContain('aria-label="Dismiss: Added docs-site"');

		clock.advance(TOAST_MILLISECONDS);
		markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('<div class="toasts" aria-live="polite"></div>');
	});

	test("removing a repository shows a toast that names it", async () => {
		const { store } = await startedStore();
		await store.removeRepository("/work/api-server");
		expect(texts(store)).toEqual(["Removed api-server from the list"]);
	});

	test("an add that changed nothing shows no toast", async () => {
		const { store, engine } = await startedStore();
		engine.pickFolder("/home/sam/Documents");
		await store.addRepository();
		engine.pickFolder(null);
		await store.addRepository();
		engine.pickFolder("/work/timber");
		await store.addRepository();
		expect(texts(store)).toEqual([]);
	});
});

const failure: TimberFailure = {
	command: "timber new feat/login --result-file <temporary file> --no-editor --no-agent",
	diagnostic: "Branch feat/login is already checked out at /work/sample-worktrees/feat-login. Use timber open instead.",
	output: { text: "error: Branch feat/login is already checked out\n", truncated: false },
};

/** A task that waits until the test lets it end. */
function held() {
	let finish!: (outcome: SubmissionOutcome) => void;
	const outcome = new Promise<SubmissionOutcome>(resolve => {
		finish = resolve;
	});
	let started = 0;
	return { task: () => (started++, outcome), finish, started: () => started };
}

describe("createSubmission", () => {
	test("a run that works ends the running state and hands on the toast", async () => {
		const toasts: string[] = [];
		const submission = createSubmission(toast => toasts.push(toast));
		const { task, finish } = held();
		const done = submission.submit(task);
		expect(submission.getState()).toEqual({ running: true, failure: null });
		expect(toasts).toEqual([]);
		finish({ ok: true, toast: "Worktree created" });
		expect(await done).toBe(true);
		expect(submission.getState()).toEqual({ running: false, failure: null });
		expect(toasts).toEqual(["Worktree created"]);
	});

	test("a run that fails keeps the failure and shows no toast", async () => {
		const toasts: string[] = [];
		const submission = createSubmission(toast => toasts.push(toast));
		expect(await submission.submit(async () => ({ ok: false, failure }))).toBe(false);
		expect(submission.getState()).toEqual({ running: false, failure });
		expect(toasts).toEqual([]);
	});

	test("a second submission while one runs does nothing", async () => {
		const submission = createSubmission(() => {});
		const first = held();
		const second = held();
		const done = submission.submit(first.task);
		expect(await submission.submit(second.task)).toBe(false);
		expect(second.started()).toBe(0);
		expect(submission.getState().running).toBe(true);
		first.finish({ ok: false, failure });
		await done;
		expect(first.started()).toBe(1);
	});

	test("after a failure, a retry clears it while it runs and can then work", async () => {
		const toasts: string[] = [];
		const submission = createSubmission(toast => toasts.push(toast));
		await submission.submit(async () => ({ ok: false, failure }));
		const retry = held();
		const done = submission.submit(retry.task);
		expect(submission.getState()).toEqual({ running: true, failure: null });
		retry.finish({ ok: true, toast: "Worktree created" });
		expect(await done).toBe(true);
		expect(toasts).toEqual(["Worktree created"]);
	});

	test("a task that throws is a failure with the error as the diagnostic", async () => {
		const submission = createSubmission(() => {});
		expect(await submission.submit(async () => {
			throw new Error("The request timed out");
		})).toBe(false);
		expect(submission.getState()).toEqual({ running: false, failure: { command: null, diagnostic: "The request timed out", output: null } });
	});

	test("clearFailure puts the failure away, but not while a run is in progress", async () => {
		const submission = createSubmission(() => {});
		let heard = 0;
		submission.subscribe(() => heard++);
		await submission.submit(async () => ({ ok: false, failure }));
		submission.clearFailure();
		expect(submission.getState()).toEqual({ running: false, failure: null });
		expect(heard).toBe(3);
		submission.clearFailure();
		expect(heard).toBe(3);
		const { task, finish } = held();
		const done = submission.submit(task);
		submission.clearFailure();
		expect(submission.getState().running).toBe(true);
		finish({ ok: true, toast: "Done" });
		await done;
	});
});

describe("TimberFailureDetails", () => {
	const render = (shown: TimberFailure) => renderToStaticMarkup(<TimberFailureDetails title="Could not create the worktree" failure={shown} />);

	test("shows the diagnostic, with the command and the output in a details area that starts closed", () => {
		const markup = render(failure);
		expect(markup).toContain('role="alert"');
		expect(markup).toContain('<p class="failure-title">Could not create the worktree</p>');
		expect(markup).toContain(`<p class="failure-diagnostic">${failure.diagnostic}</p>`);
		expect(markup).toContain('<details class="failure-details"><summary>Details</summary>');
		expect(markup).not.toContain("<details open");
		expect(markup).toContain("timber new feat/login --result-file &lt;temporary file&gt; --no-editor --no-agent");
		expect(markup).toContain("error: Branch feat/login is already checked out\n</pre>");
		expect(markup).toContain("What the command printed.");
		expect(markup).toContain(OUTPUT_PRIVACY_NOTE);
	});

	test("says when only the end of the output was kept", () => {
		const markup = render({ ...failure, output: { text: "the last line\n", truncated: true } });
		expect(markup).toContain("The command printed more than is kept. This is the end of it.");
	});

	test("says when the command printed nothing", () => {
		const markup = render({ ...failure, output: { text: "", truncated: false } });
		expect(markup).toContain("The command printed nothing.");
		expect(markup).not.toContain("failure-output");
	});

	test("output is shown as text, never as markup", () => {
		const markup = render({ ...failure, output: { text: "<script>alert(1)</script>", truncated: false } });
		expect(markup).not.toContain("<script>");
		expect(markup).toContain("&lt;script&gt;");
	});

	test("a failure before any command ran has no details area", () => {
		const markup = render({ command: null, diagnostic: "The request timed out", output: null });
		expect(markup).toContain("The request timed out");
		expect(markup).not.toContain("<details");
	});
});

describe("OperationDialog", () => {
	const render = (submission: { running: boolean; failure: TimberFailure | null }, canSubmit = true) => renderToStaticMarkup(
		<OperationDialog
			title="New worktree"
			command={failure.command!}
			submission={submission}
			submitLabel="Create worktree"
			runningLabel="Creating the worktree"
			failureTitle="Could not create the worktree"
			canSubmit={canSubmit}
			onSubmit={() => {}}
			onClose={() => {}}
		>
			<input name="name" />
		</OperationDialog>,
	);

	test("shows the command before it runs, with the controls ready", () => {
		const markup = render({ running: false, failure: null });
		expect(markup).toContain('<pre class="dialog-command" aria-label="Command that will run">timber new feat/login --result-file &lt;temporary file&gt; --no-editor --no-agent</pre>');
		expect(markup).toContain('<fieldset class="dialog-fields">');
		expect(markup).toContain('<button type="button" class="button quiet">Cancel</button>');
		expect(markup).toContain('<button type="submit" class="button primary">Create worktree</button>');
		expect(markup).toContain('aria-busy="false"');
		expect(markup).not.toContain("progressbar");
		expect(markup).not.toContain('role="alert"');
	});

	test("while running: fields and buttons are disabled and progress is shown", () => {
		const markup = render({ running: true, failure: null });
		expect(markup).toContain('<fieldset class="dialog-fields" disabled="">');
		expect(markup).toContain('<button type="button" class="button quiet" disabled="">Cancel</button>');
		expect(markup).toContain('<button type="submit" class="button primary" disabled="">Running</button>');
		expect(markup).toContain('role="progressbar" aria-label="Creating the worktree"');
		expect(markup).toContain('<p class="dialog-progress-text" role="status">Creating the worktree</p>');
		expect(markup).toContain('aria-busy="true"');
	});

	test("after a failure: the diagnostic shows and the controls are ready for a retry", () => {
		const markup = render({ running: false, failure });
		expect(markup).toContain('role="alert"');
		expect(markup).toContain(failure.diagnostic);
		expect(markup).toContain('<fieldset class="dialog-fields">');
		expect(markup).toContain('<button type="submit" class="button primary">Create worktree</button>');
		expect(markup).not.toContain("progressbar");
	});

	test("fields that do not make a command yet disable only the submit button", () => {
		const markup = render({ running: false, failure: null }, false);
		expect(markup).toContain('<button type="submit" class="button primary" disabled="">Create worktree</button>');
		expect(markup).toContain('<button type="button" class="button quiet">Cancel</button>');
	});
});
