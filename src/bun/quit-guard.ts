/**
 * Asking before quitting while terminals run.
 *
 * Electrobun asks the main process, without waiting, whether the app may quit
 * (`before-quit`) and whether the window may close (`will-close`). While a
 * terminal session runs and the person has not agreed, the answer is no, and
 * the window is asked to show the question. When the person agrees, every
 * session is ended and the app quits for real.
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
}

export interface QuitGuard {
	/**
	 * Whether quitting, or closing the window, may go ahead now. When it may
	 * not, the person is asked, unless a question is already on its way.
	 */
	mayQuit(): boolean;
	/** The person agreed: end every session, then quit. Answers whether quitting started. */
	confirm(): Promise<boolean>;
}

export function createQuitGuard(dependencies: QuitGuardDependencies): QuitGuard {
	let agreed = false;
	let asking = false;

	async function confirm(): Promise<boolean> {
		agreed = true;
		await dependencies.endAll();
		// Something else can still keep the app open. Then the next try asks again.
		if (dependencies.quit()) return true;
		agreed = false;
		return false;
	}

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
	};
}
