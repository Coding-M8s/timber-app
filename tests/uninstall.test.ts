import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSettingsHolder, removeSettings } from "../src/bun/settings";
import { type UninstallerDependencies, createUninstaller, installRootOf } from "../src/bun/uninstall";
import { emptySettings } from "../src/shared/settings";
import { UNINSTALL_ARGUMENTS, parseInstallRecord, uninstallTargets } from "../src/shared/uninstall";
import { until, windows } from "./support/runtime";

/** The record Electrobun 2.0.6 wrote for an install on Linux, with the home folder changed. */
const RECORDED = `{
  "schema_version": 2,
  "identifier": "com.codingm8s.timber-app",
  "name": "Timber",
  "channel": "stable",
  "version": "0.0.1",
  "application_entry": "/home/sam/.local/share/applications/Timber.desktop",
  "desktop_entry": "/home/sam/Desktop/Timber.desktop",
  "application_entry_sha256": "0ccc7f590fee9f9a613607b00bc08e8136e36a81c244249948a3a746a1934c7d",
  "desktop_entry_sha256": "0ccc7f590fee9f9a613607b00bc08e8136e36a81c244249948a3a746a1934c7d",
  "data_path_versions": [
    1
  ],
  "home": "/home/sam",
  "xdg_cache_home": "/home/sam/.cache",
  "xdg_state_home": "/home/sam/.local/state",
  "install_root_name": "stable"
}`;

describe("the install record", () => {
	test("reads what Electrobun recorded for an install", () => {
		expect(parseInstallRecord(RECORDED)).toEqual({
			identifier: "com.codingm8s.timber-app",
			installRoot: "stable",
			entries: ["/home/sam/.local/share/applications/Timber.desktop", "/home/sam/Desktop/Timber.desktop"],
			cacheHome: "/home/sam/.cache",
			stateHome: "/home/sam/.local/state",
		});
	});

	test("names every place the uninstaller removes from", () => {
		const record = parseInstallRecord(RECORDED)!;
		expect(uninstallTargets("/home/sam/.local/share/com.codingm8s.timber-app/stable", record)).toEqual([
			"/home/sam/.local/share/com.codingm8s.timber-app/stable",
			"/home/sam/.cache/com.codingm8s.timber-app/stable",
			"/home/sam/.local/state/com.codingm8s.timber-app/stable",
			"/home/sam/.local/share/applications/Timber.desktop",
			"/home/sam/Desktop/Timber.desktop",
		]);
	});

	test("an install without a desktop shortcut, or an older record, lists what it has", () => {
		const record = parseInstallRecord(JSON.stringify({ identifier: "com.example.app", channel: "canary", application_entry: "/a/App.desktop", desktop_entry: null }));
		expect(record).toEqual({ identifier: "com.example.app", installRoot: "canary", entries: ["/a/App.desktop"], cacheHome: null, stateHome: null });
		expect(uninstallTargets("/data/com.example.app/canary", record!)).toEqual(["/data/com.example.app/canary", "/a/App.desktop"]);
	});

	test("anything else is not a record", () => {
		for (const content of ["", "not json", "[]", "null", "{}", JSON.stringify({ identifier: "com.example.app" }), JSON.stringify({ identifier: 7, channel: "stable" })]) {
			expect(parseInstallRecord(content)).toBeNull();
		}
	});

	test("the uninstaller is asked for the data too, without questions, in the only order it accepts", () => {
		expect(UNINSTALL_ARGUMENTS).toEqual(["--quiet", "--delete-data"]);
	});
});

describe("where the app runs from", () => {
	test("an install runs from app/bin under its folder", () => {
		expect(installRootOf("/home/sam/.local/share/com.codingm8s.timber-app/stable/app/bin/bun")).toBe("/home/sam/.local/share/com.codingm8s.timber-app/stable");
	});

	test("a build in a checkout is not an install", () => {
		expect(installRootOf("/home/sam/timber-app/build/dev-linux-x64/Timber-dev/bin/bun")).toBeNull();
		expect(installRootOf("/usr/bin/bun")).toBeNull();
	});
});

// The stand-in uninstaller is a shell script, so these run where there is a POSIX shell.
describe.skipIf(windows)("uninstalling, with a stand-in uninstaller in real folders", () => {
	let root: string;
	let count = 0;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-uninstall-")));
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/**
	 * A home folder with an install as Electrobun lays it out, and the app's
	 * settings. The stand-in uninstaller notes its arguments in the home
	 * folder, then runs `script`.
	 */
	function install(script = "exit 0", options: { record?: string | null; uninstaller?: boolean } = {}) {
		const home = join(root, `home ${++count}`);
		const installRoot = join(home, ".local/share/com.codingm8s.timber-app/stable");
		const cache = join(home, ".cache/com.codingm8s.timber-app/stable");
		const menuEntry = join(home, ".local/share/applications/Timber.desktop");
		const shortcut = join(home, "Desktop/Timber.desktop");
		const settingsFolder = join(home, ".config/timber-app");
		const settingsFile = join(settingsFolder, "settings.json");
		const notes = join(home, "uninstaller-arguments");
		for (const folder of [join(installRoot, "app/bin"), join(installRoot, "WebKit"), cache, dirname(menuEntry), dirname(shortcut), settingsFolder]) {
			mkdirSync(folder, { recursive: true });
		}
		const execPath = join(installRoot, "app/bin/bun");
		writeFileSync(execPath, "");
		writeFileSync(menuEntry, "[Desktop Entry]\n");
		writeFileSync(shortcut, "[Desktop Entry]\n");
		writeFileSync(settingsFile, "{}\n");
		const uninstaller = join(installRoot, "uninstall");
		if (options.uninstaller !== false) {
			writeFileSync(uninstaller, `#!/bin/sh\nprintf '%s\\n' "$@" > "${notes}"\n${script}\n`);
			chmodSync(uninstaller, 0o755);
		}
		const record = options.record === undefined
			? JSON.stringify({
				identifier: "com.codingm8s.timber-app",
				channel: "stable",
				install_root_name: "stable",
				application_entry: menuEntry,
				desktop_entry: shortcut,
				xdg_cache_home: join(home, ".cache"),
				xdg_state_home: join(home, ".local/state"),
			})
			: options.record;
		if (record !== null) writeFileSync(join(installRoot, ".electrobun-uninstall.json"), record);

		const quits: number[] = [];
		const forgotten: number[] = [];
		const dependencies: UninstallerDependencies = {
			settingsFolder,
			forgetSettings: async () => {
				forgotten.push(Date.now());
				await removeSettings(settingsFile);
			},
			quit: () => void quits.push(Date.now()),
			execPath,
			platform: "linux",
			quitDelayMilliseconds: 0,
		};
		return {
			home, installRoot, cache, menuEntry, shortcut, settingsFolder, settingsFile, uninstaller, execPath, quits, forgotten, dependencies,
			ranWith: () => existsSync(notes) ? readFileSync(notes, "utf8").trim().split("\n") : null,
		};
	}

	/** Every file and folder under a folder, so a read can be shown to change nothing. */
	function listing(folder: string): string[] {
		return (readdirSync(folder, { recursive: true }) as string[]).sort();
	}

	test("the plan names the uninstaller's command and what is there to remove, and changes nothing", async () => {
		const made = install();
		const before = listing(made.home);
		const plan = await createUninstaller(made.dependencies).plan();
		expect(plan).toEqual({
			available: true,
			command: [made.uninstaller, "--quiet", "--delete-data"],
			// The log folder under .local/state was never made, so it is not listed.
			removes: [made.installRoot, made.cache, made.menuEntry, made.shortcut],
			settingsFolder: made.settingsFolder,
		});
		expect(listing(made.home)).toEqual(before);
		expect(made.ranWith()).toBeNull();
	});

	test("a copy that runs from a checkout cannot be uninstalled, and says where it runs from", async () => {
		const made = install();
		const execPath = join(made.home, "checkout/build/dev-linux-x64/Timber-dev/bin/bun");
		const uninstaller = createUninstaller({ ...made.dependencies, execPath });
		const plan = await uninstaller.plan();
		expect(plan).toEqual({ available: false, reason: `This copy of the app was not installed, so there is nothing to uninstall. It runs from ${dirname(execPath)}.` });
		expect(await uninstaller.uninstall({ forgetSettings: true })).toEqual({ outcome: "unavailable", message: (plan as { reason: string }).reason });
		expect(made.ranWith()).toBeNull();
		expect(existsSync(made.settingsFile)).toBe(true);
		expect(made.quits).toEqual([]);
	});

	test("an install whose uninstaller is gone, or whose record cannot be read, cannot be uninstalled", async () => {
		const gone = install("exit 0", { uninstaller: false });
		expect((await createUninstaller(gone.dependencies).plan()).available).toBe(false);

		const noRecord = install("exit 0", { record: null });
		const missing = await createUninstaller(noRecord.dependencies).plan();
		expect(missing.available).toBe(false);
		expect((missing as { reason: string }).reason).toContain(join(noRecord.installRoot, ".electrobun-uninstall.json"));

		const damaged = install("exit 0", { record: "not json" });
		expect(await createUninstaller(damaged.dependencies).plan()).toEqual({
			available: false,
			reason: `The install record at ${join(damaged.installRoot, ".electrobun-uninstall.json")} is not one this app understands.`,
		});
		expect(await createUninstaller(damaged.dependencies).uninstall({ forgetSettings: false })).toMatchObject({ outcome: "unavailable" });
		expect(damaged.ranWith()).toBeNull();
	});

	test("only Linux is offered so far", async () => {
		const made = install();
		for (const platform of ["win32", "darwin"]) {
			expect(await createUninstaller({ ...made.dependencies, platform }).plan()).toEqual({
				available: false,
				reason: "Uninstalling from inside the app is built for Linux only so far.",
			});
		}
	});

	test("uninstalling runs the uninstaller with its two arguments, keeps the settings, and quits", async () => {
		const made = install();
		const result = await createUninstaller(made.dependencies).uninstall({ forgetSettings: false });
		expect(result).toEqual({ outcome: "uninstalled", settingsProblem: null });
		expect(made.ranWith()).toEqual(["--quiet", "--delete-data"]);
		expect(readFileSync(made.settingsFile, "utf8")).toBe("{}\n");
		expect(made.forgotten).toEqual([]);
		await Bun.sleep(20);
		expect(made.quits).toHaveLength(1);
	});

	test("with the settings forgotten, they go after the uninstaller ended, and then the app quits", async () => {
		// The uninstaller fails when the settings are already gone, so the order shows. It finds them from where it is.
		const made = install(`test -f "$(dirname "$0")/../../../../.config/timber-app/settings.json" || exit 9`);
		writeFileSync(`${made.settingsFile}.damaged`, "{");
		const result = await createUninstaller(made.dependencies).uninstall({ forgetSettings: true });
		expect(result).toEqual({ outcome: "uninstalled", settingsProblem: null });
		expect(made.forgotten).toHaveLength(1);
		expect(existsSync(made.settingsFolder)).toBe(false);
		await Bun.sleep(20);
		expect(made.quits).toHaveLength(1);
	});

	test("a failing uninstaller is reported with what it printed, and nothing else happens", async () => {
		const made = install("echo 'error: InvalidUninstallManifest' >&2\nexit 1");
		const result = await createUninstaller(made.dependencies).uninstall({ forgetSettings: true });
		expect(result).toEqual({ outcome: "failed", message: "The uninstaller ended with exit code 1: error: InvalidUninstallManifest" });
		expect(existsSync(made.settingsFile)).toBe(true);
		expect(made.forgotten).toEqual([]);
		await Bun.sleep(20);
		expect(made.quits).toEqual([]);
	});

	test("an uninstaller that cannot be started is a failure, not a crash", async () => {
		const made = install();
		const uninstaller = createUninstaller({ ...made.dependencies, run: () => Promise.reject(new Error("spawn failed")) });
		expect(await uninstaller.uninstall({ forgetSettings: true })).toEqual({ outcome: "failed", message: "The uninstaller could not be started: spawn failed" });
		expect(existsSync(made.settingsFile)).toBe(true);
		expect(made.quits).toEqual([]);
	});

	test("an uninstaller stopped for taking too long is a failure that says so", async () => {
		const made = install();
		const uninstaller = createUninstaller({ ...made.dependencies, run: async () => ({ exitCode: null, output: "" }) });
		expect(await uninstaller.uninstall({ forgetSettings: false })).toEqual({ outcome: "failed", message: "The uninstaller was stopped after 60 seconds." });
	});

	test("settings that cannot be deleted are told, and the app stays open to say so", async () => {
		const made = install();
		const uninstaller = createUninstaller({ ...made.dependencies, forgetSettings: () => Promise.reject(new Error("EACCES: permission denied")) });
		expect(await uninstaller.uninstall({ forgetSettings: true })).toEqual({ outcome: "uninstalled", settingsProblem: "EACCES: permission denied" });
		await Bun.sleep(20);
		expect(made.quits).toEqual([]);
	});

	test("a second request while the uninstaller runs starts nothing", async () => {
		const made = install();
		let release = () => {};
		let runs = 0;
		const uninstaller = createUninstaller({
			...made.dependencies,
			run: () => new Promise(resolve => {
				runs += 1;
				release = () => resolve({ exitCode: 0, output: "" });
			}),
		});
		const first = uninstaller.uninstall({ forgetSettings: false });
		// Wait until the uninstaller is running, not a fixed time: a busy machine may take longer to get there.
		expect(await until(() => runs === 1)).toBe(true);
		expect(await uninstaller.uninstall({ forgetSettings: true })).toEqual({ outcome: "failed", message: "The uninstaller is already running." });
		release();
		expect(await first).toEqual({ outcome: "uninstalled", settingsProblem: null });
		expect(runs).toBe(1);
		expect(made.forgotten).toEqual([]);
	});
});

describe("deleting the app's settings", () => {
	let root: string;
	let count = 0;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-forget-")));
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const folderOf = () => join(root, `config ${++count}`, "timber-app");

	test("the file, a kept damaged copy, and a leftover temporary file go, and then the folder", async () => {
		const folder = folderOf();
		mkdirSync(folder, { recursive: true });
		for (const name of ["settings.json", "settings.json.damaged", "settings.json.4242.0b9a.tmp"]) writeFileSync(join(folder, name), "{}");
		await removeSettings(join(folder, "settings.json"));
		expect(existsSync(folder)).toBe(false);
		// The folder above is not the app's.
		expect(existsSync(dirname(folder))).toBe(true);
	});

	test("anything else in the folder is not the app's and stays, with the folder", async () => {
		const folder = folderOf();
		mkdirSync(join(folder, "notes"), { recursive: true });
		writeFileSync(join(folder, "settings.json"), "{}");
		writeFileSync(join(folder, "mine.txt"), "keep");
		await removeSettings(join(folder, "settings.json"));
		expect(readdirSync(folder).sort()).toEqual(["mine.txt", "notes"]);
	});

	test("nothing to delete is not a failure", async () => {
		await removeSettings(join(folderOf(), "settings.json"));
	});

	test("after the holder discarded the settings, nothing writes them back", async () => {
		const folder = folderOf();
		const file = join(folder, "settings.json");
		const holder = createSettingsHolder(file);
		// A save asked for before the discard still finishes first, so it cannot land after it.
		const earlier = holder.inTurn(() => holder.save(emptySettings()));
		await holder.discard();
		await earlier;
		expect(existsSync(folder)).toBe(false);
		await expect(holder.save(emptySettings())).rejects.toThrow("The settings were deleted with the app, so nothing is saved any more.");
		await expect(holder.inTurn(() => holder.save(emptySettings()))).rejects.toThrow("deleted with the app");
		await Bun.sleep(20);
		expect(existsSync(folder)).toBe(false);
	});
});
