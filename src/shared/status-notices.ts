/**
 * When a session's status calls for a desktop notification or a sound, and
 * what the notification says. The main process decides, since it hears every
 * session even while the window is hidden, and knows from `attend` what is on
 * screen. The mock engine decides with the same code. The policy is pure: the
 * clock is passed in.
 */
import type { Attention } from "./attention";
import type { ChildStatus } from "./program-status";
import { type ShownStatus, alertStatus, childName, describeShownStatus, hasStatusMark, shortMessage, shownChildStatus } from "./session-status";
import type { SoundChoice, StateSounds } from "./sound-setting";
import type { TerminalChange, TerminalSession } from "./terminal";

/**
 * The least time between two alerts of one session for the same status, as
 * the spec asks to rate limit notifications and sounds. A different status,
 * such as Needs you right after Done, is never held back. One inside the
 * interval waits and goes out when it ends, if its status still holds.
 */
export const NOTICE_INTERVAL_MILLISECONDS = 10_000;

/** The statuses that call for the person, in the order Settings lists them. */
export const ALERT_STATES = ["needs-you", "done", "error", "crashed"] as const;
export type AlertState = typeof ALERT_STATES[number];

/** What the person chose in Settings, Notifications. */
export interface AlertSettings {
	/** The main switch for desktop notifications. */
	notify: boolean;
	/** The statuses that get a desktop notification while `notify` is on. */
	notifyStates: readonly AlertState[];
	/** The sound each status plays, or null for none. */
	sounds: StateSounds;
}

/** A desktop notification to show for a session. */
export interface StatusNotice {
	/** The session it is for, to select its worktree and show it on a click. */
	session: string;
	/** Such as "Codex needs you". */
	title: string;
	/** Such as "In feature-login: approve Write: src/a.ts". */
	body: string;
}

/**
 * What to do now. A notice replaces the session's earlier one, so a session
 * has at most one on screen. `sound`, the sound chosen for that status, plays
 * with it, or alone when only the sound is chosen; null plays nothing.
 */
export type AlertAction =
	| { kind: "show"; notice: StatusNotice; sound: SoundChoice | null }
	| { kind: "sound"; session: string; sound: SoundChoice }
	| { kind: "withdraw"; session: string };

const HEADLINES: Record<AlertState, string> = {
	"needs-you": "needs you",
	"done": "is done",
	"error": "reported an error",
	"crashed": "crashed",
};

function isAlertState(kind: ShownStatus["kind"]): kind is AlertState {
	return (ALERT_STATES as readonly string[]).includes(kind);
}

/** The worktree's folder name, such as `feature-login` for `/work/timber-worktrees/feature-login`. */
function folderName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Whether the session's worktree is on screen in a window that shows and has the focus. */
export function onScreen(session: Pick<TerminalSession, "repository" | "path">, attention: Attention): boolean {
	return attention.visible && attention.focused
		&& attention.selected?.repository === session.repository && attention.selected.worktree === session.path;
}

/** The most of a child's name a notification title shows, in characters. */
const CHILD_NAME_LIMIT = 60;

/**
 * The words of a notification for a session that reached a notable status,
 * itself or through one of its children, such as "Claude Code: task review
 * needs you".
 */
export function describeNotice(session: TerminalSession, status: ShownStatus, child: ChildStatus | null = null): Omit<StatusNotice, "session"> {
	const message = session.state.kind !== "running" ? null : child !== null ? child.message : session.status?.message ?? null;
	const detail = message === null ? describeShownStatus(status) : shortMessage(message);
	const headline = isAlertState(status.kind) ? HEADLINES[status.kind] : describeShownStatus(status).toLowerCase();
	if (child === null) return { title: `${session.name} ${headline}`, body: `In ${folderName(session.path)}: ${detail}` };
	const name = Array.from(childName(child));
	const shortName = name.length <= CHILD_NAME_LIMIT ? name.join("") : `${name.slice(0, CHILD_NAME_LIMIT - 3).join("").trimEnd()}...`;
	return { title: `${session.name}: task ${shortName} ${headline}`, body: `In ${folderName(session.path)}: ${detail}` };
}

export interface StatusAlerts {
	/**
	 * A session changed. Only a marked session that moves into Needs you,
	 * Done, Error, or crashed is told about, when the settings ask for it and
	 * its worktree is not on screen in a focused window. Inside the interval
	 * for that status it waits instead (see `review`). A session whose
	 * notification no longer holds has it withdrawn.
	 */
	changed(change: TerminalChange, attention: Attention, settings: AlertSettings, now: number): AlertAction[];
	/**
	 * Look again at every session: withdraw a notification whose worktree is
	 * now on screen or whose status the settings no longer notify for, drop a
	 * waiting one that no longer holds, and let out each waiting one whose
	 * interval ended. For `attend`, a saved setting, and the timer.
	 */
	review(attention: Attention, settings: AlertSettings, now: number): AlertAction[];
	/** When the next waiting alert is due, or null when none waits. */
	nextDue(): number | null;
	/** Forget everything, such as for quitting. Answers a withdrawal for each notification on screen. */
	clear(): AlertAction[];
}

interface Tracked {
	session: TerminalSession;
	/** The status that counts for alerts (`alertStatus`): the root's, or a child's that needs you or reported an error. */
	status: ShownStatus;
	/** The path of the child `status` comes from, or null for the root. */
	child: string | null;
	/**
	 * The children already told about, with the status they were told for.
	 * One stays here while it holds that status, so a task left in Error, or
	 * still waiting for the person, is not told again each time the root
	 * moves away and back.
	 */
	toldChildren: Map<string, AlertState>;
	/** The status of the notification on screen, or null. */
	shown: AlertState | null;
	/** When each status was last told about, by notification or sound. */
	last: Map<AlertState, number>;
	/** A status that waits for its interval to end, and when it may go out. */
	waiting: { state: AlertState; due: number } | null;
}

function wantsNotice(settings: AlertSettings, state: AlertState): boolean {
	return settings.notify && settings.notifyStates.includes(state);
}

function wantsSound(settings: AlertSettings, state: AlertState): boolean {
	return settings.sounds[state] !== null;
}

export function createStatusAlerts(interval: number = NOTICE_INTERVAL_MILLISECONDS): StatusAlerts {
	const tracked = new Map<string, Tracked>();

	/** Tell about the session's current status now, built from what it says now. */
	const alert = (id: string, entry: Tracked, state: AlertState, settings: AlertSettings, now: number): AlertAction[] => {
		entry.waiting = null;
		entry.last.set(state, now);
		const sound = settings.sounds[state];
		if (entry.child !== null) entry.toldChildren.set(entry.child, state);
		if (wantsNotice(settings, state)) {
			entry.shown = state;
			const child = entry.child === null ? null : entry.session.children.find(task => task.id === entry.child) ?? null;
			return [{ kind: "show", notice: { session: id, ...describeNotice(entry.session, entry.status, child) }, sound }];
		}
		const actions: AlertAction[] = [];
		if (entry.shown !== null) {
			entry.shown = null;
			actions.push({ kind: "withdraw", session: id });
		}
		if (sound !== null) actions.push({ kind: "sound", session: id, sound });
		return actions;
	};

	const withdraw = (id: string, entry: Tracked): AlertAction[] => {
		if (entry.shown === null) return [];
		entry.shown = null;
		return [{ kind: "withdraw", session: id }];
	};

	return {
		changed(change, attention, settings, now) {
			const entry = tracked.get(change.id);
			const session = change.session;
			if (session === null) {
				tracked.delete(change.id);
				return entry?.shown != null ? [{ kind: "withdraw", session: change.id }] : [];
			}
			const counted = alertStatus(session);
			let status = counted.status;
			let child = counted.child?.id ?? null;
			if (entry === undefined) {
				// The first sight of a session is never told about: it may be one that was already there.
				tracked.set(change.id, { session, status, child, toldChildren: new Map(), shown: null, last: new Map(), waiting: null });
				return [];
			}
			// The child that counted before keeps counting while it holds the same status, so a second task needing you is not told again, whatever its path.
			const kept = entry.child === null ? undefined : session.children.find(task => task.id === entry.child);
			if (child !== null && kept !== undefined && session.state.kind === "running" && shownChildStatus(kept).kind === status.kind) {
				child = kept.id;
				status = shownChildStatus(kept);
			}
			// A child that left the status it was told for may be told again later.
			for (const [path, told] of entry.toldChildren) {
				const task = session.state.kind === "running" ? session.children.find(each => each.id === path) : undefined;
				if (task === undefined || shownChildStatus(task).kind !== told) entry.toldChildren.delete(path);
			}
			const before = entry;
			const marked = hasStatusMark(session) || hasStatusMark(before.session);
			// Another child taking over the same status is a move too: the notification on screen was about the one before.
			const moved = before.status.kind !== status.kind || before.child !== child;
			entry.session = session;
			entry.status = status;
			entry.child = child;
			if (!moved) return [];
			// The notification on screen, and any waiting one, were for the status it just left.
			entry.waiting = null;
			const actions = withdraw(change.id, entry);
			if (!marked || !isAlertState(status.kind)) return actions;
			const state = status.kind;
			// A session with no status mark, such as a plain shell, is never told about, not even when it ends badly.
			if (!wantsNotice(settings, state) && !wantsSound(settings, state)) return actions;
			// A child already told about for this status, which never left it, is not told again.
			if (child !== null && entry.toldChildren.get(child) === state) return actions;
			if (onScreen(session, attention)) return actions;
			const last = entry.last.get(state);
			if (last !== undefined && now - last < interval) {
				entry.waiting = { state, due: last + interval };
				return actions;
			}
			// A new notification replaces the old one, so there is nothing to withdraw first.
			const told = alert(change.id, entry, state, settings, now);
			return told.some(action => action.kind === "show") ? told : [...actions, ...told];
		},
		review(attention, settings, now) {
			const actions: AlertAction[] = [];
			for (const [id, entry] of tracked) {
				const here = onScreen(entry.session, attention);
				if (entry.shown !== null && (here || !wantsNotice(settings, entry.shown))) actions.push(...withdraw(id, entry));
				const waiting = entry.waiting;
				if (waiting === null) continue;
				const holds = entry.status.kind === waiting.state && !here && (wantsNotice(settings, waiting.state) || wantsSound(settings, waiting.state));
				if (!holds) entry.waiting = null;
				else if (waiting.due <= now) actions.push(...alert(id, entry, waiting.state, settings, now));
			}
			return actions;
		},
		nextDue() {
			let next: number | null = null;
			for (const entry of tracked.values()) {
				if (entry.waiting !== null && (next === null || entry.waiting.due < next)) next = entry.waiting.due;
			}
			return next;
		},
		clear() {
			const actions: AlertAction[] = [];
			for (const [id, entry] of tracked) actions.push(...withdraw(id, entry));
			tracked.clear();
			return actions;
		},
	};
}

/** What a runner needs from where it runs: the main process, or the mock engine. */
export interface AlertRunnerDependencies {
	attention(): Attention;
	settings(): AlertSettings;
	/** Carry out each action, in order. */
	act(action: AlertAction): void;
	now?: () => number;
	setTimer?: (run: () => void, delay: number) => unknown;
	clearTimer?: (timer: unknown) => void;
	interval?: number;
}

export interface AlertRunner {
	/** A session changed. */
	changed(change: TerminalChange): void;
	/** What is on screen or the settings changed. */
	review(): void;
	/** Withdraw every notification and stop the timer, for quitting. */
	stop(): void;
}

/**
 * The policy with its clock and its one timer, so a waiting alert goes out
 * when its interval ends without anything else happening. Shared by the main
 * process and the mock engine, so both decide the same way.
 */
export function createAlertRunner(dependencies: AlertRunnerDependencies): AlertRunner {
	const { attention, settings, act, now = Date.now, interval } = dependencies;
	const setTimer = dependencies.setTimer ?? ((run: () => void, delay: number) => setTimeout(run, delay));
	const clearTimer = dependencies.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	const policy = createStatusAlerts(interval);
	let timer: unknown = null;
	let stopped = false;

	const carry = (actions: AlertAction[]) => {
		for (const action of actions) act(action);
		schedule();
	};
	const schedule = () => {
		if (timer !== null) clearTimer(timer);
		timer = null;
		const due = policy.nextDue();
		if (due === null || stopped) return;
		timer = setTimer(() => {
			timer = null;
			if (!stopped) carry(policy.review(attention(), settings(), now()));
		}, Math.max(0, due - now()));
	};

	return {
		changed(change) {
			if (!stopped) carry(policy.changed(change, attention(), settings(), now()));
		},
		review() {
			if (!stopped) carry(policy.review(attention(), settings(), now()));
		},
		stop() {
			if (stopped) return;
			for (const action of policy.clear()) act(action);
			stopped = true;
			if (timer !== null) clearTimer(timer);
			timer = null;
		},
	};
}
