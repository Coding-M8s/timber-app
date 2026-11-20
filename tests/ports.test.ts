import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attention } from "../src/shared/attention";
import type { Repository } from "../src/shared/model";
import { PORTS_GAP_MILLISECONDS, type PortsResult } from "../src/shared/ports";
import { createPorts } from "../src/bun/ports";
import { sessionListeningPorts } from "../src/bun/session-ports";
import type { SessionLeader } from "../src/bun/terminals";
import { until, windows } from "./support/runtime";
import { bunStandIn, fingerprint, git } from "./support/timber";

let root: string;
let primary: string;
let linked: string;
let other: string;

const listed = (): Repository => ({
	path: primary, name: "shop", available: true, failure: null, setup: "repository",
	worktrees: [primary, linked, other].map(path => ({
		id: path, path, canonicalPath: path, branch: path === primary ? "main" : "feat/x", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
	})),
});

const shown: Attention = { visible: true, focused: true, selected: null };

/**
 * A stand-in `docker` that notes each call in `calls.log` beside itself. Asked
 * `ps`, it prints two ids; asked `inspect`, the records of `inspect.txt`. With
 * `fail.txt` there, it prints that on standard error and exits with 1.
 */
const DOCKER_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(path.join(folder, "calls.log"), process.argv.slice(2).join(" ") + "\\n");
const fail = path.join(folder, "fail.txt");
if (fs.existsSync(fail)) { process.stderr.write(fs.readFileSync(fail, "utf8")); process.exit(1); }
if (process.argv[2] === "ps") { process.stdout.write("0123456789ab\\nba9876543210\\n"); process.exit(0); }
process.stdout.write(fs.readFileSync(path.join(folder, "inspect.txt"), "utf8"));
`;

function standInDocker(name: string): { path: string; folder: string; calls: () => string[] } {
	const folder = join(root, name);
	mkdirSync(folder, { recursive: true });
	const path = bunStandIn(folder, DOCKER_SCRIPT);
	const record = (workingDir: string, service: string, port: string, state = "running") => JSON.stringify({
		name: `/${service}-1`, state, workingDir, service,
		ports: state === "running" ? { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: port }, { HostIp: "::", HostPort: port }] } : {},
		bindings: { "80/tcp": [{ HostIp: "", HostPort: port }] },
	});
	writeFileSync(join(folder, "inspect.txt"), [
		record(linked, "web", "8008"),
		record(join(linked, "docker"), "api", "8009"),
		record(other, "web", "8008", "created"),
		record(other, "admin", "8010"),
	].join("\n") + "\n");
	const calls = () => existsSync(join(folder, "calls.log")) ? readFileSync(join(folder, "calls.log"), "utf8").trim().split("\n") : [];
	return { path, folder, calls };
}

function reader(options: { docker: string | null; attention?: () => Attention; now?: () => number; leaders?: () => SessionLeader[]; proc?: string; platform?: NodeJS.Platform }) {
	return createPorts({
		findRepository: async path => path === primary ? listed() : null,
		leaders: options.leaders ?? (() => []),
		attention: options.attention ?? (() => shown),
		docker: () => options.docker,
		...(options.now ? { now: options.now } : {}),
		...(options.proc ? { proc: options.proc } : {}),
		...(options.platform ? { platform: options.platform } : {}),
	});
}

const asRead = (result: PortsResult) => {
	if (result.outcome !== "read") throw new Error(`Not read: ${JSON.stringify(result)}`);
	return result;
};

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-ports-")));
	primary = join(root, "shop");
	git(root, "init", "--initial-branch=main", primary);
	writeFileSync(join(primary, "a.txt"), "a\n");
	git(primary, "add", "--all");
	git(primary, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "First");
	linked = join(root, "shop-worktrees", "GH-16");
	other = join(root, "shop-worktrees", "GH-169");
	git(primary, "worktree", "add", "-b", "gh-16", linked);
	git(primary, "worktree", "add", "-b", "gh-169", other);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("reading a worktree's Docker ports", () => {
	test("its own containers, nested folders included, and never another worktree's; the shared port is a clash", async () => {
		const docker = standInDocker("docker-own");
		const result = asRead(await reader({ docker: docker.path, platform: "darwin" }).read({ repository: primary, worktree: linked }));
		expect(result.docker).toEqual({ state: "read", ports: [
			{ service: "web", container: "web-1", hostPort: 8008, containerPort: 80, protocol: "tcp" },
			{ service: "api", container: "api-1", hostPort: 8009, containerPort: 80, protocol: "tcp" },
		] });
		expect(result.clashes).toEqual([{ hostPort: 8008, protocol: "tcp", folders: [linked, other].sort() }]);
		expect(docker.calls()[0]).toStartWith("ps --all");
		expect(docker.calls()[1]).toStartWith("inspect --type container --format");
		expect(docker.calls()[1]).toEndWith("0123456789ab ba9876543210");

		const theOther = asRead(await reader({ docker: docker.path, platform: "darwin" }).read({ repository: primary, worktree: other }));
		expect(theOther.docker).toEqual({ state: "read", ports: [{ service: "admin", container: "admin-1", hostPort: 8010, containerPort: 80, protocol: "tcp" }] });
	});

	test("leaves the repository's files and refs as they were", async () => {
		const docker = standInDocker("docker-intact");
		const before = fingerprint(primary);
		asRead(await reader({ docker: docker.path, platform: "darwin" }).read({ repository: primary, worktree: linked }));
		expect(fingerprint(primary)).toBe(before);
	});

	test("a worktree Timber does not list is refused, and Docker is not asked", async () => {
		const docker = standInDocker("docker-refused");
		const result = await reader({ docker: docker.path }).read({ repository: primary, worktree: join(root, "elsewhere") });
		expect(result.outcome).toBe("not-listed");
		expect(docker.calls()).toEqual([]);
	});

	test("no Docker, Docker stopped, and permission denied are each a quiet reason, with sessions still read", async () => {
		const none = asRead(await reader({ docker: null, platform: "darwin" }).read({ repository: primary, worktree: linked }));
		expect(none.docker).toMatchObject({ state: "unavailable", problem: "no-docker" });
		expect(none.sessions).toEqual({ state: "unknown", message: "Ports of sessions are read on Linux only." });

		const missing = asRead(await reader({ docker: join(root, "no-such-docker"), platform: "darwin" }).read({ repository: primary, worktree: linked }));
		expect(missing.docker).toMatchObject({ state: "unavailable", problem: "no-docker" });

		const stopped = standInDocker("docker-stopped");
		writeFileSync(join(stopped.folder, "fail.txt"), "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n");
		const stoppedRead = asRead(await reader({ docker: stopped.path, platform: "darwin" }).read({ repository: primary, worktree: linked }));
		expect(stoppedRead.docker).toEqual({ state: "unavailable", problem: "stopped", message: "Docker is not running. Docker said: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" });

		const denied = standInDocker("docker-denied");
		writeFileSync(join(denied.folder, "fail.txt"), "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock\n");
		const deniedRead = asRead(await reader({ docker: denied.path, platform: "darwin" }).read({ repository: primary, worktree: linked }));
		expect(deniedRead.docker).toMatchObject({ state: "unavailable", problem: "denied" });
	});
});

describe("how often ports are read", () => {
	test("nothing is read while the window is hidden", async () => {
		const docker = standInDocker("docker-hidden");
		const result = await reader({ docker: docker.path, attention: () => ({ ...shown, visible: false }) }).read({ repository: primary, worktree: linked });
		expect(result).toEqual({ outcome: "hidden" });
		expect(docker.calls()).toEqual([]);
	});

	test("the same worktree at most once in the gap; requests meanwhile get the last answer, and ones at once share a read", async () => {
		const docker = standInDocker("docker-gap");
		let now = 1000;
		const ports = reader({ docker: docker.path, now: () => now, platform: "darwin" });
		const request = { repository: primary, worktree: linked };
		const [first, second] = await Promise.all([ports.read(request), ports.read(request)]);
		expect(second).toBe(first);
		expect(docker.calls().length).toBe(2);
		now += PORTS_GAP_MILLISECONDS - 1;
		expect(await ports.read(request)).toBe(first);
		expect(docker.calls().length).toBe(2);
		// Another worktree has its own gap.
		await ports.read({ repository: primary, worktree: other });
		expect(docker.calls().length).toBe(4);
		now += 1;
		expect(await ports.read(request)).not.toBe(first);
		expect(docker.calls().length).toBe(6);
	});
});

// A pretend process table: Linux only, since it uses symbolic links as /proc does.
describe.skipIf(windows)("ports of sessions from the process table", () => {
	function fakeProc(name: string): string {
		const proc = join(root, name);
		const process = (pid: number, session: number, sockets: number[]) => {
			mkdirSync(join(proc, String(pid), "fd"), { recursive: true });
			writeFileSync(join(proc, String(pid), "stat"), `${pid} (my (odd) name) S 1 ${session} ${session} 0 -1 4194560`);
			sockets.forEach((inode, index) => symlinkSync(`socket:[${inode}]`, join(proc, String(pid), "fd", String(index + 3))));
			symlinkSync("/dev/null", join(proc, String(pid), "fd", "0"));
		};
		process(100, 100, []);
		process(101, 100, [41234, 999]);
		process(200, 200, [52001]);
		process(300, 300, [52001]);
		mkdirSync(join(proc, "net"), { recursive: true });
		const header = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";
		writeFileSync(join(proc, "net", "tcp"), header + "   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41234 1 0 100 0 0 10 0\n");
		writeFileSync(join(proc, "net", "tcp6"), header + "   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 52001 1 0 100 0 0 10 0\n");
		return proc;
	}

	test("each session's listening ports, from every process in it", () => {
		const proc = fakeProc("proc-sessions");
		expect(sessionListeningPorts([{ id: "a", pid: 100 }, { id: "b", pid: 200 }, { id: "c", pid: 400 }], proc)).toEqual(new Map([["a", [5173]], ["b", [3000]], ["c", []]]));
		expect(sessionListeningPorts([{ id: "a", pid: 100 }], join(root, "no-proc"))).toBeNull();
	});

	test("a session's ports show on its worktree only, and two worktrees on one port are a clash", async () => {
		const proc = fakeProc("proc-clash");
		const leaders = () => [
			{ id: "s1", name: "Terminal", path: linked, pid: 100 },
			{ id: "s2", name: "Dev server", path: linked, pid: 200 },
			{ id: "s3", name: "Terminal", path: other, pid: 300 },
		];
		const result = asRead(await reader({ docker: null, leaders, proc, platform: "linux" }).read({ repository: primary, worktree: linked }));
		expect(result.sessions).toEqual({ state: "read", ports: [
			{ session: "s1", name: "Terminal", hostPort: 5173, protocol: "tcp" },
			{ session: "s2", name: "Dev server", hostPort: 3000, protocol: "tcp" },
		] });
		expect(result.clashes).toEqual([{ hostPort: 3000, protocol: "tcp", folders: [linked, other].sort() }]);
	});
});

// The real process table, with a real listener that leads a session of its own as a terminal's shell does.
describe.skipIf(process.platform !== "linux")("ports of a real session", () => {
	test("a listener started in a session is found by the session's id", async () => {
		const server = Bun.spawn(["setsid", process.execPath, "-e", "const s = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } }); console.log(s.port);"], { stdout: "pipe", stdin: "ignore" });
		try {
			const reader = server.stdout.getReader();
			const { value } = await reader.read();
			const port = Number(new TextDecoder().decode(value).trim());
			expect(port).toBeGreaterThan(0);
			let found: number[] | undefined;
			expect(await until(() => {
				found = sessionListeningPorts([{ id: "real", pid: server.pid }])?.get("real");
				return found?.includes(port) ?? false;
			})).toBe(true);
		} finally {
			server.kill("SIGKILL");
		}
	});
});
