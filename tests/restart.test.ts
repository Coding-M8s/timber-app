import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESTART_WAIT_TENTHS, type RestarterDependencies, WAITER_SCRIPT, createRestarter, readLaunch, waiterCommand } from "../src/bun/restart";
import { PREFERENCE_PARTS, type Preferences, defaultPreferences, restartNeededFor } from "../src/shared/preferences";
import { parseEnviron, splitNul } from "../src/shared/restart";

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
	const made = mkdtempSync(join(tmpdir(), "timber-restart-"));
	folders.push(made);
	return made;
}

/** An install laid out as Electrobun's installer leaves it, and a /proc with the launcher that started it. */
function installed(options: { exe?: string; cmdline?: string; environ?: string } = {}) {
	const root = folder();
	const install = join(root, "com.example.app", "stable");
	const bin = join(install, "app", "bin");
	mkdirSync(bin, { recursive: true });
	const launcher = join(bin, "launcher");
	writeFileSync(launcher, "");
	const proc = join(root, "proc");
	const pid = join(proc, "4242");
	mkdirSync(pid, { recursive: true });
	symlinkSync(options.exe ?? launcher, join(pid, "exe"));
	symlinkSync(join(root, "home"), join(pid, "cwd"));
	writeFileSync(join(pid, "cmdline"), options.cmdline ?? `${launcher}\0--flag\0two words\0`);
	writeFileSync(join(pid, "environ"), options.environ ?? "HOME=/home/sam\0XDG_CONFIG_HOME=/tmp/config\0EMPTY=\0");
	return { root, launcher, proc, execPath: join(bin, "bun"), home: join(root, "home") };
}

function restarter(change: Partial<RestarterDependencies> & { execPath: string; proc: string }) {
	const calls: string[] = [];
	const spawned: { command: string[]; env: Record<string, string>; cwd: string }[] = [];
	const dependencies: RestarterDependencies = {
		quit: async () => {
			calls.push("quit");
			return true;
		},
		platform: "linux",
		launcherPid: "4242",
		procRoot: change.proc,
		spawn: (command, options) => {
			spawned.push({ command, ...options });
			calls.push("spawn");
			return { kill: () => calls.push("kill") };
		},
		...change,
	};
	return { restarter: createRestarter(dependencies), calls, spawned };
}

describe("reading /proc", () => {
	test("NUL-ended strings are split, and a last one without its NUL is kept", () => {
		expect(splitNul("")).toEqual([]);
		expect(splitNul("a\0b c\0")).toEqual(["a", "b c"]);
		expect(splitNul("a\0b")).toEqual(["a", "b"]);
		expect(splitNul("a\0\0b\0")).toEqual(["a", "", "b"]);
	});

	test("an environment keeps values with = and empty ones, the first of a repeated name, and drops entries without a name", () => {
		expect(parseEnviron("A=1\0B=x=y\0C=\0A=2\0junk\0=nameless\0")).toEqual({ A: "1", B: "x=y", C: "" });
	});
});

describe("which preferences wait for a restart", () => {
	test("the DMA-BUF renderer is the one preference read only at start", () => {
		const marked = Object.entries(PREFERENCE_PARTS).filter(([, part]) => "restart" in part && part.restart === true).map(([key]) => key);
		expect(marked).toEqual(["dmabuf"]);
	});

	test("only a marked preference that differs from what the app started with needs a restart", () => {
		const atStart = defaultPreferences();
		const same: Preferences = { ...atStart };
		expect(restartNeededFor(atStart, same)).toEqual([]);
		// A change that applies at once is never a reason.
		expect(restartNeededFor(atStart, { ...atStart, sidebarSide: "right", zoom: 1.5 })).toEqual([]);
		expect(restartNeededFor(atStart, { ...atStart, dmabuf: "off" })).toEqual(["dmabuf"]);
		// Saved back to what the app started with: nothing waits any more.
		expect(restartNeededFor({ ...atStart, dmabuf: "off" }, { ...atStart, dmabuf: "off" })).toEqual([]);
	});
});

describe("restarting in the main process", () => {
	test("an installed copy started by its launcher can restart, with the launcher's arguments, environment, and folder", async () => {
		const setup = installed();
		expect(await readLaunch(setup.proc, 4242, setup.launcher)).toEqual({
			executable: setup.launcher,
			args: ["--flag", "two words"],
			env: { HOME: "/home/sam", XDG_CONFIG_HOME: "/tmp/config", EMPTY: "" },
			cwd: setup.home,
		});
		const { restarter: subject } = restarter(setup);
		expect(await subject.plan()).toEqual({ available: true });
	});

	test("the waiter starts first, then the app quits, and the environment never goes in the arguments", async () => {
		const setup = installed();
		const { restarter: subject, calls, spawned } = restarter(setup);
		expect(await subject.restart()).toEqual({ outcome: "restarting" });
		expect(calls).toEqual(["spawn", "quit"]);
		expect(spawned).toEqual([{
			command: ["/bin/sh", "-c", WAITER_SCRIPT, "sh", "4242", setup.launcher, "--flag", "two words"],
			env: { HOME: "/home/sam", XDG_CONFIG_HOME: "/tmp/config", EMPTY: "" },
			cwd: setup.home,
		}]);
		expect(spawned[0]!.command.join(" ")).not.toContain("/tmp/config");
	});

	test("when the app does not quit after all, the waiter is stopped, so no second app starts later", async () => {
		const setup = installed();
		const kept = restarter({ ...setup, quit: async () => false });
		expect(await kept.restarter.restart()).toEqual({ outcome: "failed", message: "Something kept the app open, so it did not restart. Try again in a moment." });
		expect(kept.calls).toEqual(["spawn", "kill"]);
		const broken = restarter({ ...setup, quit: () => Promise.reject(new Error("closeAll failed")) });
		expect(await broken.restarter.restart()).toEqual({ outcome: "failed", message: "The app did not quit: closeAll failed" });
		expect(broken.calls).toEqual(["spawn", "kill"]);
	});

	test("once the app is quitting, a second restart starts no second waiter, and after a failure it can be tried again", async () => {
		const setup = installed();
		const { restarter: subject, calls } = restarter(setup);
		expect(await subject.restart()).toEqual({ outcome: "restarting" });
		expect(await subject.restart()).toEqual({ outcome: "failed", message: "The app is already restarting." });
		expect(calls).toEqual(["spawn", "quit"]);
		let quits = false;
		const retry = restarter({ ...setup, quit: async () => quits });
		expect((await retry.restarter.restart()).outcome).toBe("failed");
		quits = true;
		expect(await retry.restarter.restart()).toEqual({ outcome: "restarting" });
		expect(retry.calls).toEqual(["spawn", "kill", "spawn"]);
	});

	test("an install reached through a linked folder is still its own launcher", async () => {
		const setup = installed();
		const linked = join(setup.root, "linked");
		symlinkSync(join(setup.root, "com.example.app"), linked);
		const { restarter: subject } = restarter({ ...setup, execPath: join(linked, "stable", "app", "bin", "bun") });
		expect(await subject.plan()).toEqual({ available: true });
	});

	test("a waiter that cannot start leaves the app running", async () => {
		const setup = installed();
		const { restarter: subject, calls } = restarter({ ...setup, spawn: () => { throw new Error("ENOENT"); } });
		expect(await subject.restart()).toEqual({ outcome: "failed", message: "Could not get ready to start the app again: ENOENT" });
		expect(calls).toEqual([]);
	});

	test("each copy that cannot restart says why, and restarting it does nothing", async () => {
		const setup = installed();
		const cases: [Partial<RestarterDependencies>, string][] = [
			[{ platform: "darwin" }, "Restarting from inside the app is built for Linux only so far. Quit and start it again to use the saved setting."],
			[{ execPath: "/home/sam/timber-app/node_modules/.bin/bun" }, "This copy of the app runs from source in /home/sam/timber-app/node_modules/.bin, so it cannot restart itself. Quit it and run the command again to use the saved setting."],
			[{ launcherPid: undefined }, "The app could not tell which launcher started it. Quit and start it again to use the saved setting."],
			[{ launcherPid: "0" }, "The app could not tell which launcher started it. Quit and start it again to use the saved setting."],
			[{ launcherPid: "77" }, "The app's launcher could not be read:"],
		];
		for (const [change, reason] of cases) {
			const { restarter: subject, calls } = restarter({ ...setup, ...change });
			const plan = await subject.plan();
			expect(plan.available).toBe(false);
			expect(plan.available ? "" : plan.reason).toStartWith(reason);
			expect(await subject.restart()).toMatchObject({ outcome: "unavailable" });
			expect(calls).toEqual([]);
		}
	});

	test("a parent that is not the app's own launcher, such as a shell, is never started again", async () => {
		const setup = installed({ exe: "/usr/bin/bash" });
		const { restarter: subject } = restarter(setup);
		expect(await subject.plan()).toEqual({ available: false, reason: `The app was not started by its own launcher (${setup.launcher}). Quit and start it again to use the saved setting.` });
	});

	test("the waiter gives up rather than start a second app beside one that does not go", () => {
		expect(WAITER_SCRIPT).toContain(`-gt ${RESTART_WAIT_TENTHS} ]; then exit 1`);
		expect(RESTART_WAIT_TENTHS).toBe(200);
	});
});

describe("the waiter, run for real", () => {
	test("it waits until the old app is gone, then starts it again with the same arguments, environment, and folder", async () => {
		const root = folder();
		const out = join(root, "started");
		const cwd = join(root, "work");
		mkdirSync(cwd);
		// The old app: gone after a moment. Its exit time is written, to show the new one starts after it.
		const old = Bun.spawn(["/bin/sh", "-c", `sleep 0.4; date +%s%N > "${join(root, "gone")}"`]);
		const relaunch = { executable: "/bin/sh", args: ["-c", `date +%s%N > "${out}.at"; printf '%s|%s|%s' "$1" "$SECRET" "$PWD" > "${out}"`, "sh", "two words"], env: { SECRET: "s3cret", PATH: process.env.PATH ?? "/usr/bin:/bin" }, cwd };
		const waiter = Bun.spawn(waiterCommand(old.pid, relaunch), { env: relaunch.env, cwd: relaunch.cwd, stdio: ["ignore", "ignore", "ignore"] });
		await Bun.sleep(200);
		expect(existsSync(out)).toBe(false);
		await old.exited;
		expect(await waiter.exited).toBe(0);
		expect(readFileSync(out, "utf8")).toBe(`two words|s3cret|${cwd}`);
		expect(BigInt(readFileSync(`${out}.at`, "utf8").trim())).toBeGreaterThanOrEqual(BigInt(readFileSync(join(root, "gone"), "utf8").trim()));
	});
});
