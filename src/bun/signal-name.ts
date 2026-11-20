import { constants } from "node:os";

/** Bun gives the signal that stopped a process by name, or by number when it has none to hand. Either way, return a name to show. */
export function signalName(code: NodeJS.Signals | number | null): string | null {
	if (code === null || typeof code === "string") return code;
	const named = Object.entries(constants.signals).find(([, value]) => value === code);
	return named ? named[0] : `signal ${code}`;
}
