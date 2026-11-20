import type { Repository } from "../shared/model";
import { type NamedWorktree, type PortClash, type PortProtocol, type PortsResult, countPorts, portClashMarks } from "../shared/ports";
import { worktreeLabel } from "./format";

export type PortClashMark = { hostPort: number; protocol: PortProtocol; others: string[] };

/** What the header item says, and its tooltip. Null before the first read, so nothing shows yet. */
export function describePortsItem(result: PortsResult | undefined): { text: string; tooltip: string } | null {
	if (result === undefined || result.outcome === "hidden") return null;
	if (result.outcome === "not-listed") return { text: "ports unknown", tooltip: result.message };
	const count = countPorts(result.docker, result.sessions);
	const text = count === 0 ? "no ports" : count === 1 ? "1 port" : `${count} ports`;
	const notes = [
		result.docker.state === "unavailable" ? result.docker.message : null,
		result.sessions.state === "unknown" ? result.sessions.message : null,
	].filter((note): note is string => note !== null);
	const said = count === 0 ? "No ports are open in this worktree." : `${text.charAt(0).toUpperCase()}${text.slice(1)} open in this worktree. Show them.`;
	return { text, tooltip: [said, ...notes].join(" ") };
}

/** One line of the list: what holds the port, the port, and the other worktrees that claim it too. */
export interface PortLine {
	key: string;
	/** The Compose service or the session's name. */
	owner: string;
	/** `8080 -> 80` for a container, `5173` for a session. */
	port: string;
	hostPort: number;
	/** Other worktrees that claim the same host port, by name. Empty when none does. */
	alsoClaimedBy: string[];
}

export interface PortGroup {
	title: "Docker" | "Sessions";
	lines: PortLine[];
}

/** The list's groups, Docker first. A source that could not be read, or has no ports, has no group. */
export function portGroups(result: PortsResult | undefined, clashes: readonly PortClashMark[]): PortGroup[] {
	if (result === undefined || result.outcome !== "read") return [];
	const others = (hostPort: number, protocol: PortProtocol) => clashes.find(mark => mark.hostPort === hostPort && mark.protocol === protocol)?.others ?? [];
	const groups: PortGroup[] = [];
	if (result.docker.state === "read" && result.docker.ports.length > 0) {
		groups.push({
			title: "Docker",
			lines: result.docker.ports.map(port => ({
				key: `docker ${port.container} ${port.hostPort}/${port.protocol} ${port.containerPort}`,
				owner: port.service,
				port: `${port.hostPort} -> ${port.containerPort}${port.protocol === "udp" ? "/udp" : ""}`,
				hostPort: port.hostPort,
				alsoClaimedBy: others(port.hostPort, port.protocol),
			})),
		});
	}
	if (result.sessions.state === "read" && result.sessions.ports.length > 0) {
		groups.push({
			title: "Sessions",
			lines: result.sessions.ports.map(port => ({
				key: `session ${port.session} ${port.hostPort}`,
				owner: port.name,
				port: String(port.hostPort),
				hostPort: port.hostPort,
				alsoClaimedBy: others(port.hostPort, port.protocol),
			})),
		});
	}
	return groups;
}

/** The marks of every worktree in a clash, by its registered path, named as the sidebar names them. */
export function clashMarksOf(clashes: readonly PortClash[], repositories: readonly Repository[]): Map<string, PortClashMark[]> {
	if (clashes.length === 0) return new Map();
	const worktrees: NamedWorktree[] = repositories.flatMap(repository => repository.worktrees.map(worktree => ({ path: worktree.path, canonicalPath: worktree.canonicalPath, label: worktreeLabel(worktree) })));
	return portClashMarks(clashes, worktrees);
}

/** The sentence of a row's warning: which ports it shares, and with whom. Null when it shares none. */
export function describePortClash(marks: readonly PortClashMark[] | undefined): string | null {
	if (!marks || marks.length === 0) return null;
	const parts = marks.map(mark => `${mark.hostPort} with ${mark.others.join(" and ")}`);
	return `${marks.length === 1 ? "Port" : "Ports"} also claimed elsewhere: ${parts.join("; ")}.`;
}
