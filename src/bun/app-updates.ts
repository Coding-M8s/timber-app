import { messageOf } from "../shared/error-message";
import {
	type AppUpdateInstallRequest,
	type AppUpdateInstallResult,
	type AppUpdateState,
	type LocalBuild,
	mayCheck,
	updateFailureReason,
	updateUnavailableReason,
} from "../shared/app-update";

/**
 * Updating the app from its GitHub releases, with Electrobun's updater. The
 * updater downloads and checks a newer release beside the installed app, and
 * swaps it in only after the app has quit, so a failed or interrupted update
 * leaves the installed version as it was. See docs/architecture.md,
 * "Updating the app".
 *
 * A newer release is downloaded as soon as it is found, and then waits for
 * the person. The app never restarts into it by itself: `install` runs only
 * when asked, and while sessions run, only once the person agreed that they
 * end.
 */

/** What an update look answers, as Electrobun's `UpdateInfo` says it. */
export interface UpdaterAnswer {
	version: string;
	updateAvailable: boolean;
	updateReady: boolean;
	/** Empty when nothing failed. */
	error: string;
}

/** The part of Electrobun's `Updater` the app uses, so tests can stand in for it. */
export interface UpdaterPort {
	localBuild(): Promise<LocalBuild>;
	check(): Promise<UpdaterAnswer>;
	/** Download and check the update the last look found. Says how it went in `latest()`. */
	download(): Promise<void>;
	latest(): UpdaterAnswer;
	/** Start the swap and quit. Answers whether quitting started. */
	apply(): Promise<boolean>;
}

export interface AppUpdatesDependencies {
	updater: UpdaterPort;
	/** How many terminal and agent sessions run. */
	liveCount: () => number;
	/**
	 * Save which sessions are open, end them, and then run `apply`, which
	 * quits. Answers whether quitting started; when it did not, the sessions
	 * may already have ended.
	 */
	restartInto: (apply: () => Promise<boolean>) => Promise<boolean>;
	onChange: (state: AppUpdateState) => void;
	now?: () => number;
}

export interface AppUpdates {
	current(): AppUpdateState;
	/** Look for a newer release, and download it when there is one. Never throws; a look already running is shared. */
	check(): Promise<AppUpdateState>;
	/** Restart into the downloaded update, when the person asked. */
	install(request: AppUpdateInstallRequest): Promise<AppUpdateInstallResult>;
}

export function createAppUpdates(dependencies: AppUpdatesDependencies): AppUpdates {
	const now = dependencies.now ?? Date.now;
	let state: AppUpdateState = { kind: "idle" };
	let running: Promise<AppUpdateState> | null = null;
	let availability: Promise<string | null> | null = null;

	function set(next: AppUpdateState): AppUpdateState {
		state = next;
		dependencies.onChange(next);
		return next;
	}

	/** Why this build cannot update itself, read once. */
	function unavailableReason(): Promise<string | null> {
		availability ??= dependencies.updater.localBuild().then(updateUnavailableReason, error => `Could not read how this build was made: ${messageOf(error)}`);
		return availability;
	}

	async function look(): Promise<AppUpdateState> {
		const reason = await unavailableReason();
		if (reason !== null) return set({ kind: "unavailable", reason });
		// With an update downloaded, a look runs without a word and keeps it, unless it finds another one; one that
		// fails, offline for one, changes nothing, so the banner and an open question stay.
		const ready = state.kind === "ready" ? state : null;
		if (ready === null) set({ kind: "checking" });
		try {
			const answer = await dependencies.updater.check();
			if (answer.error !== "") return ready ?? set({ kind: "failed", stage: "check", message: updateFailureReason(answer.error) });
			if (!answer.updateAvailable) return set({ kind: "up-to-date", checkedAt: now() });
			if (answer.updateReady) return ready?.version === answer.version ? ready : set({ kind: "ready", version: answer.version });
			set({ kind: "downloading", version: answer.version });
			await dependencies.updater.download();
			const downloaded = dependencies.updater.latest();
			if (downloaded.updateReady) return set({ kind: "ready", version: downloaded.version || answer.version });
			return set({ kind: "failed", stage: "download", message: updateFailureReason(downloaded.error) });
		} catch (error) {
			if (state.kind === "ready") return state;
			const stage = state.kind === "downloading" ? "download" : "check";
			return set({ kind: "failed", stage, message: updateFailureReason(messageOf(error)) });
		}
	}

	return {
		current: () => state,
		check() {
			if (running) return running;
			if (!mayCheck(state)) return Promise.resolve(state);
			const operation = look();
			running = operation;
			void operation.finally(() => {
				if (running === operation) running = null;
			});
			return operation;
		},
		async install({ endSessions }) {
			if (state.kind !== "ready") return { outcome: "failed", message: "No update is ready to install yet." };
			const live = dependencies.liveCount();
			if (live > 0 && !endSessions) return { outcome: "sessions-running", live };
			const ready = state;
			set({ kind: "installing", version: ready.version });
			let started: boolean;
			let reason = "Something kept the app open.";
			try {
				started = await dependencies.restartInto(() => dependencies.updater.apply());
			} catch (error) {
				started = false;
				reason = updateFailureReason(messageOf(error));
			}
			if (started) return { outcome: "restarting" };
			set(ready);
			const latest = dependencies.updater.latest().error;
			if (latest !== "") reason = updateFailureReason(latest);
			return { outcome: "failed", message: `Could not restart into the update: ${reason} Quit the app and start it again, then try once more.` };
		},
	};
}
