/**
 * Running Git for a read-only query, and for the app's own index writes
 * (see ./git-writes.ts), which add what they need with `environment`. Git is run as an executable plus an
 * argument array, never through a shell, with standard input closed unless
 * the query is given `input`, and:
 *
 * - `GIT_OPTIONAL_LOCKS=0`, so a query never rewrites the index to refresh
 *   it, and never takes its lock from under a command the person runs;
 * - `LC_ALL=C`, so Git's own words are English, which some readers rely on
 *   (such as "Binary files ... differ").
 *
 * Fetching is not run here: it needs its own process handling (see ./fetch-git.ts).
 */

export interface ReadGitOptions {
	/** The Git executable. Tests may pass another. */
	git?: string;
	cwd?: string;
	/** Git is stopped after this long. No limit by default. */
	timeoutMs?: number;
	/** Standard output is kept up to this many bytes, and Git is stopped beyond it. No limit by default. */
	limitBytes?: number;
	/** Standard error is kept up to this many bytes, for a failure's message. Not read by default. */
	stderrBytes?: number;
	/** Given to Git on standard input, such as the paths for `--stdin`. Standard input is closed without it. */
	input?: string;
	/** Variables set on top of the usual ones, such as `GIT_LITERAL_PATHSPECS`. */
	environment?: Record<string, string>;
}

export type ReadGitRun =
	| { started: false; error: unknown }
	| {
		started: true;
		/** Null when Git did not exit by itself. */
		exitCode: number | null;
		/** Git was stopped because it took longer than `timeoutMs`. */
		timedOut: boolean;
		stdout: string;
		/** Git printed more than `limitBytes`, and only the start is kept. */
		truncated: boolean;
		/** The start of what Git wrote on standard error, or nothing without `stderrBytes`. */
		stderr: string;
	};

/**
 * Read a stream up to `limit` bytes. Returns what was read and whether there
 * was more. `stops` gets a function that ends the reading early, for when
 * Git is stopped: a process Git started could otherwise hold the stream open.
 */
async function readUpTo(stream: ReadableStream<Uint8Array>, limit: number, onOver: () => void, stops: (() => void)[]): Promise<{ bytes: Uint8Array; over: boolean }> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	let over = false;
	const reader = stream.getReader();
	stops.push(() => void reader.cancel().catch(() => {}));
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const room = limit - size;
			if (value.byteLength > room) {
				chunks.push(value.subarray(0, room));
				size = limit;
				over = true;
				onOver();
				break;
			}
			chunks.push(value);
			size += value.byteLength;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { bytes, over };
}

/** Run one read-only Git query. Nothing it printed is logged here. */
export async function readGit(args: readonly string[], options: ReadGitOptions = {}): Promise<ReadGitRun> {
	const { git = "git", cwd, timeoutMs, limitBytes = Number.POSITIVE_INFINITY, stderrBytes, input, environment } = options;
	let child: Bun.Subprocess<"ignore" | Blob, "pipe", "pipe" | "ignore">;
	try {
		child = Bun.spawn([git, ...args], {
			...(cwd === undefined ? {} : { cwd }),
			stdin: input === undefined ? "ignore" : new Blob([input]),
			stdout: "pipe",
			stderr: stderrBytes === undefined ? "ignore" : "pipe",
			env: { ...process.env, ...environment, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
			// Bun stops Git itself once it takes too long.
			...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
		});
	} catch (error) {
		return { started: false, error };
	}
	let timedOut = false;
	const stops: (() => void)[] = [];
	// A process Git started can hold the streams open after Git is stopped, so reading ends at the same time.
	const deadline = timeoutMs === undefined ? undefined : setTimeout(() => {
		timedOut = true;
		for (const stop of stops) stop();
	}, timeoutMs);
	try {
		const { stderr } = child;
		const [out, err] = await Promise.all([
			readUpTo(child.stdout, limitBytes, () => child.kill(), stops),
			stderr instanceof ReadableStream ? readUpTo(stderr, stderrBytes ?? 0, () => {}, stops) : null,
			child.exited,
		]);
		const decoder = new TextDecoder();
		return { started: true, exitCode: child.exitCode, timedOut, stdout: decoder.decode(out.bytes), truncated: out.over, stderr: err === null ? "" : decoder.decode(err.bytes) };
	} finally {
		clearTimeout(deadline);
	}
}
