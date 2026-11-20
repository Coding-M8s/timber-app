/**
 * How the fetcher runs Git (see ./fetcher.ts). Kept apart so tests can pass a
 * runner of their own, and so the one place that reaches the network is easy
 * to read.
 */
import { messageOf } from "../shared/error-message";

/** What one run of Git ended with. `exitCode` is null when Git could not start or was stopped. */
export interface GitRun {
	exitCode: number | null;
	stdout: string;
	/** The end of what Git printed on standard error. Private: shown, never logged. */
	stderr: string;
	/** Git was stopped because it took too long. */
	timedOut: boolean;
}

export interface RunGitOptions {
	/** True for the fetch itself, which may reach a remote. Everything else only reads the repository. */
	network: boolean;
	/** Stops Git, for example when the app quits. */
	signal?: AbortSignal;
	/** Variables to set on top of the usual environment (see `fetchEnvironment`). */
	env?: Record<string, string>;
}

/** Run Git with these arguments. */
export type RunGit = (args: readonly string[], options: RunGitOptions) => Promise<GitRun>;

/**
 * A fetch is stopped after this long, so a remote that hangs cannot hold the
 * next one up forever. Long, because a large fetch cannot resume: one stopped
 * too early would start over every time. Stalls end sooner, through the HTTP
 * and SSH limits below.
 */
export const FETCH_MILLISECONDS = 10 * 60_000;
/** A read of the repository is stopped after this long. */
export const READ_MILLISECONDS = 20_000;
/** Git is asked to stop, and only killed when it has not stopped after this long, so it can remove its lock files. */
export const KILL_MILLISECONDS = 5000;
/**
 * Once Git has ended, what it printed is read for at most this much longer. A
 * process it started in a session of its own can keep the pipes open long
 * after, and must not hold the fetch up.
 */
export const PIPE_GRACE_MILLISECONDS = 2000;
/** Standard error is kept up to this many characters, from the end. */
const STDERR_CHARACTERS = 8192;

/**
 * The environment of every Git run here. Nothing may ask for anything:
 *
 * - `GIT_TERMINAL_PROMPT=0`: Git never asks for a user name or password on a
 *   terminal, and fails instead.
 * - `GIT_ASKPASS`, `SSH_ASKPASS` empty and `SSH_ASKPASS_REQUIRE=never`: no
 *   program is started to ask for a password or passphrase, whatever the
 *   person's environment sets.
 * - `GCM_INTERACTIVE=never`: Git Credential Manager uses what it has stored
 *   and never opens a window.
 * - `GIT_HTTP_LOW_SPEED_*`: an HTTP transfer that stalls is given up.
 * - `GIT_OPTIONAL_LOCKS=0`, as every background read here, and `LC_ALL=C`, so
 *   the messages that `readFetchFailure` reads are in English.
 *
 * Stored credentials still work: credential helpers and SSH keys without a
 * passphrase, or held by an agent, are used as usual. What a helper or an
 * agent shows on its own, such as a keyring to unlock or a key to touch, is
 * up to it. The person's `core.sshCommand` and `GIT_SSH_COMMAND` are left
 * alone (see `batchSshCommand`).
 */
export function fetchEnvironment(base: Record<string, string | undefined> = process.env): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const [key, value] of Object.entries(base)) {
		if (value !== undefined) environment[key] = value;
	}
	return {
		...environment,
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "",
		SSH_ASKPASS: "",
		SSH_ASKPASS_REQUIRE: "never",
		GCM_INTERACTIVE: "never",
		GIT_HTTP_LOW_SPEED_LIMIT: "1000",
		GIT_HTTP_LOW_SPEED_TIME: "30",
		GIT_OPTIONAL_LOCKS: "0",
		LC_ALL: "C",
	};
}

/**
 * SSH that never asks and gives up on a host that does not answer, for when
 * the person has not chosen an SSH command of their own: SSH would otherwise
 * wait about two minutes for an unreachable host.
 */
export const BATCH_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=20";

/**
 * Whether the fetch may use `BATCH_SSH_COMMAND`: only when neither the
 * environment nor the repository's `core.sshCommand` names an SSH command,
 * so a person's own setup always wins.
 */
export function batchSshCommand(environment: Record<string, string | undefined>, configured: string | null): Record<string, string> {
	if (environment.GIT_SSH_COMMAND || environment.GIT_SSH || (configured !== null && configured.trim() !== "")) return {};
	return { GIT_SSH_COMMAND: BATCH_SSH_COMMAND };
}

/** Read a stream to its end, or until `stop` is called. Returns what was read. */
function readText(stream: ReadableStream<Uint8Array>, stops: (() => void)[]): Promise<string> {
	const reader = stream.getReader();
	stops.push(() => void reader.cancel().catch(() => {}));
	const decoder = new TextDecoder();
	let text = "";
	return (async () => {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				text += decoder.decode(value, { stream: true });
			}
		} catch {
			// Cancelled: what was read so far is the answer.
		}
		return text + decoder.decode();
	})();
}

/**
 * The runner of the running app. Git is an executable plus arguments, never a
 * shell. It starts in a session of its own (`detached`), so neither Git nor
 * SSH has a terminal to ask on, even when the app was started from one, and
 * with nothing on standard input.
 */
export function createGitRunner(git = "git", environment: Record<string, string | undefined> = process.env): RunGit {
	const env = fetchEnvironment(environment);
	return async (args, { network, signal, env: extra }) => {
		const limit = network ? FETCH_MILLISECONDS : READ_MILLISECONDS;
		if (signal?.aborted) return { exitCode: null, stdout: "", stderr: "The app stopped Git before it started.", timedOut: false };
		let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
		try {
			child = Bun.spawn([git, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...env, ...extra }, detached: true });
		} catch (error) {
			return { exitCode: null, stdout: "", stderr: `Could not start Git: ${messageOf(error)}`, timedOut: false };
		}
		// The whole group: Git leads its own session, and an SSH it started would otherwise hold the pipes open.
		const signalGroup = (name: "SIGTERM" | "SIGKILL") => {
			try {
				process.kill(-child.pid, name);
			} catch {
				child.kill(name);
			}
		};
		let timedOut = false;
		let cancelKill: ReturnType<typeof setTimeout> | null = null;
		const stop = () => {
			if (cancelKill !== null || child.exitCode !== null) return;
			signalGroup("SIGTERM");
			cancelKill = setTimeout(() => signalGroup("SIGKILL"), KILL_MILLISECONDS);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			stop();
		}, limit);
		signal?.addEventListener("abort", stop, { once: true });
		try {
			const stops: (() => void)[] = [];
			const reading = Promise.all([readText(child.stdout, stops), readText(child.stderr, stops)]);
			await child.exited;
			const grace = setTimeout(() => {
				for (const stopReading of stops) stopReading();
			}, PIPE_GRACE_MILLISECONDS);
			const [stdout, stderr] = await reading;
			clearTimeout(grace);
			if (timedOut) {
				return { exitCode: null, stdout: "", stderr: `Git stopped after ${limit / 1000} seconds without finishing.`, timedOut: true };
			}
			if (signal?.aborted) return { exitCode: null, stdout: "", stderr: "The app stopped Git.", timedOut: false };
			return { exitCode: child.exitCode, stdout, stderr: stderr.slice(-STDERR_CHARACTERS), timedOut: false };
		} catch (error) {
			return { exitCode: null, stdout: "", stderr: messageOf(error), timedOut };
		} finally {
			clearTimeout(timer);
			if (cancelKill !== null) clearTimeout(cancelKill);
			signal?.removeEventListener("abort", stop);
		}
	};
}
