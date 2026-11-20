import {
	type ComposeContainer, type DockerProblem, type DockerRead, type PlacedWorktree, type PortClaim, type PortsResult,
	describeDockerProblem, dockerClaims, dockerPortsOf, findClashes,
} from "../../shared/ports";

const lookup = "/work/timber-worktrees/feat-github-issue-lookup";
const spike = "/work/timber-worktrees/spike-new-idea";

const container = (workingDir: string, service: string, ports: [host: number, inside: number][], running = true): ComposeContainer => {
	const bindings = ports.map(([hostPort, containerPort]) => ({ hostPort, containerPort, protocol: "tcp" as const }));
	return { name: `${workingDir.split("/").pop()}-${service}-1`, state: running ? "running" : "created", workingDir, service, published: running ? bindings : [], wanted: bindings };
};

/**
 * The pretend Compose projects of the browser build: one worktree runs six
 * published ports, and another made a database that could not start because
 * the first one holds its port, so both are marked.
 */
export const sampleContainers: readonly ComposeContainer[] = [
	container(lookup, "web", [[8080, 80], [8443, 443]]),
	container(lookup, "api", [[3000, 3000]]),
	container(lookup, "database", [[5432, 5432]]),
	container(lookup, "redis", [[6379, 6379]]),
	container(lookup, "mailpit", [[8025, 8025]]),
	container(spike, "database", [[5432, 5432]], false),
];

/** Ports the pretend sessions listen on, by worktree path. */
export const sampleSessionPorts: Readonly<Record<string, readonly { name: string; hostPort: number }[]>> = {
	[lookup]: [{ name: "Terminal", hostPort: 5173 }],
};

export interface PortControls {
	/** Decide what Docker answers from now on: its containers, or a problem. */
	setDocker(answer: readonly ComposeContainer[] | DockerProblem): void;
	/** Decide the ports one worktree's sessions listen on, by its path. */
	setSessionPorts(worktree: string, ports: readonly { name: string; hostPort: number }[]): void;
	/** How many times ports were read. A hidden window reads nothing, so it does not count. */
	portReads(): number;
}

/** The mock's answer for a listed worktree, worked out by the same rules as the desktop app. */
export function createMockPorts() {
	let docker: readonly ComposeContainer[] | DockerProblem = sampleContainers;
	const sessions = new Map<string, readonly { name: string; hostPort: number }[]>(Object.entries(sampleSessionPorts));
	let reads = 0;
	return {
		read(worktree: PlacedWorktree, worktrees: readonly PlacedWorktree[]): PortsResult {
			reads += 1;
			const containers = typeof docker === "string" ? [] : docker;
			const dockerRead: DockerRead = typeof docker === "string"
				? { state: "unavailable", problem: docker, message: describeDockerProblem(docker, "") }
				: { state: "read", ports: dockerPortsOf(containers, worktree, worktrees) };
			const own = sessions.get(worktree.path) ?? [];
			const claims: PortClaim[] = [
				...dockerClaims(containers),
				...[...sessions].flatMap(([folder, ports]) => ports.map(port => ({ hostPort: port.hostPort, protocol: "tcp" as const, folder }))),
			];
			return {
				outcome: "read",
				docker: dockerRead,
				sessions: { state: "read", ports: own.map((port, index) => ({ session: `mock-${index}`, name: port.name, hostPort: port.hostPort, protocol: "tcp" })) },
				clashes: findClashes(claims),
			};
		},
		controls: {
			setDocker(answer) {
				docker = typeof answer === "string" ? answer : structuredClone(answer);
			},
			setSessionPorts(worktree, ports) {
				sessions.set(worktree, structuredClone(ports));
			},
			portReads: () => reads,
		} satisfies PortControls,
	};
}
