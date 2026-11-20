import type { Attention } from "../shared/attention";
import { messageOf } from "../shared/error-message";
import type { Repository } from "../shared/model";
import {
	DOCKER_MILLISECONDS, DOCKER_PS_ARGUMENTS, PORTS_GAP_MILLISECONDS,
	type ComposeContainer, type DockerRead, type PortClaim, type PortsRequest, type PortsResult, type SessionPortsRead,
	describeDockerProblem, dockerClaims, dockerInspectArguments, dockerPortsOf, dockerProblemOf, findClashes, parseComposeContainers, parseContainerIds,
} from "../shared/ports";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { sessionListeningPorts } from "./session-ports";
import type { SessionLeader } from "./terminals";

/** Docker's output is read up to this many bytes. Thousands of containers fit. */
const DOCKER_OUTPUT_BYTES = 4 * 1024 * 1024;

const NOT_READ = "No ports were read.";

export interface PortsDependencies {
	findRepository: FindRepository;
	/** The running sessions, with the process that leads each one's processes. */
	leaders: () => SessionLeader[];
	/** How the window is: nothing is read while it is hidden. */
	attention: () => Attention;
	/** The Docker executable, or null when there is none. Found on the PATH by default. */
	docker?: () => string | null;
	/** Where the process table is. Tests point it elsewhere. */
	proc?: string;
	platform?: NodeJS.Platform;
	now?: () => number;
	timeoutMilliseconds?: number;
}

export interface Ports {
	read(request: PortsRequest): Promise<PortsResult>;
}

type Run = { ok: true; stdout: string } | { ok: false; started: boolean; stdout: string; stderr: string; message: string };

async function runDocker(docker: string, args: readonly string[], timeoutMs: number): Promise<Run> {
	let child: ReturnType<typeof Bun.spawn>;
	try {
		// An executable plus arguments, never a shell. Nothing typed by anyone reaches the arguments but container ids Docker printed.
		child = Bun.spawn([docker, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs, killSignal: "SIGKILL" });
	} catch (error) {
		return { ok: false, started: false, stdout: "", stderr: "", message: messageOf(error) };
	}
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout as ReadableStream).text(),
		new Response(child.stderr as ReadableStream).text(),
		child.exited,
	]);
	if (child.signalCode !== null && child.signalCode !== undefined) return { ok: false, started: true, stdout: "", stderr: "", message: `Docker did not answer within ${timeoutMs / 1000} seconds.` };
	if (stdout.length > DOCKER_OUTPUT_BYTES) return { ok: false, started: true, stdout: "", stderr: "", message: "Docker listed more than can be read." };
	if (exitCode !== 0) return { ok: false, started: true, stdout, stderr, message: stderr.trim() || `Docker ended with exit code ${exitCode}.` };
	return { ok: true, stdout };
}

/**
 * The ports of a worktree: what its Compose project's running containers
 * publish, and what its sessions' processes listen on, with every host port
 * that more than one folder claims.
 *
 * - Only a worktree Timber lists, in a repository in the app's list, with its
 *   folder there (`findListedWorktree`), as the Changes tab.
 * - Read-only: `docker ps --all` and `docker inspect` with a format that
 *   leaves out each container's environment, and the Linux process table.
 * - Nothing is read while the window is hidden, and the same worktree at
 *   most once in `PORTS_GAP_MILLISECONDS`: a request sooner gets the last
 *   answer, and requests while a read runs share it. There is no timer here.
 * - A container belongs to the deepest worktree of the repository its
 *   Compose working directory is inside, so a worktree inside another keeps
 *   its own.
 * - Docker that is missing, stopped, or not permitted is a quiet reason,
 *   with the other half still read.
 */
export function createPorts(dependencies: PortsDependencies): Ports {
	const {
		findRepository, leaders, attention, proc = "/proc", platform = process.platform, now = Date.now,
		docker = () => Bun.which("docker"), timeoutMilliseconds = DOCKER_MILLISECONDS,
	} = dependencies;
	const recent = new Map<string, { at: number; result: PortsResult }>();
	const running = new Map<string, Promise<PortsResult>>();

	async function readDocker(): Promise<{ read: DockerRead; containers: ComposeContainer[] }> {
		const executable = docker();
		const unavailable = (problem: "no-docker" | "stopped" | "denied" | "failed", said: string) => ({ read: { state: "unavailable" as const, problem, message: describeDockerProblem(problem, said) }, containers: [] });
		if (executable === null) return unavailable("no-docker", "");
		const listed = await runDocker(executable, DOCKER_PS_ARGUMENTS, timeoutMilliseconds);
		if (!listed.ok) return unavailable(listed.started ? dockerProblemOf(listed.stderr) : "no-docker", listed.message);
		const ids = parseContainerIds(listed.stdout);
		if (ids.length === 0) return { read: { state: "read", ports: [] }, containers: [] };
		const inspected = await runDocker(executable, dockerInspectArguments(ids), timeoutMilliseconds);
		// A container removed between the two calls fails inspect for that one only, and the others are still printed.
		if (!inspected.ok && inspected.stdout.trim() === "") return unavailable(inspected.started ? dockerProblemOf(inspected.stderr) : "no-docker", inspected.message);
		return { read: { state: "read", ports: [] }, containers: parseComposeContainers(inspected.stdout) };
	}

	async function readNow(request: PortsRequest): Promise<PortsResult> {
		// The repository is read once, for the check and for the worktrees a container may belong to.
		let repository: Repository | null = null;
		const find: FindRepository = async path => (repository = await findRepository(path));
		const listed = await findListedWorktree(find, request.repository, request.worktree, NOT_READ);
		if (!listed.ok) return { outcome: "not-listed", message: listed.message };
		const worktrees = (repository as Repository | null)?.worktrees ?? [listed.worktree];

		const [{ read: dockerRead, containers }, sessions] = await Promise.all([readDocker(), Promise.resolve(readSessions())]);
		const docker: DockerRead = dockerRead.state === "read" ? { state: "read", ports: dockerPortsOf(containers, listed.worktree, worktrees) } : dockerRead;

		const claims: PortClaim[] = [...dockerClaims(containers), ...sessions.claims];
		const own: SessionPortsRead = sessions.read.state === "read"
			? { state: "read", ports: sessions.read.ports.filter(port => sessions.paths.get(port.session) === listed.worktree.path) }
			: sessions.read;
		return { outcome: "read", docker, sessions: own, clashes: findClashes(claims) };
	}

	function readSessions(): { read: SessionPortsRead; claims: PortClaim[]; paths: Map<string, string> } {
		const all = leaders();
		const paths = new Map(all.map(leader => [leader.id, leader.path]));
		if (platform !== "linux") return { read: { state: "unknown", message: "Ports of sessions are read on Linux only." }, claims: [], paths };
		const found = sessionListeningPorts(all, proc);
		if (found === null) return { read: { state: "unknown", message: "The process table could not be read." }, claims: [], paths };
		const ports = all.flatMap(leader => (found.get(leader.id) ?? []).map(hostPort => ({ session: leader.id, name: leader.name, hostPort, protocol: "tcp" as const })));
		const claims = all.flatMap(leader => (found.get(leader.id) ?? []).map(hostPort => ({ hostPort, protocol: "tcp" as const, folder: leader.path })));
		return { read: { state: "read", ports }, claims, paths };
	}

	return {
		read(request) {
			if (!attention().visible) return Promise.resolve({ outcome: "hidden" });
			const key = `${request.repository}\u0000${request.worktree}`;
			const last = recent.get(key);
			if (last && now() - last.at < PORTS_GAP_MILLISECONDS) return Promise.resolve(last.result);
			const pending = running.get(key);
			if (pending) return pending;
			const at = now();
			for (const [other, kept] of recent) if (at - kept.at >= PORTS_GAP_MILLISECONDS) recent.delete(other);
			const read = readNow(request)
				.then(result => {
					recent.set(key, { at, result });
					return result;
				})
				.finally(() => running.delete(key));
			running.set(key, read);
			return read;
		},
	};
}
