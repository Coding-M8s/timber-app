import { homedir } from "node:os";
import { type AgentSetting, conversationsOf, expandConfigFolder } from "../shared/agent";
import type { AgentDefinition } from "../shared/agent-registry";
import { createOutputCapture } from "../shared/captured-output";
import { messageOf } from "../shared/error-message";
import { HANDOFF_VARIABLE } from "../shared/handoff";
import type { CapturedOutput } from "../shared/model";
import { STATUS_VARIABLE } from "../shared/status-hooks";
import { killProcessTree, signalGroup } from "./process-session";

/** How long what a program printed may stay open after it ended, as when a process of its own holds it. */
const STREAM_GRACE_MILLISECONDS = 1000;

export interface RunOnce {
	/** The executable and its arguments. Never a shell. */
	command: readonly string[];
	cwd: string;
	env: Record<string, string | undefined>;
	/** What it reads on standard input, or null for nothing. */
	input: string | null;
	/** The most bytes of each stream that are kept, from the end. */
	outputBytes: number;
	errorBytes: number;
	timeoutMilliseconds: number;
	platform: NodeJS.Platform;
	/** Called once it runs, with what kills it and all it started. */
	onStart: (kill: () => void) => void;
}

export type RanOnce =
	| { started: false; message: string }
	/** `late` when its time was up and it was killed. `exitCode` is null when a signal ended it. */
	| { started: true; late: boolean; exitCode: number | null; out: CapturedOutput; err: CapturedOutput };

/**
 * Run a program once, without a terminal, in a process group of its own, so
 * that killing it kills what it started too. It is killed once its time is
 * up. Nothing it prints is logged here.
 */
export async function runOnce({ command, cwd, env, input, outputBytes, errorBytes, timeoutMilliseconds, platform, onStart }: RunOnce): Promise<RanOnce> {
	const windows = platform === "win32";
	let child: Bun.Subprocess<Blob | "ignore", "pipe", "pipe">;
	try {
		child = Bun.spawn([...command], { cwd, stdin: input === null ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe", env, detached: !windows });
	} catch (error) {
		return { started: false, message: messageOf(error) };
	}
	const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
	const kill = () => {
		if (windows) killProcessTree(child.pid, env);
		else signalGroup(child.pid, "SIGKILL");
		child.kill("SIGKILL");
		// A process that left the group can hold the streams open.
		for (const reader of readers) void reader.cancel().catch(() => {});
	};
	const collect = async (stream: ReadableStream<Uint8Array>, limit: number) => {
		const capture = createOutputCapture(limit);
		const reader = stream.getReader();
		readers.push(reader);
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return capture.finish();
			capture.add(value);
		}
	};
	let late = false;
	const timer = setTimeout(() => {
		late = true;
		kill();
	}, timeoutMilliseconds);
	onStart(kill);
	// Once it ended, what it left running must not hold its answer open.
	let grace: ReturnType<typeof setTimeout> | undefined;
	void child.exited.then(() => {
		// It ended in time, however long what it left running holds its output.
		clearTimeout(timer);
		if (!windows) signalGroup(child.pid, "SIGKILL");
		grace = setTimeout(() => readers.forEach(reader => void reader.cancel().catch(() => {})), STREAM_GRACE_MILLISECONDS);
	});
	try {
		const [out, err] = await Promise.all([collect(child.stdout, outputBytes), collect(child.stderr, errorBytes), child.exited]);
		return { started: true, late, exitCode: child.exitCode, out, err };
	} finally {
		clearTimeout(timer);
		clearTimeout(grace);
	}
}

/**
 * The environment a saved row's agent runs once with: the app's, with the
 * row's config folder, and without what ties a
 * process to one of the app's sessions.
 */
export function agentRunEnvironment(environment: Record<string, string | undefined>, agent: AgentDefinition | null, configFolder: AgentSetting["configFolder"]): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...environment };
	delete env[HANDOFF_VARIABLE];
	delete env[STATUS_VARIABLE];
	const kept = conversationsOf(agent);
	const own = kept === null ? null : expandConfigFolder(configFolder, environment.HOME || homedir());
	if (kept !== null && own !== null) env[kept.folderVariable] = own;
	return env;
}
