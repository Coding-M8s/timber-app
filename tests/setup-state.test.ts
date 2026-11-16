import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { readSetupState } from "../src/bun/setup-state";
import { createTerminalSessions } from "../src/bun/terminals";
import { REPOSITORY_CONFIG_FILE } from "../src/shared/timber-config";
import { fingerprint, git, realTimber } from "./support/timber";

let root: string;
let primary: string;
let linked: string;
let home: string;
let xdg: string;

beforeAll(() => {
	// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-setup-state-")));
	primary = join(root, "never set up");
	linked = join(root, "never set up-worktrees", "feat x");
	home = join(root, "home");
	xdg = join(root, "xdg config");
	mkdirSync(home);
	mkdirSync(xdg);
	git(root, "init", "--initial-branch=main", primary);
	writeFileSync(join(primary, "README.md"), "hello\n");
	git(primary, "add", "README.md");
	git(primary, "commit", "-m", "Initial commit");
	git(primary, "worktree", "add", "-b", "feat/x", linked);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** An environment whose machine defaults live in the temporary home only. */
const environment = (overrides: Record<string, string | undefined> = {}) => ({ HOME: home, XDG_CONFIG_HOME: undefined, ...overrides });

describe("whether a real repository was set up for Timber", () => {
	test("with neither file, it was never set up", async () => {
		expect(await readSetupState(primary, environment())).toBe("none");
	});

	test("machine defaults alone count as set up", async () => {
		const config = join(home, ".config", "timber");
		mkdirSync(config, { recursive: true });
		writeFileSync(join(config, "config.toml"), "# Timber settings\n");
		try {
			expect(await readSetupState(primary, environment())).toBe("machine");
			// A relative XDG_CONFIG_HOME is ignored, so the file in the home folder still counts.
			expect(await readSetupState(primary, environment({ XDG_CONFIG_HOME: "not/absolute" }))).toBe("machine");
			// An absolute one moves the machine defaults away from the home folder.
			expect(await readSetupState(primary, environment({ XDG_CONFIG_HOME: xdg }))).toBe("none");
		} finally {
			rmSync(join(home, ".config"), { recursive: true, force: true });
		}
	});

	test("machine defaults under XDG_CONFIG_HOME count", async () => {
		mkdirSync(join(xdg, "timber"), { recursive: true });
		writeFileSync(join(xdg, "timber", "config.toml"), "# Timber settings\n");
		try {
			expect(await readSetupState(primary, environment({ XDG_CONFIG_HOME: xdg }))).toBe("machine");
		} finally {
			rmSync(join(xdg, "timber"), { recursive: true, force: true });
		}
	});

	test("a .timber.toml in a linked worktree does not count, because Timber does not read it there", async () => {
		writeFileSync(join(linked, REPOSITORY_CONFIG_FILE), "# Timber settings\n");
		try {
			expect(await readSetupState(primary, environment())).toBe("none");
		} finally {
			rmSync(join(linked, REPOSITORY_CONFIG_FILE));
		}
	});

	test("the primary checkout's .timber.toml counts, whatever is in it", async () => {
		writeFileSync(join(primary, REPOSITORY_CONFIG_FILE), "");
		try {
			expect(await readSetupState(primary, environment())).toBe("repository");
		} finally {
			rmSync(join(primary, REPOSITORY_CONFIG_FILE));
		}
	});

	test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a folder that cannot be looked into is unknown, never never set up", async () => {
		const locked = join(root, "locked home");
		mkdirSync(locked);
		chmodSync(locked, 0o000);
		try {
			expect(await readSetupState(primary, environment({ HOME: locked }))).toBe("unknown");
		} finally {
			chmodSync(locked, 0o755);
		}
	});

	test("reading leaves the files and refs as they were", async () => {
		const before = [fingerprint(primary), fingerprint(linked)];
		await readSetupState(primary, environment());
		await readSetupState(linked, environment());
		expect([fingerprint(primary), fingerprint(linked)]).toEqual(before);
	});
});

describe.skipIf(realTimber === null)("with the installed Timber, the repository says whether it was set up", () => {
	const reader = () => createRepositoryReader(async () => ({ state: "ready", path: realTimber!, version: "0.1.1" }), { ...process.env, ...environment() });

	test("from its primary checkout and from a linked worktree alike", async () => {
		expect((await reader().reload(primary))?.setup).toBe("none");
		const found = await reader().find(linked);
		expect(found.outcome === "read" && found.repository.setup).toBe("none");
		writeFileSync(join(primary, REPOSITORY_CONFIG_FILE), "# Timber settings\n");
		try {
			expect((await reader().reload(primary))?.setup).toBe("repository");
		} finally {
			rmSync(join(primary, REPOSITORY_CONFIG_FILE));
		}
	});
});

describe.skipIf(realTimber === null || process.platform === "win32")("a setup session that saves, read back through the main process", () => {
	test("the repository reads as set up once the session ended, and not before", async () => {
		// A stand-in for Timber's guided setup: it saves the repository's settings when told to, as `timber setup` does.
		const bin = join(root, "setup bin");
		mkdirSync(bin, { recursive: true });
		const setup = join(bin, "timber");
		writeFileSync(setup, `#!/bin/sh\necho "setup $*"\nread line\nif [ "$line" = save ]; then printf '# saved\\n' > "${REPOSITORY_CONFIG_FILE}"; fi\n`);
		chmodSync(setup, 0o755);

		const env = { ...process.env, ...environment() };
		const reader = createRepositoryReader(async () => ({ state: "ready", path: realTimber!, version: "0.1.1" }), env);
		const ended: string[] = [];
		const sessions = createTerminalSessions({
			findRepository: path => path === primary ? reader.reload(path) : Promise.resolve(null),
			timber: async () => ({ state: "ready", path: setup, version: "0.1.1" }),
			onOutput: () => {},
			onChange: change => {
				if (change.session?.state.kind === "exited") ended.push(change.id);
			},
			environment: { PATH: process.env.PATH, HOME: home, LANG: "C.UTF-8" },
		});
		try {
			expect((await reader.reload(primary))?.setup).toBe("none");
			const result = await sessions.open({ repository: primary, worktree: primary, cols: 80, rows: 24, timberSetup: "repository" });
			if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
			expect((await reader.reload(primary))?.setup).toBe("none");
			sessions.write(result.session.id, "save\r");
			const deadline = Date.now() + 5000;
			while (!ended.includes(result.session.id) && Date.now() < deadline) await Bun.sleep(20);
			expect(ended).toContain(result.session.id);
			expect((await reader.reload(primary))?.setup).toBe("repository");
		} finally {
			sessions.killAll();
			rmSync(join(primary, REPOSITORY_CONFIG_FILE), { force: true });
		}
	});
});
