import { readFileSync, readdirSync } from "node:fs";

/**
 * Everything a terminal's shell started belongs to the shell's session,
 * because the shell leads it (its session id is its own process id). Jobs
 * run in process groups of their own, so ending the shell's group is not
 * enough. Only a program that starts a session of its own, as a daemon does
 * on purpose, leaves it.
 */

/** The session id in the text of `/proc/<pid>/stat`, or null when it cannot be read. */
export function sessionOfStat(stat: string): number | null {
	// The name in parentheses can hold spaces and parentheses itself, so read from the last one.
	const end = stat.lastIndexOf(")");
	if (end < 0) return null;
	const fields = stat.slice(end + 1).trim().split(/\s+/);
	// state, parent, process group, session
	const session = Number(fields[3]);
	return Number.isInteger(session) && session > 0 ? session : null;
}

/**
 * The processes in session `session`, on Linux. Null where /proc cannot be
 * read, such as on macOS, so a caller can tell "none" from "cannot know".
 */
export function sessionMembers(session: number, proc = "/proc"): number[] | null {
	let entries: string[];
	try {
		entries = readdirSync(proc);
	} catch {
		return null;
	}
	const members: number[] = [];
	for (const entry of entries) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			if (sessionOfStat(readFileSync(`${proc}/${entry}/stat`, "utf8")) === session) members.push(Number(entry));
		} catch {
			// The process ended meanwhile.
		}
	}
	return members;
}

/** Send `signal` to each process. One that is gone already is skipped. */
export function signalEach(pids: readonly number[], signal: NodeJS.Signals): void {
	for (const pid of pids) {
		try {
			process.kill(pid, signal);
		} catch {
			// Gone already.
		}
	}
}

/** Send `signal` to a process group, for where the members of a session cannot be listed. */
export function signalGroup(leader: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-leader, signal);
	} catch {
		// No such group.
	}
}
