import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { type ListeningSocket, parseSocketTable, socketInodeOf } from "../shared/ports";
import { sessionOfStat } from "./process-session";

/** A process that leads a terminal's process session, as `TerminalSessions.leaders` gives it. */
export interface Leader {
	id: string;
	pid: number;
}

/**
 * The TCP ports each session's processes listen on, read from the Linux
 * process table: which processes are in each session (`/proc/<pid>/stat`),
 * which sockets they hold (`/proc/<pid>/fd`), and which of those listen
 * (`/proc/net/tcp` and `tcp6`). Only the person's own processes can be read,
 * which is all a session holds. Read-only.
 *
 * Null where the table cannot be read, such as on macOS and Windows, so a
 * caller can tell "none" from "cannot know".
 */
export function sessionListeningPorts(leaders: readonly Leader[], proc = "/proc"): Map<string, number[]> | null {
	let entries: string[];
	try {
		entries = readdirSync(proc);
	} catch {
		return null;
	}
	const listening = listeningSockets(proc);
	if (listening === null) return null;
	const ports = new Map<string, number[]>(leaders.map(leader => [leader.id, []]));
	if (leaders.length === 0 || listening.size === 0) return ports;

	const bySession = new Map<number, string>(leaders.map(leader => [leader.pid, leader.id]));
	const found = new Map<string, Set<number>>();
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		let session: number | null;
		try {
			session = sessionOfStat(readFileSync(`${proc}/${entry}/stat`, "utf8"));
		} catch {
			continue; // Ended meanwhile.
		}
		const id = session === null ? undefined : bySession.get(session);
		if (id === undefined) continue;
		for (const port of portsHeldBy(`${proc}/${entry}/fd`, listening)) {
			const set = found.get(id) ?? new Set<number>();
			set.add(port);
			found.set(id, set);
		}
	}
	for (const [id, set] of found) ports.set(id, [...set].sort((a, b) => a - b));
	return ports;
}

/** Listening sockets by inode, from IPv4 and IPv6 tables. Null when neither can be read. */
function listeningSockets(proc: string): Map<number, number> | null {
	const sockets: ListeningSocket[] = [];
	let read = false;
	for (const table of ["tcp", "tcp6"]) {
		try {
			sockets.push(...parseSocketTable(readFileSync(`${proc}/net/${table}`, "utf8")));
			read = true;
		} catch {
			// IPv6 can be off.
		}
	}
	return read ? new Map(sockets.map(socket => [socket.inode, socket.port])) : null;
}

function portsHeldBy(fdFolder: string, listening: Map<number, number>): number[] {
	let fds: string[];
	try {
		fds = readdirSync(fdFolder);
	} catch {
		return []; // Not ours to read, or ended meanwhile.
	}
	const ports: number[] = [];
	for (const fd of fds) {
		let link: string;
		try {
			link = readlinkSync(`${fdFolder}/${fd}`);
		} catch {
			continue;
		}
		const inode = socketInodeOf(link);
		const port = inode === null ? undefined : listening.get(inode);
		if (port !== undefined) ports.push(port);
	}
	return ports;
}
