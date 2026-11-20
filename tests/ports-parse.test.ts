import { describe, expect, test } from "bun:test";
import {
	DOCKER_INSPECT_FORMAT, DOCKER_PS_ARGUMENTS, countPorts, describeDockerProblem, dockerClaims, dockerInspectArguments, dockerPortsOf, dockerProblemOf,
	findClashes, isInside, parseComposeContainers, parseContainerIds, parseSocketTable, portClashMarks, socketInodeOf, worktreeHolding,
} from "../src/shared/ports";

const line = (record: object) => JSON.stringify(record);

/** What `docker inspect` prints with `DOCKER_INSPECT_FORMAT`, in the shape Docker 29 writes. */
const inspected = [
	line({
		name: "/shop-web-1", state: "running", workingDir: "/w/shop-worktrees/GH-16", service: "web",
		ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8008" }, { HostIp: "::", HostPort: "8008" }], "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "4438" }] },
		bindings: { "80/tcp": [{ HostIp: "", HostPort: "8008" }], "443/tcp": [{ HostIp: "", HostPort: "4438" }] },
	}),
	line({
		name: "/shop-minio-1", state: "running", workingDir: "/w/shop-worktrees/GH-16", service: "minio",
		ports: { "9000/tcp": null, "9001/tcp": [{ HostIp: "0.0.0.0", HostPort: "9208" }], "53/udp": [{ HostIp: "0.0.0.0", HostPort: "5353" }] },
		bindings: null,
	}),
	line({
		name: "/other-db-1", state: "created", workingDir: "/w/shop-worktrees/GH-169", service: "db",
		ports: {}, bindings: { "5432/tcp": [{ HostIp: "", HostPort: "8008" }], "6379/tcp": [{ HostIp: "", HostPort: "" }] },
	}),
].join("\n");

describe("reading Docker's answers", () => {
	test("container ids, one a line, and nothing else", () => {
		expect(parseContainerIds("03a0f7bb8ee7\n\nnot an id\n" + "a".repeat(64) + "\r\n")).toEqual(["03a0f7bb8ee7", "a".repeat(64)]);
	});

	test("asks only for Compose containers, and never for a container's environment", () => {
		expect(DOCKER_PS_ARGUMENTS).toContain("label=com.docker.compose.project.working_dir");
		expect(DOCKER_PS_ARGUMENTS).toContain("--all");
		expect(DOCKER_INSPECT_FORMAT).not.toContain("Env");
		expect(DOCKER_INSPECT_FORMAT).not.toContain("{{json .}}");
		expect(dockerInspectArguments(["abc"]).slice(-1)).toEqual(["abc"]);
	});

	test("published ports of a running container, IPv4 and IPv6 as one, exposed-only ports left out", () => {
		const [web, minio, db] = parseComposeContainers(inspected);
		expect(web).toEqual({
			name: "shop-web-1", state: "running", workingDir: "/w/shop-worktrees/GH-16", service: "web",
			published: [{ hostPort: 4438, containerPort: 443, protocol: "tcp" }, { hostPort: 8008, containerPort: 80, protocol: "tcp" }],
			wanted: [{ hostPort: 4438, containerPort: 443, protocol: "tcp" }, { hostPort: 8008, containerPort: 80, protocol: "tcp" }],
		});
		expect(minio!.published).toEqual([{ hostPort: 5353, containerPort: 53, protocol: "udp" }, { hostPort: 9208, containerPort: 9001, protocol: "tcp" }]);
		// Not running: publishes nothing, but still wants its port. A port Docker would pick is no claim.
		expect(db!.published).toEqual([]);
		expect(db!.wanted).toEqual([{ hostPort: 8008, containerPort: 5432, protocol: "tcp" }]);
	});

	test("lines that are not a container record, or have no working directory, are skipped", () => {
		expect(parseComposeContainers("garbage\nnull\n" + line({ name: "/x", state: "running", workingDir: "", ports: {} }))).toEqual([]);
	});

	test("Docker's reasons, as Docker 29 words them", () => {
		expect(dockerProblemOf("failed to connect to the docker API at unix:///nonexistent/docker.sock; check if the path is correct and if the daemon is running: dial unix /nonexistent/docker.sock: connect: no such file or directory")).toBe("stopped");
		expect(dockerProblemOf("Cannot connect to the Docker daemon at unix:///run/docker.sock. Is the docker daemon running?")).toBe("stopped");
		expect(dockerProblemOf("permission denied while trying to connect to the docker API at unix:///var/run/docker.sock")).toBe("denied");
		expect(dockerProblemOf("Error response from daemon: something else")).toBe("failed");
		expect(describeDockerProblem("denied", "permission denied while trying\nmore")).toBe("No permission to use Docker. Its socket is usually open only to the docker group. Docker said: permission denied while trying");
		expect(describeDockerProblem("no-docker", "")).toBe("Docker is not installed here, or not on the PATH.");
	});
});

describe("which worktree a container belongs to", () => {
	const primary = { path: "/w/shop", canonicalPath: "/w/shop" };
	const short = { path: "/w/shop-worktrees/GH-16", canonicalPath: "/w/shop-worktrees/GH-16" };
	const long = { path: "/w/shop-worktrees/GH-169", canonicalPath: "/real/GH-169" };
	const nested = { path: "/w/shop/.worktrees/inner", canonicalPath: null };
	const worktrees = [primary, short, long, nested];

	test("inside means on a whole path segment", () => {
		expect(isInside("/w/shop-worktrees/GH-169", "/w/shop-worktrees/GH-16")).toBe(false);
		expect(isInside("/w/shop-worktrees/GH-16/docker", "/w/shop-worktrees/GH-16")).toBe(true);
		expect(isInside("/w/shop-worktrees/GH-16/", "/w/shop-worktrees/GH-16")).toBe(true);
		expect(isInside("C:\\w\\shop\\sub", "C:\\w\\shop")).toBe(true);
		expect(isInside("/anything", "/")).toBe(true);
	});

	test("the deepest worktree holds it, by registered or canonical path", () => {
		expect(worktreeHolding("/w/shop/.worktrees/inner/compose", worktrees)).toBe(nested);
		expect(worktreeHolding("/w/shop/docker", worktrees)).toBe(primary);
		expect(worktreeHolding("/real/GH-169", worktrees)).toBe(long);
		expect(worktreeHolding("/elsewhere", worktrees)).toBeNull();
	});

	test("ports of another worktree's containers never show on this one", () => {
		const containers = parseComposeContainers(inspected);
		expect(dockerPortsOf(containers, long, worktrees)).toEqual([]);
		expect(dockerPortsOf(containers, short, worktrees).map(port => `${port.service} ${port.hostPort}->${port.containerPort}`)).toEqual([
			"web 4438->443", "minio 5353->53", "web 8008->80", "minio 9208->9001",
		]);
		expect(dockerPortsOf(containers, primary, worktrees)).toEqual([]);
	});
});

describe("ports claimed twice", () => {
	test("a port wanted by a container that could not start clashes with the one holding it", () => {
		const clashes = findClashes(dockerClaims(parseComposeContainers(inspected)));
		expect(clashes).toEqual([{ hostPort: 8008, protocol: "tcp", folders: ["/w/shop-worktrees/GH-16", "/w/shop-worktrees/GH-169"] }]);
	});

	test("one folder claiming a port twice, or on another protocol, is no clash", () => {
		expect(findClashes([
			{ hostPort: 3000, protocol: "tcp", folder: "/a" },
			{ hostPort: 3000, protocol: "tcp", folder: "/a/" },
			{ hostPort: 3000, protocol: "udp", folder: "/b" },
		])).toEqual([]);
	});

	test("both worktrees are marked, each with the other's name", () => {
		const worktrees = [
			{ path: "/w/a", canonicalPath: null, label: "feat/a" },
			{ path: "/w/b", canonicalPath: null, label: "feat/b" },
		];
		const marks = portClashMarks([
			{ hostPort: 5432, protocol: "tcp", folders: ["/w/a/compose", "/w/b"] },
			{ hostPort: 6000, protocol: "tcp", folders: ["/w/a", "/w/a/sub"] },
			{ hostPort: 7000, protocol: "tcp", folders: ["/w/a", "/srv/outside"] },
		], worktrees);
		expect(marks.get("/w/a")).toEqual([
			{ hostPort: 5432, protocol: "tcp", others: ["feat/b"] },
			{ hostPort: 7000, protocol: "tcp", others: ["outside"] },
		]);
		expect(marks.get("/w/b")).toEqual([{ hostPort: 5432, protocol: "tcp", others: ["feat/a"] }]);
	});
});

describe("the Linux socket table", () => {
	// From /proc/net/tcp and tcp6: a listener on 127.0.0.1:5173, one on [::]:3000, and a connection that is not listening.
	const tcp = [
		"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
		"   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41234 1 0000000000000000 100 0 0 10 0",
		"   1: 0100007F:A1B2 0100007F:1435 01 00000000:00000000 00:00000000 00000000  1000        0 41299 1 0000000000000000 20 4 30 10 -1",
	].join("\n");
	const tcp6 = [
		"  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
		"   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 52001 1 0000000000000000 100 0 0 10 0",
	].join("\n");

	test("only listening sockets, with their port and inode", () => {
		expect(parseSocketTable(tcp)).toEqual([{ inode: 41234, port: 5173 }]);
		expect(parseSocketTable(tcp6)).toEqual([{ inode: 52001, port: 3000 }]);
		expect(parseSocketTable("")).toEqual([]);
	});

	test("a descriptor link names a socket only in Linux's own form", () => {
		expect(socketInodeOf("socket:[41234]")).toBe(41234);
		expect(socketInodeOf("pipe:[41234]")).toBeNull();
		expect(socketInodeOf("/dev/pts/3")).toBeNull();
	});
});

test("the count is of different host ports", () => {
	expect(countPorts(
		{ state: "read", ports: [{ service: "a", container: "a", hostPort: 1, containerPort: 1, protocol: "tcp" }, { service: "b", container: "b", hostPort: 2, containerPort: 1, protocol: "tcp" }] },
		{ state: "read", ports: [{ session: "s", name: "T", hostPort: 2, protocol: "tcp" }, { session: "s", name: "T", hostPort: 3, protocol: "tcp" }] },
	)).toBe(3);
	expect(countPorts({ state: "unavailable", problem: "stopped", message: "" }, { state: "unknown", message: "" })).toBe(0);
});
