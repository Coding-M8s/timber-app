/**
 * The ports a worktree has open: what its Compose project's containers
 * publish, and what the processes of its sessions listen on. The types of
 * `Engine.readPorts`, and the pure parsers and rules behind it.
 *
 * Everything here only reads. Docker is asked with `docker ps` and `docker
 * inspect`, and sessions are looked up in the Linux process table.
 */

export interface PortsRequest {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
}

export type PortProtocol = "tcp" | "udp";

/** A port a running container of the worktree's Compose project publishes. */
export interface DockerPort {
	/** The Compose service, such as `web`. */
	service: string;
	/** The container's name, without Docker's leading slash. */
	container: string;
	hostPort: number;
	containerPort: number;
	protocol: PortProtocol;
}

/** A port a process in one of the worktree's sessions listens on. */
export interface SessionPort {
	/** The session's id (`TerminalSession.id`). */
	session: string;
	/** The session's name as its chip shows it. */
	name: string;
	hostPort: number;
	protocol: PortProtocol;
}

export type DockerProblem = "no-docker" | "stopped" | "denied" | "failed";

export type DockerRead =
	| { state: "read"; ports: DockerPort[] }
	| { state: "unavailable"; problem: DockerProblem; message: string };

export type SessionPortsRead =
	| { state: "read"; ports: SessionPort[] }
	/** The process table cannot be read here, such as on macOS and Windows. */
	| { state: "unknown"; message: string };

/**
 * One host port claimed by more than one folder. A folder is a worktree's
 * registered path for a session, or a Compose project's working directory
 * for a container, so two folders can still be one worktree. The interface
 * decides that (`portClashMarks`).
 */
export interface PortClash {
	hostPort: number;
	protocol: PortProtocol;
	folders: string[];
}

export type PortsResult =
	| { outcome: "read"; docker: DockerRead; sessions: SessionPortsRead; clashes: PortClash[] }
	| { outcome: "not-listed"; message: string }
	/** The window is hidden, so nothing was read. */
	| { outcome: "hidden" };

/** The same worktree is read at most once in this long; a request sooner gets the last answer. */
export const PORTS_GAP_MILLISECONDS = 5000;

/** Docker is stopped after this long, so a stuck daemon cannot hold the read. */
export const DOCKER_MILLISECONDS = 5000;

export const COMPOSE_WORKING_DIR = "com.docker.compose.project.working_dir";
export const COMPOSE_SERVICE = "com.docker.compose.service";

/** `docker ps`: the ids of every container of a Compose project, running or not. */
export const DOCKER_PS_ARGUMENTS: readonly string[] = ["ps", "--all", "--no-trunc", "--filter", `label=${COMPOSE_WORKING_DIR}`, "--format", "{{.ID}}"];

/**
 * `docker inspect` writes one JSON object per container with only what is
 * needed here. Never the whole record: it holds the container's environment,
 * which often has secrets.
 */
export const DOCKER_INSPECT_FORMAT = `{"name":{{json .Name}},"state":{{json .State.Status}},"workingDir":{{json (index .Config.Labels "${COMPOSE_WORKING_DIR}")}},"service":{{json (index .Config.Labels "${COMPOSE_SERVICE}")}},"ports":{{json .NetworkSettings.Ports}},"bindings":{{json .HostConfig.PortBindings}}}`;

export function dockerInspectArguments(ids: readonly string[]): string[] {
	return ["inspect", "--type", "container", "--format", DOCKER_INSPECT_FORMAT, ...ids];
}

/** The container ids `docker ps` printed, one a line. */
export function parseContainerIds(output: string): string[] {
	return output.split(/\r?\n/).map(line => line.trim()).filter(line => /^[0-9a-f]{12,64}$/.test(line));
}

/** A published or wanted host port of a container. */
interface Binding {
	hostPort: number;
	containerPort: number;
	protocol: PortProtocol;
}

export interface ComposeContainer {
	name: string;
	/** Docker's word, such as `running`, `created`, or `exited`. */
	state: string;
	workingDir: string;
	service: string;
	/** What the running container publishes now. Empty unless it runs. */
	published: Binding[];
	/** What the container asks for, running or not. A port Docker picks (`HostPort` empty) is left out. */
	wanted: Binding[];
}

function bindingsOf(value: unknown): Binding[] {
	if (value === null || typeof value !== "object") return [];
	const found = new Map<string, Binding>();
	for (const [key, hosts] of Object.entries(value as Record<string, unknown>)) {
		const match = /^(\d+)\/(tcp|udp)$/.exec(key);
		// "9000/tcp": null is a port the container exposes without publishing it.
		if (!match || !Array.isArray(hosts)) continue;
		const containerPort = Number(match[1]);
		const protocol = match[2] as PortProtocol;
		for (const host of hosts) {
			const text = host !== null && typeof host === "object" ? (host as { HostPort?: unknown }).HostPort : undefined;
			const hostPort = typeof text === "string" && /^\d+$/.test(text) ? Number(text) : NaN;
			if (!validPort(hostPort)) continue;
			// IPv4 and IPv6 bindings of one port are one port.
			found.set(`${hostPort}/${protocol}/${containerPort}`, { hostPort, containerPort, protocol });
		}
	}
	return [...found.values()].sort((a, b) => a.hostPort - b.hostPort || a.containerPort - b.containerPort);
}

const validPort = (port: number) => Number.isInteger(port) && port > 0 && port < 65536;

/**
 * The containers in `docker inspect` output written with
 * `DOCKER_INSPECT_FORMAT`. A line that is not such an object, or a container
 * with no working directory label, is skipped.
 */
export function parseComposeContainers(output: string): ComposeContainer[] {
	const containers: ComposeContainer[] = [];
	for (const line of output.split(/\r?\n/)) {
		if (line.trim() === "") continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record === null || typeof record !== "object") continue;
		const { name, state, workingDir, service, ports, bindings } = record as Record<string, unknown>;
		if (typeof workingDir !== "string" || workingDir === "") continue;
		const running = state === "running";
		containers.push({
			name: typeof name === "string" ? name.replace(/^\//, "") : "",
			state: typeof state === "string" ? state : "unknown",
			workingDir,
			service: typeof service === "string" && service !== "" ? service : typeof name === "string" ? name.replace(/^\//, "") : "container",
			published: running ? bindingsOf(ports) : [],
			wanted: bindingsOf(bindings),
		});
	}
	return containers;
}

/** Why Docker could not be asked, from what the `docker` command wrote on standard error. Wording follows Docker 29. */
export function dockerProblemOf(stderr: string): DockerProblem {
	const text = stderr.toLowerCase();
	if (text.includes("permission denied")) return "denied";
	if (text.includes("cannot connect to the docker daemon") || text.includes("is the daemon running") || text.includes("connection refused") || text.includes("no such file or directory")) return "stopped";
	return "failed";
}

const PROBLEM_WORDS: Record<DockerProblem, string> = {
	"no-docker": "Docker is not installed here, or not on the PATH.",
	stopped: "Docker is not running.",
	denied: "No permission to use Docker. Its socket is usually open only to the docker group.",
	failed: "Docker could not list its containers.",
};

/** The sentence for a Docker that could not be read, with what Docker said after it when it said anything. */
export function describeDockerProblem(problem: DockerProblem, said: string): string {
	const detail = said.trim().split(/\r?\n/)[0]?.trim() ?? "";
	return detail === "" ? PROBLEM_WORDS[problem] : `${PROBLEM_WORDS[problem]} Docker said: ${detail}`;
}

/** A path without separators at its end. Both kinds count, since Windows paths may use either. */
function trimEnd(path: string): string {
	return path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
}

/** Whether `path` is `folder` or inside it, on a whole path segment, so `/w/GH-16` does not hold `/w/GH-169`. */
export function isInside(path: string, folder: string): boolean {
	const inner = trimEnd(path);
	const outer = trimEnd(folder);
	if (inner === outer) return true;
	if (!inner.startsWith(outer)) return false;
	const next = inner.charAt(outer.length);
	return next === "/" || next === "\\" || outer.endsWith("/") || outer.endsWith("\\");
}

export interface PlacedWorktree {
	path: string;
	canonicalPath: string | null;
}

/**
 * The worktree that holds `folder`: the deepest of `worktrees` it is inside,
 * by registered or canonical path, so a worktree inside another one keeps
 * its own containers. Null when none holds it.
 */
export function worktreeHolding<T extends PlacedWorktree>(folder: string, worktrees: readonly T[]): T | null {
	let best: T | null = null;
	let depth = -1;
	for (const worktree of worktrees) {
		for (const path of [worktree.path, worktree.canonicalPath]) {
			if (path === null || !isInside(folder, path)) continue;
			const length = trimEnd(path).length;
			if (length > depth) {
				best = worktree;
				depth = length;
			}
		}
	}
	return best;
}

/** The ports this worktree's running containers publish, by service and port. */
export function dockerPortsOf(containers: readonly ComposeContainer[], worktree: PlacedWorktree, worktrees: readonly PlacedWorktree[]): DockerPort[] {
	const ports: DockerPort[] = [];
	for (const container of containers) {
		if (worktreeHolding(container.workingDir, worktrees)?.path !== worktree.path) continue;
		for (const binding of container.published) ports.push({ service: container.service, container: container.name, ...binding });
	}
	return ports.sort((a, b) => a.hostPort - b.hostPort || a.service.localeCompare(b.service));
}

/** A host port someone holds or wants, and the folder it belongs to. */
export interface PortClaim {
	hostPort: number;
	protocol: PortProtocol;
	folder: string;
}

/**
 * Every container's claims: what a running one publishes, and what any one
 * asks for, so a project that could not start because another one holds its
 * port still counts.
 */
export function dockerClaims(containers: readonly ComposeContainer[]): PortClaim[] {
	return containers.flatMap(container => [...container.published, ...container.wanted].map(binding => ({ hostPort: binding.hostPort, protocol: binding.protocol, folder: container.workingDir })));
}

/** Host ports claimed from more than one folder, in port order. A folder claiming a port twice is one claim. */
export function findClashes(claims: readonly PortClaim[]): PortClash[] {
	const byPort = new Map<string, { hostPort: number; protocol: PortProtocol; folders: Set<string> }>();
	for (const claim of claims) {
		const key = `${claim.hostPort}/${claim.protocol}`;
		const entry = byPort.get(key) ?? { hostPort: claim.hostPort, protocol: claim.protocol, folders: new Set<string>() };
		entry.folders.add(trimEnd(claim.folder));
		byPort.set(key, entry);
	}
	return [...byPort.values()]
		.filter(entry => entry.folders.size > 1)
		.map(entry => ({ hostPort: entry.hostPort, protocol: entry.protocol, folders: [...entry.folders].sort() }))
		.sort((a, b) => a.hostPort - b.hostPort || a.protocol.localeCompare(b.protocol));
}

/** A listening socket from the Linux socket table. */
export interface ListeningSocket {
	inode: number;
	port: number;
}

const LISTEN = "0A";

/**
 * The listening sockets in the text of `/proc/net/tcp` or `/proc/net/tcp6`:
 * the local port, from the hex `address:port`, and the socket's inode.
 */
export function parseSocketTable(text: string): ListeningSocket[] {
	const sockets: ListeningSocket[] = [];
	for (const line of text.split("\n").slice(1)) {
		const fields = line.trim().split(/\s+/);
		// sl local rem st tx:rx tr:when retrnsmt uid timeout inode
		if (fields.length < 10 || fields[3] !== LISTEN) continue;
		const port = parseInt(fields[1]!.split(":")[1] ?? "", 16);
		const inode = Number(fields[9]);
		if (validPort(port) && Number.isInteger(inode) && inode > 0) sockets.push({ inode, port });
	}
	return sockets;
}

/** The socket inode a `/proc/<pid>/fd/<n>` link names, such as `socket:[12345]`, or null for anything else. */
export function socketInodeOf(link: string): number | null {
	const match = /^socket:\[(\d+)\]$/.exec(link);
	return match ? Number(match[1]) : null;
}

/** A worktree as the interface knows it, for naming the other side of a clash. */
export interface NamedWorktree extends PlacedWorktree {
	label: string;
}

/**
 * For each worktree in a clash, the ports it shares and the names of the
 * others that claim them. A folder in no known worktree is named by its last
 * segment. A clash whose folders all fall in one worktree is no clash.
 */
export function portClashMarks(clashes: readonly PortClash[], worktrees: readonly NamedWorktree[]): Map<string, { hostPort: number; protocol: PortProtocol; others: string[] }[]> {
	const marks = new Map<string, { hostPort: number; protocol: PortProtocol; others: string[] }[]>();
	for (const clash of clashes) {
		const owners = new Map<string, string>();
		for (const folder of clash.folders) {
			const holder = worktreeHolding(folder, worktrees);
			const key = holder?.path ?? folder;
			owners.set(key, holder?.label ?? lastSegment(folder));
		}
		if (owners.size < 2) continue;
		for (const [path] of owners) {
			const others = [...owners].filter(([other]) => other !== path).map(([, label]) => label);
			const list = marks.get(path) ?? [];
			list.push({ hostPort: clash.hostPort, protocol: clash.protocol, others });
			marks.set(path, list);
		}
	}
	return marks;
}

function lastSegment(path: string): string {
	const parts = trimEnd(path).split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/** How many different host ports a read lists for the worktree. */
export function countPorts(docker: DockerRead, sessions: SessionPortsRead): number {
	const ports = new Set<string>();
	if (docker.state === "read") for (const port of docker.ports) ports.add(`${port.hostPort}/${port.protocol}`);
	if (sessions.state === "read") for (const port of sessions.ports) ports.add(`${port.hostPort}/${port.protocol}`);
	return ports.size;
}

/** The address "Open in browser" opens and "Copy" copies. */
export function portAddress(hostPort: number): string {
	return `http://localhost:${hostPort}`;
}
