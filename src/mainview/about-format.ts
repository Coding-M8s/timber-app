import type { TimberState } from "./store/state";

/** One line of About: what is described, its value, and a quieter note under it. */
export interface AboutRow {
	label: string;
	value: string;
	/** Shown in the monospace face, as versions and paths are. */
	mono: boolean;
	note: string | null;
}

/** The Timber in use, as About tells it: the version when one answered, and otherwise why there is none. */
function timberRow(timber: TimberState): AboutRow {
	const label = "Timber";
	if (timber === null) return { label, value: "Looking for Timber", mono: false, note: null };
	if (!timber.known) return { label, value: "Could not look for Timber", mono: false, note: timber.message };
	const status = timber.status;
	if (status.state === "ready") return { label, value: status.version, mono: true, note: status.path };
	if (status.state === "too-old") {
		return { label, value: status.found, mono: true, note: `Too old: the app needs ${status.required} or newer. Found at ${status.path}` };
	}
	return { label, value: "Not installed", mono: false, note: null };
}

/** What About lists: the app's own version, then the Timber in use. */
export function aboutRows(appVersion: string | null, timber: TimberState): AboutRow[] {
	return [
		appVersion === null
			? { label: "Timber app", value: "Version not known", mono: false, note: null }
			: { label: "Timber app", value: appVersion, mono: true, note: null },
		timberRow(timber),
	];
}
