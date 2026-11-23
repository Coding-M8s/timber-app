import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfiguredBase } from "../shared/fallback-base";
import { REPOSITORY_CONFIG_FILE, machineConfigPath, readSettingsOutput, settingsReadArguments } from "../shared/timber-config";
import { runCaptured } from "./timber-settings";

type Environment = Record<string, string | undefined>;

/** Reading settings is offline and quick. One this slow is stuck, and answers as unknown. */
const READ_TIMEOUT_MS = 10_000;

/**
 * Reads which base Timber's settings choose for a worktree with no saved
 * one: the effective `base_branch` and `remote`, through
 * `timber __app-config read --scope repository`, never by reading Timber's
 * files. `timber` is the executable, `primaryRoot` the repository's primary
 * checkout, where it runs. Null when it could not be read.
 */
export type ConfiguredBaseReader = (timber: string, primaryRoot: string) => Promise<ConfiguredBase | null>;

const text = (value: unknown): string | null => typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** Run Timber once and keep the two values. */
async function readOnce(timber: string, primaryRoot: string, environment: Environment): Promise<ConfiguredBase | null> {
	try {
		const run = await runCaptured([timber, ...settingsReadArguments("repository")], primaryRoot, environment, READ_TIMEOUT_MS);
		if (run.stopped || run.exitCode !== 0) return null;
		const reading = readSettingsOutput(run.stdout, "repository");
		if (!reading.ok) return null;
		const { effective } = reading.value;
		return { baseBranch: text(effective.base_branch), remote: text(effective.remote) };
	} catch {
		return null;
	}
}

/** What a file is now, to tell whether it changed: its size, time, and identity, or that it is not there. */
async function signatureOf(path: string | null): Promise<string> {
	if (path === null) return "none";
	try {
		const { size, mtimeMs, ino, dev } = await stat(path);
		return `${dev}:${ino}:${size}:${mtimeMs}`;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code ?? "unreadable";
	}
}

/**
 * A reader that runs Timber only when the answer may have changed: each
 * answer is kept per primary checkout with the Timber executable that gave
 * it (its path and the file's state) and the state of both of Timber's
 * settings files, and is read again once any of them changes. A failed read
 * is not kept. Reading settings opens Timber's credential stores, so list
 * refreshes must not run it each time.
 */
export function createConfiguredBaseReader(
	environment: Environment = process.env,
	read: (timber: string, primaryRoot: string) => Promise<ConfiguredBase | null> = (timber, primaryRoot) => readOnce(timber, primaryRoot, environment),
	platform: string = process.platform,
	home: () => string = homedir,
): ConfiguredBaseReader {
	const kept = new Map<string, { signature: string; answer: ConfiguredBase }>();
	return async (timber, primaryRoot) => {
		const files = await Promise.all([
			// `timber` is the full path Timber was found at (TimberStatus.path), so an upgrade in place is seen.
			signatureOf(timber),
			signatureOf(join(primaryRoot, REPOSITORY_CONFIG_FILE)),
			signatureOf(machineConfigPath(environment, platform, home())),
		]);
		const signature = JSON.stringify([timber, ...files]);
		const known = kept.get(primaryRoot);
		if (known?.signature === signature) return known.answer;
		const answer = await read(timber, primaryRoot);
		// A read that failed is not kept, so the next list read tries again.
		if (answer === null) kept.delete(primaryRoot);
		else kept.set(primaryRoot, { signature, answer });
		return answer;
	};
}
