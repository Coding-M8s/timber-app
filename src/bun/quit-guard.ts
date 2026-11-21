/**
 * Asking before quitting while terminals run.
 *
 * Electrobun asks the main process, without waiting, whether the app may quit
 * (`before-quit`) and whether the window may close (`will-close`). While a
 * terminal session runs and the person has not agreed, the answer is no, and
 * the window is asked to show the question. When the person agrees, which
 * sessions run is saved first, so they open again on the next launch (see
 * ./session-layout.ts), then every session is ended and the app quits for
 * real. The save is synchronous and bounded, so no timer guards it.
 *
 * A window that does not say in time that it shows the question cannot ask
 * anyone, so the app quits then too. That is also what happens when
 * Electrobun's native side has already stopped drawing the window, as it
 * does on SIGTERM: holding the app back then would leave it running with a
 * window that no longer draws or closes. A native dialog is no way out
 * there, because it needs the same stopped event loop.
 */
export interface QuitGuardDependencies {
	/** How many terminal sessions still run. */
	liveCount: () => number;
	/** Ask in the window. Answers whether the window shows the question; may throw or time out. */
	ask: (live: number) => Promise<boolean>;
	/** End every session. */
	endAll: () => Promise<void>;
	/** Start quitting. It asks `mayQuit` again, which then says yes. Answers whether quitting started. */
	quit: () => boolean;
	/** Save which sessions are open, before they end. Quick and synchronous. */
	save?: () => void;
	/** Quitting did not start after all. */
	resume?: () => void;
}

export interface QuitGuard {
	/**
	 * Whether quitting, or closing the window, may go ahead now. When it may
	 * not, the person is asked, unless a question is already on its way.
	 */
	mayQuit(): boolean;
	/** The person agreed: save which sessions are open, end every session, then quit. Answers whether quitting started. */
	confirm(): Promise<boolean>;
	/**
	 * The same, with another way to quit, such as restarting into an update.
	 * While `quit` runs, quitting may go ahead. Answers what `quit` answered.
	 */
	confirmWith(quit: () => Promise<boolean>): Promise<boolean>;
}

export function createQuitGuard(dependencies: QuitGuardDependencies): QuitGuard {
	let agreed = false;
	let asking = false;

	async function confirmWith(quit: () => Promise<boolean>): Promise<boolean> {
		agreed = true;
		// Saved while every session still runs. A save that fails must not keep the app open.
		try {
			dependencies.save?.();
		} catch {
			// The save says why itself.
		}
		await dependencies.endAll();
		// Something else can still keep the app open. Then the next try asks again, and the next quit saves again.
		let started = false;
		try {
			started = await quit();
		} finally {
			if (!started) {
				agreed = false;
				dependencies.resume?.();
			}
		}
		return started;
	}

	const confirm = () => confirmWith(async () => dependencies.quit());

	async function ask(live: number): Promise<void> {
		let shown: boolean;
		try {
			shown = await dependencies.ask(live);
		} catch {
			shown = false;
		}
		// Nobody can be asked, so nobody can agree: do not keep the app from quitting.
		if (!shown) await confirm();
	}

	return {
		mayQuit() {
			const live = dependencies.liveCount();
			if (agreed || live === 0) return true;
			if (!asking) {
				asking = true;
				void ask(live).finally(() => {
					asking = false;
				});
			}
			return false;
		},
		confirm,
		confirmWith,
	};
}
