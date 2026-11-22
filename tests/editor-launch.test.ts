import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EditorDependencies, createEditorLauncher } from "../src/bun/editor";
import type { AgentLaunch } from "../src/bun/terminals";
import { type EditorSetting } from "../src/shared/editor";
import type { Repository } from "../src/shared/model";
import type { OpenTerminalRequest, OpenTerminalResult, TerminalSession } from "../src/shared/terminal";
import { defaultPreferences } from "../src/shared/preferences";
import { until, windows } from "./support/runtime";

// The stand-in editors are shell scripts, so these run where there is a POSIX shell.
describe.skipIf(windows)("opening a worktree in an editor, with stand-in editors", () => {
	let root: string;
	let bin: string;
	let repository: string;
	let worktree: string;
	let count = 0;

	beforeAll(() => {
		// Paths are compared as the editor sees them, so resolve the temporary folder once (it is a link on macOS).
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-editor-")));
		bin = join(root, "editor bin");
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat login");
		for (const folder of [bin, repository, worktree]) mkdirSync(folder, { recursive: true });
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** The repository as the app's list would answer, with these worktree paths. */
	const listed = (paths: string[]): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository",
		fallbackBase: null,
		worktrees: paths.map(path => ({
			id: path, path, canonicalPath: path, branch: "feat/login", head: null, primary: false, detached: false, locked: false, prunable: false,
			pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
		})),
	});

	/**
	 * A stand-in editor in the folder with a space in its name. It writes the
	 * folder it runs in and then each argument on a line of its own to a file
	 * beside it, so the test sees exactly what it was given. `body` runs after.
	 */
	function standInEditor(body = "") {
		const name = `edit-${++count}`;
		const path = join(bin, name);
		const record = join(bin, `${name}.calls`);
		writeFileSync(path, [
			"#!/bin/sh",
			`{ pwd; for argument in "$@"; do printf '%s\\n' "$argument"; done; } > "${record}.tmp"`,
			`mv "${record}.tmp" "${record}"`,
			body,
			"",
		].join("\n"));
		chmodSync(path, 0o755);
		return {
			name,
			path,
			ran: () => existsSync(record),
			/** The folder it ran in, then its arguments. */
			calls: async () => {
				expect(await until(() => existsSync(record))).toBe(true);
				return readFileSync(record, "utf8").split("\n").slice(0, -1);
			},
		};
	}

	function launcher(editor: EditorSetting | null, found: Repository | null = listed([worktree]), more: Partial<EditorDependencies> = {}) {
		return createEditorLauncher({
			preferences: async () => ({ ...defaultPreferences(), editor }),
			findRepository: async () => found,
			environment: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
			watchMilliseconds: 0,
			...more,
		});
	}

	const request = () => ({ repository, worktree });

	test("a command on the PATH gets the worktree path as one argument, and runs in the worktree", async () => {
		const editor = standInEditor();
		const result = await launcher({ command: `${editor.name} --new-window`, terminal: false }).open(request());
		expect(result).toEqual({ outcome: "opened", command: `${editor.name} --new-window '${worktree}'` });
		expect(await editor.calls()).toEqual([worktree, "--new-window", worktree]);
	});

	test("a full path with spaces works, and {path} puts the path where the command says", async () => {
		const editor = standInEditor();
		const result = await launcher({ command: `"${editor.path}" --folder={path} --wait`, terminal: false }).open(request());
		expect(result).toEqual({ outcome: "opened", command: `'${editor.path}' '--folder=${worktree}' --wait` });
		expect(await editor.calls()).toEqual([worktree, `--folder=${worktree}`, "--wait"]);
	});

	test("a file named in the request is opened in place of the folder, still in the worktree", async () => {
		mkdirSync(join(worktree, "src dir"), { recursive: true });
		const file = join(worktree, "src dir", "zażółć.ts");
		writeFileSync(file, "export {};\n");
		const editor = standInEditor();
		const result = await launcher({ command: `${editor.name} --goto {path}`, terminal: false }).open({ ...request(), file: "src dir/zażółć.ts" });
		expect(result).toEqual({ outcome: "opened", command: `${editor.name} --goto '${file}'` });
		expect(await editor.calls()).toEqual([worktree, "--goto", file]);
	});

	test("a file outside the worktree, or one that is not there, starts nothing", async () => {
		const editor = standInEditor();
		const run = (file: string) => launcher({ command: editor.name, terminal: false }).open({ ...request(), file });
		for (const file of ["../escape.txt", "/etc/hostname", "a/../../b"]) {
			const result = await run(file);
			expect(result.outcome === "failed" && result.command).toBeNull();
		}
		expect(await run("deleted.txt")).toEqual({ outcome: "failed", command: null, message: `There is no file at ${join(worktree, "deleted.txt")}. No editor was started.` });
		expect(editor.ran()).toBe(false);
	});

	test("dollar signs in the path arrive as they are, where {path} stands", async () => {
		const priced = join(root, "my repo-worktrees", "cash$&x $$ it$'s $1");
		mkdirSync(priced, { recursive: true });
		const editor = standInEditor();
		const result = await launcher({ command: `${editor.name} --folder={path} --wait`, terminal: false }, listed([priced])).open({ repository, worktree: priced });
		expect(result.outcome).toBe("opened");
		expect(await editor.calls()).toEqual([priced, `--folder=${priced}`, "--wait"]);
	});

	test("nothing in the path is read by a shell", async () => {
		const strange = join(root, "my repo-worktrees", `it's "$(touch pwned)" ; x`);
		mkdirSync(strange, { recursive: true });
		const editor = standInEditor();
		const result = await launcher({ command: editor.name, terminal: false }, listed([strange])).open({ repository, worktree: strange });
		expect(result.outcome).toBe("opened");
		expect(await editor.calls()).toEqual([strange, strange]);
		expect(existsSync(join(strange, "pwned"))).toBe(false);
		expect(existsSync(join(bin, "pwned"))).toBe(false);
	});

	test("a missing executable names the command and the PATH the app was started with", async () => {
		const result = await launcher({ command: "no-such-editor --new", terminal: false }).open(request());
		expect(result).toEqual({
			outcome: "not-found",
			command: `no-such-editor --new '${worktree}'`,
			executable: "no-such-editor",
			message: `Could not start the editor. "no-such-editor" was not found on the PATH the app was started with: ${bin}:/usr/bin:/bin. A change to PATH needs a restart of the app, or use the full path in Settings, Editor.`,
		});
		const long = [bin, ...Array.from({ length: 22 }, (_, index) => join(root, `tools ${index}`, "bin"))].join(":");
		const crowded = await launcher({ command: "no-such-editor", terminal: false }, listed([worktree]), { environment: { PATH: long } }).open(request());
		expect(crowded.outcome === "not-found" && crowded.message).toBe(
			`Could not start the editor. "no-such-editor" was not found on the PATH the app was started with: ${bin}:${join(root, "tools 0", "bin")}:${join(root, "tools 1", "bin")} and 20 more folders. A change to PATH needs a restart of the app, or use the full path in Settings, Editor.`,
		);
		const empty = await launcher({ command: "code", terminal: false }, listed([worktree]), { environment: { HOME: root } }).open(request());
		expect(empty.outcome === "not-found" && empty.message).toContain("the PATH the app was started with: (empty).");
		const absolute = await launcher({ command: `"${join(bin, "missing")}"`, terminal: false }).open(request());
		expect(absolute.outcome === "not-found" && absolute.message).toBe(`Could not start the editor. There is no executable file at ${join(bin, "missing")}.`);
	});

	/**
	 * A folder to use as the whole PATH, holding stand-ins with these names.
	 * Each writes its own path and then its arguments, a line each, to a file
	 * beside it, with nothing but what the shell has built in, so it needs no
	 * other folder on the PATH. The machine's own `zed` or `zeditor` is never
	 * found, because its folder is not on this PATH.
	 */
	function folderWith(names: string[]) {
		const folder = join(root, `named ${++count}`);
		mkdirSync(folder);
		for (const name of names) {
			writeFileSync(join(folder, name), `#!/bin/sh\nprintf '%s\\n' "$0" "$@" > "$0.calls"\n`);
			chmodSync(join(folder, name), 0o755);
		}
		const record = (name: string) => join(folder, `${name}.calls`);
		return {
			folder,
			ran: (name: string) => existsSync(record(name)),
			/** The path it was started as, then its arguments. */
			calls: async (name: string, lines: number) => {
				const read = () => (existsSync(record(name)) ? readFileSync(record(name), "utf8").split("\n").slice(0, -1) : []);
				expect(await until(() => read().length === lines)).toBe(true);
				return read();
			},
		};
	}

	const zed: EditorSetting = { command: "zed", terminal: false };

	test("the Zed choice starts zeditor where Zed is installed under that name, and shows the command that ran", async () => {
		const installed = folderWith(["zeditor"]);
		const result = await launcher(zed, listed([worktree]), { environment: { PATH: installed.folder } }).open(request());
		expect(result).toEqual({ outcome: "opened", command: `zeditor '${worktree}'` });
		expect(await installed.calls("zeditor", 2)).toEqual([join(installed.folder, "zeditor"), worktree]);
	});

	test("the other name keeps the arguments and the place of {path}, and works for a file", async () => {
		const installed = folderWith(["zeditor"]);
		writeFileSync(join(worktree, "notes.md"), "notes\n");
		const result = await launcher({ command: "zed --new {path} --wait", terminal: false }, listed([worktree]), { environment: { PATH: installed.folder } }).open({ ...request(), file: "notes.md" });
		expect(result).toEqual({ outcome: "opened", command: `zeditor --new '${join(worktree, "notes.md")}' --wait` });
		expect(await installed.calls("zeditor", 4)).toEqual([join(installed.folder, "zeditor"), "--new", join(worktree, "notes.md"), "--wait"]);
	});

	test("zed itself is preferred where both names are installed, also in a later folder of the PATH", async () => {
		const both = folderWith(["zed", "zeditor"]);
		const result = await launcher(zed, listed([worktree]), { environment: { PATH: both.folder } }).open(request());
		expect(result).toEqual({ outcome: "opened", command: `zed '${worktree}'` });
		expect(await both.calls("zed", 2)).toEqual([join(both.folder, "zed"), worktree]);

		const first = folderWith(["zeditor"]);
		const second = folderWith(["zed"]);
		const split = await launcher(zed, listed([worktree]), { environment: { PATH: `${first.folder}:${second.folder}` } }).open(request());
		expect(split).toEqual({ outcome: "opened", command: `zed '${worktree}'` });
		expect(await second.calls("zed", 2)).toEqual([join(second.folder, "zed"), worktree]);
		await Bun.sleep(100);
		expect(both.ran("zeditor")).toBe(false);
		expect(first.ran("zeditor")).toBe(false);
	});

	test("with neither name installed, the answer names both and keeps the command as it is set", async () => {
		const bare = folderWith([]);
		const result = await launcher({ command: "zed --new", terminal: false }, listed([worktree]), { environment: { PATH: bare.folder } }).open(request());
		expect(result).toEqual({
			outcome: "not-found",
			command: `zed --new '${worktree}'`,
			executable: "zed",
			message: `Could not start the editor. Neither "zed" nor "zeditor" was found on the PATH the app was started with: ${bare.folder}. A change to PATH needs a restart of the app, or use the full path in Settings, Editor.`,
		});
	});

	test("only the name zed has another name: a full path to zed, and any other command, are taken as they are", async () => {
		const installed = folderWith(["zeditor", "zed-preview"]);
		const environment = { PATH: installed.folder };
		const absolute = await launcher({ command: `"${join(installed.folder, "zed")}"`, terminal: false }, listed([worktree]), { environment }).open(request());
		expect(absolute.outcome === "not-found" && absolute.message).toBe(`Could not start the editor. There is no executable file at ${join(installed.folder, "zed")}.`);
		const other = await launcher({ command: "code", terminal: false }, listed([worktree]), { environment }).open(request());
		expect(other.outcome === "not-found" && other.message).toContain('"code" was not found on the PATH');
		await Bun.sleep(100);
		expect(installed.ran("zeditor")).toBe(false);
	});

	test("a relative path is refused, because its meaning would depend on the folder", async () => {
		const editor = standInEditor();
		const result = await launcher({ command: `./${editor.name}`, terminal: false }).open(request());
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.message).toContain("relative path");
		await Bun.sleep(100);
		expect(editor.ran()).toBe(false);
	});

	test("nothing starts for a worktree Timber does not list, a repository outside the list, or a missing folder", async () => {
		const editor = standInEditor();
		const gone = join(root, "my repo-worktrees", "gone");
		const cases: [Repository | null, string, string][] = [
			[null, worktree, "is not a repository in this app's list"],
			[{ ...listed([worktree]), available: false }, worktree, "Git cannot read the repository"],
			[{ ...listed([]), failure: "Timber is too old" }, worktree, "Timber could not list the worktrees"],
			[listed([join(root, "elsewhere")]), worktree, `Timber lists no worktree at ${worktree}`],
			[listed([gone]), gone, `The folder ${gone} is missing`],
		];
		for (const [found, path, words] of cases) {
			const result = await launcher({ command: editor.name, terminal: false }, found).open({ repository, worktree: path });
			expect(result.outcome).toBe("not-listed");
			expect(result.outcome === "not-listed" && result.message).toContain(words);
		}
		await Bun.sleep(100);
		expect(editor.ran()).toBe(false);
	});

	test("a worktree path that is not a full path is refused before anything else", async () => {
		const editor = standInEditor();
		const result = await launcher({ command: editor.name, terminal: true }, listed(["feat login"])).open({ repository, worktree: "feat login" });
		expect(result).toEqual({ outcome: "not-listed", message: "feat login is not a full path, so it cannot be a worktree Timber lists. No editor was started." });
	});

	test("on Windows a batch file is refused, because cmd.exe would read the path again", async () => {
		const batch = join(bin, "code.cmd");
		writeFileSync(batch, "#!/bin/sh\n");
		chmodSync(batch, 0o755);
		const result = await launcher({ command: "code.cmd", terminal: false }, listed([worktree]), { platform: "win32" }).open(request());
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.message).toContain("not tested on Windows yet");
	});

	test("a terminal editor is answered only for a listed worktree, so no command is built from another path", async () => {
		const result = await launcher({ command: "nvim", terminal: true }, listed([])).open(request());
		expect(result.outcome).toBe("not-listed");
	});

	test("with no editor set, nothing starts", async () => {
		expect(await launcher(null).open(request())).toEqual({ outcome: "not-configured" });
	});

	/** A session as the terminals would answer for an editor. */
	const editorSession = (command: string): TerminalSession => ({
		id: "session-1", kind: "editor", name: "nvim", repository, worktree, path: worktree, shell: "/usr/bin/nvim", command,
		state: { kind: "running" }, status: null, children: [],
	});

	/** An `openSession` that records what it was asked for and answers `answer`. */
	function fakeSessions(answer: (launch: AgentLaunch) => OpenTerminalResult) {
		const asked: { request: OpenTerminalRequest; launch: AgentLaunch }[] = [];
		return { asked, openSession: async (request: OpenTerminalRequest, launch: AgentLaunch) => (asked.push({ request, launch }), answer(launch)) };
	}

	test("a terminal editor starts in a new session, with the worktree as its last argument, and no editor process of its own", async () => {
		const editor = standInEditor();
		const sessions = fakeSessions(() => ({ outcome: "opened", session: editorSession(`/usr/bin/nvim '${worktree}'`) }));
		const result = await launcher({ command: `${editor.name} -p`, terminal: true }, listed([worktree]), { openSession: sessions.openSession }).open(request());
		expect(result).toEqual({ outcome: "opened", command: `/usr/bin/nvim '${worktree}'`, session: editorSession(`/usr/bin/nvim '${worktree}'`) });
		expect(sessions.asked).toHaveLength(1);
		expect(sessions.asked[0]!.request).toEqual({ repository, worktree, cols: 80, rows: 24 });
		expect(sessions.asked[0]!.launch).toMatchObject({ name: editor.name, executable: editor.name, arguments: ["-p", worktree], kind: "editor", otherNames: [] });
		await Bun.sleep(100);
		expect(editor.ran()).toBe(false);
	});

	test("a terminal editor is given the file named in the request, and is named after its executable", async () => {
		const file = join(worktree, "terminal-file.ts");
		writeFileSync(file, "export {};\n");
		const sessions = fakeSessions(() => ({ outcome: "opened", session: editorSession("nvim") }));
		await launcher({ command: "/usr/local/bin/nvim.exe", terminal: true }, listed([worktree]), { openSession: sessions.openSession }).open({ ...request(), file: "terminal-file.ts" });
		expect(sessions.asked[0]!.launch).toMatchObject({ name: "nvim", executable: "/usr/local/bin/nvim.exe", arguments: [file] });
	});

	test("what the terminals answer for a terminal editor is passed on", async () => {
		const setting = { command: "nvim", terminal: true };
		const answer = async (result: OpenTerminalResult) => {
			const sessions = fakeSessions(() => result);
			return launcher(setting, listed([worktree]), { openSession: sessions.openSession }).open(request());
		};
		expect(await answer({ outcome: "not-found", command: "nvim", executable: "nvim", message: "nowhere" }))
			.toEqual({ outcome: "not-found", command: "nvim", executable: "nvim", message: "nowhere" });
		expect(await answer({ outcome: "failed", command: "nvim x", message: "broke" })).toEqual({ outcome: "failed", command: "nvim x", message: "broke" });
		expect(await answer({ outcome: "failed", message: "broke" })).toEqual({ outcome: "failed", command: `nvim '${worktree}'`, message: "broke" });
		expect(await answer({ outcome: "unsupported", message: "no pty" })).toEqual({ outcome: "failed", command: `nvim '${worktree}'`, message: "no pty" });
		expect(await answer({ outcome: "not-listed", message: "gone" })).toEqual({ outcome: "not-listed", message: "gone" });
	});

	test("without terminals, a terminal editor is not started", async () => {
		const result = await launcher({ command: "nvim", terminal: true }).open(request());
		expect(result).toMatchObject({ outcome: "failed", command: `nvim '${worktree}'` });
	});

	test("an editor that stops right away with an error is a failure, and one that hands over and exits with 0 is not", async () => {
		const failing = standInEditor("exit 3");
		const failed = await launcher({ command: failing.name, terminal: false }, listed([worktree]), { watchMilliseconds: 3000 }).open(request());
		expect(failed).toEqual({
			outcome: "failed",
			command: `${failing.name} '${worktree}'`,
			message: "The editor exited with code 3 right after it started. Try the command in a terminal to see why.",
		});
		const handing = standInEditor("exit 0");
		const opened = await launcher({ command: handing.name, terminal: false }, listed([worktree]), { watchMilliseconds: 3000 }).open(request());
		expect(opened.outcome).toBe("opened");
	});

	test("an editor that keeps running does not hold up the answer longer than the watch", async () => {
		const running = standInEditor("sleep 5");
		const started = Date.now();
		const result = await launcher({ command: running.name, terminal: false }, listed([worktree]), { watchMilliseconds: 200 }).open(request());
		expect(result.outcome).toBe("opened");
		expect(Date.now() - started).toBeLessThan(2000);
	});

	test("the editor outlives the process that started it, even when that process's whole group is killed", async () => {
		const survived = join(bin, "survived");
		const control = join(bin, "control survived");
		// It writes its process ID, waits, and then says it is still there.
		const editor = standInEditor(`echo $$ > "${join(bin, "editor.pid")}"\nsleep 1\necho yes > "${survived}"`);
		const helper = join(bin, "helper.ts");
		const ready = join(bin, "helper ready");
		writeFileSync(helper, `
			import { createEditorLauncher } from ${JSON.stringify(join(import.meta.dir, "..", "src", "bun", "editor.ts"))};
			const repository = ${JSON.stringify(listed([worktree]))};
			const launcher = createEditorLauncher({
				preferences: async () => ({ sidebarSide: "left", editor: { command: ${JSON.stringify(editor.name)}, terminal: false } }),
				findRepository: async () => repository,
				environment: { ...process.env, PATH: ${JSON.stringify(`${bin}:/usr/bin:/bin`)} },
				watchMilliseconds: 0,
			});
			// A child started the ordinary way, in the helper's own process group, to show what the kill reaches.
			Bun.spawn(["/bin/sh", "-c", ${JSON.stringify(`sleep 1; echo yes > "${control}"`)}], { stdio: ["ignore", "ignore", "ignore"] });
			const result = await launcher.open({ repository: ${JSON.stringify(repository)}, worktree: ${JSON.stringify(worktree)} });
			await Bun.write(${JSON.stringify(ready)}, JSON.stringify(result));
			setInterval(() => {}, 1000);
		`);
		// The helper leads a process group of its own, as an app started from a terminal or a launcher does.
		const app = Bun.spawn([process.execPath, helper], { stdio: ["ignore", "ignore", "inherit"], detached: true });
		expect(await until(() => existsSync(ready))).toBe(true);
		expect(JSON.parse(readFileSync(ready, "utf8"))).toMatchObject({ outcome: "opened" });
		expect(await until(() => existsSync(join(bin, "editor.pid")))).toBe(true);

		// Closing the app: every process in its group is killed at once.
		process.kill(-app.pid, "SIGKILL");
		await app.exited;
		expect(app.signalCode).toBe("SIGKILL");

		expect(await until(() => existsSync(survived), 5000)).toBe(true);
		expect(await editor.calls()).toEqual([worktree, worktree]);
		// The ordinary child had the same second to wait, and was killed with the app.
		await Bun.sleep(300);
		expect(existsSync(control)).toBe(false);
	});
});
