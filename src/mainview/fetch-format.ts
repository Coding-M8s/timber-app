import { type FetchSetting, MAX_FETCH_MINUTES, MIN_FETCH_MINUTES, isFetchInterval, sameFetchSetting } from "../shared/fetch-setting";
import type { FetchFailureKind, RepositoryFetch } from "../shared/git-fetch";

/**
 * Words and rules for fetching: the Fetch now control and the quiet marker on
 * a repository, and the Fetching section of Settings. Pure, so they can be
 * tested without a window.
 */

/** The toast after Fetch now worked. */
export const describeFetched = (name: string) => `Fetched ${name}`;

/** How long ago a moment was, in a few words. */
export function describeAgo(at: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The marker's word for each way a fetch fails. */
const FAILURE_FLAGS: Record<FetchFailureKind, string> = {
	offline: "offline",
	authentication: "sign-in needed",
	failed: "fetch failed",
};

/** One plain sentence for each way a fetch fails. */
const FAILURE_SENTENCES: Record<FetchFailureKind, string> = {
	offline: "The last fetch could not reach the remote. The app tries again later, waiting longer each time.",
	authentication: "The last fetch needs credentials that are not stored, or the remote refused them. The app never asks in the background: fetch once in a terminal, or store them with a credential helper or an SSH agent.",
	failed: "The last fetch failed.",
};

export interface FetchMarker {
	/** The marker's word, shown beside the repository's name. */
	text: string;
	/** Every sentence, for the tooltip and for assistive technology. */
	tooltip: string;
}

/**
 * The quiet marker on a repository whose latest fetch failed, or null when
 * it worked, none ran yet, or one runs now. Never a dialog.
 */
export function describeFetchMarker(fetch: RepositoryFetch | undefined, now: number): FetchMarker | null {
	if (!fetch?.failure || fetch.fetching) return null;
	const { kind, message, at } = fetch.failure;
	const last = fetch.lastFetched === null ? "" : ` The last fetch that worked was ${describeAgo(fetch.lastFetched, now)}.`;
	return { text: FAILURE_FLAGS[kind], tooltip: `${FAILURE_SENTENCES[kind]}${last} It failed ${describeAgo(at, now)}: ${message}` };
}

/** What the Fetch now control says it does, with when the repository was last fetched. */
export function describeFetchAction(name: string, fetch: RepositoryFetch | undefined, now: number): string {
	if (fetch?.fetching) return `Fetching ${name}`;
	const last = fetch?.lastFetched == null ? "Not fetched since the app started." : `Last fetched ${describeAgo(fetch.lastFetched, now)}.`;
	return `Fetch ${name} now. ${last} Only remote-tracking branches change.`;
}

/** What the Fetching section holds while it is edited. The interval is the text as typed. */
export interface FetchDraft {
	background: boolean;
	interval: string;
}

export function fetchDraftOf(setting: FetchSetting): FetchDraft {
	return { background: setting.background, interval: String(setting.intervalMinutes) };
}

export interface FetchDraftModel {
	/** The setting the draft saves, or null while the interval cannot be read. */
	setting: FetchSetting | null;
	/** Why the interval cannot be saved, or null. */
	error: string | null;
	/** True when the draft can be saved and differs from what is saved. */
	canSave: boolean;
}

/** What the draft would save, and whether Save is available. */
export function fetchDraftModel(draft: FetchDraft, saved: FetchSetting): FetchDraftModel {
	const text = draft.interval.trim();
	const minutes = /^\d+$/.test(text) ? Number(text) : Number.NaN;
	if (!isFetchInterval(minutes)) {
		const error = text === ""
			? "Enter how many minutes to wait between fetches."
			: `Enter a whole number of minutes from ${MIN_FETCH_MINUTES} to ${MAX_FETCH_MINUTES}.`;
		return { setting: null, error, canSave: false };
	}
	const setting: FetchSetting = { background: draft.background, intervalMinutes: minutes };
	return { setting, error: null, canSave: !sameFetchSetting(setting, saved) };
}
