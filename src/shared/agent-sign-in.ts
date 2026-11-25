import { type AgentSetting, sameAgentSettings } from "./agent";
import type { AgentId, AgentSignInStatus } from "./agent-registry";

/**
 * Whether each saved agent is signed in, as its own status command says. Pure:
 * the main process runs the commands (src/bun/agent-sign-in.ts), and only the
 * state read here leaves it, never what a command printed.
 */

/** How long a status command may take, in milliseconds. */
export const SIGN_IN_MILLISECONDS = 5000;
/** How old an answer may be, in milliseconds, before a dialog that opens asks again. */
export const SIGN_IN_FRESH_MILLISECONDS = 60_000;

/** Why it is not known whether an agent is signed in. */
export type SignInUnknown =
	/** The registry has no status command for the agent. */
	| { reason: "no-command" }
	/** The row's executable is not named as the agent's own, such as a wrapper, so it is not run. */
	| { reason: "not-asked" }
	/** The command says signed out, but does not count `variable`, a key the app's environment has. */
	| { reason: "key-set"; variable: string }
	| { reason: "too-long" }
	| { reason: "not-started" }
	/** It ended, but not with an exit code and an answer that are known together. */
	| { reason: "unreadable" };

export type SignInState = { state: "signed-in" } | { state: "signed-out" } | ({ state: "not-known" } & SignInUnknown);

/** One saved row whose agent the registry knows and whose executable was found. */
export interface AgentSignIn {
	/** The row as saved when it was asked. */
	setting: AgentSetting;
	agent: AgentId;
	/** The command as one line for showing, or null when the registry has none for the agent. */
	shown: string | null;
	signIn: SignInState;
}

/** What a status command came to, in the main process only: its output can hold an email address. */
export interface SignInAnswer {
	exitCode: number | null;
	out: { text: string; truncated: boolean };
	err: { text: string; truncated: boolean };
}

function jsonRecord(text: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
	} catch {
		return null;
	}
}

/** Each kind of answer: true for signed in, false for signed out, null for anything else. */
const READERS: Record<AgentSignInStatus["answer"], (answer: SignInAnswer) => boolean | null> = {
	"claude-json": ({ exitCode, out }) => {
		const loggedIn = jsonRecord(out.text)?.loggedIn;
		if (exitCode === 0 && loggedIn === true) return true;
		return exitCode === 1 && loggedIn === false ? false : null;
	},
	// Codex also exits 1 when its settings cannot be read, so the line decides with the exit code. Warnings may come before it.
	"codex-text": ({ exitCode, err }) => {
		const lines = err.text.split("\n").map(line => line.trim());
		if (exitCode === 0 && lines.some(line => /^Logged in\b/.test(line))) return true;
		return exitCode === 1 && lines.includes("Not logged in") ? false : null;
	},
	// Cursor exits 0 either way.
	"cursor-json": ({ exitCode, out }) => {
		const answer = jsonRecord(out.text);
		if (exitCode !== 0 || answer === null) return null;
		if (answer.status === "authenticated" && answer.isAuthenticated === true) return true;
		return answer.status === "unauthenticated" && answer.isAuthenticated === false ? false : null;
	},
};

/**
 * Whether an answer says signed in or signed out. Only when its exit code
 * and what it printed both say so; anything else is not known. A signed out
 * answer is not known either while `environment` has a key the command does
 * not count; only whether it is set is looked at.
 */
export function readSignIn(status: AgentSignInStatus, answer: SignInAnswer, environment: Record<string, string | undefined>): SignInState {
	if (answer.out.truncated || answer.err.truncated) return { state: "not-known", reason: "unreadable" };
	const signedIn = READERS[status.answer](answer);
	if (signedIn === null) return { state: "not-known", reason: "unreadable" };
	if (signedIn) return { state: "signed-in" };
	const variable = status.keysNotCounted.find(key => (environment[key] ?? "") !== "");
	return variable === undefined ? { state: "signed-out" } : { state: "not-known", reason: "key-set", variable };
}

/** What was answered for a row exactly as it was saved then, or null. */
export function signInOf(signIns: readonly AgentSignIn[] | null, setting: AgentSetting): AgentSignIn | null {
	return signIns?.find(answer => sameAgentSettings([answer.setting], [setting])) ?? null;
}

/** Whether a row's agent is known to be signed out. */
export function isSignedOut(signIns: readonly AgentSignIn[] | null, setting: AgentSetting): boolean {
	return signInOf(signIns, setting)?.signIn.state === "signed-out";
}
