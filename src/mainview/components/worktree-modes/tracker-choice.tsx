import type { IssueTrackers } from "../../../shared/issue-trackers";
import type { IssueTracker } from "../../../shared/model";
import { TRACKER_NAMES } from "../../issue-format";

/**
 * The Tracker field of the "New branch" mode, and what a pick there means.
 * Pure, so all of it is tested without a window.
 *
 * The pick applies to one creation only: it turns a Name with the shape of
 * an issue into `github:42`, `jira:ENG-42`, or `linear:ENG-42` (see
 * `issueSelector`), and never changes Timber's default tracker. Default, the
 * first option, passes the Name unchanged. The list comes from
 * `readIssueTrackers` and is a help, never a gate: while it is read, when it
 * cannot be read, or with fewer than two trackers set up, there is no field.
 */

/** The trackers a repository has set up: undefined while they are read. */
export type TrackerOptions = IssueTrackers | undefined;

/** The trackers the field offers after Default: none unless two or more are set up. */
export function shownTrackers(options: TrackerOptions): IssueTracker[] {
	return options?.ok && options.available.length >= 2 ? options.available : [];
}

/**
 * The tracker a command prefixes for, or null for Default. A pick the field
 * does not offer is Default, so the footer never shows a prefix the field
 * does not.
 */
export function chosenTracker(options: TrackerOptions, pick: IssueTracker | null): IssueTracker | null {
	return pick !== null && shownTrackers(options).includes(pick) ? pick : null;
}

/** The words of the Default option: it names the tracker Timber reads a bare issue with, when there is one. */
export function defaultTrackerLabel(options: TrackerOptions): string {
	return options?.ok && options.defaultTracker !== null ? `Default (${TRACKER_NAMES[options.defaultTracker]})` : "Default";
}

/** The value of the field's option as a pick: the empty value is Default. */
export function trackerOfOption(value: string): IssueTracker | null {
	return value === "github" || value === "jira" || value === "linear" ? value : null;
}

interface TrackerFieldProps {
	options: TrackerOptions;
	/** The tracker the command prefixes for, or null for Default (see `chosenTracker`). */
	chosen: IssueTracker | null;
	disabled: boolean;
	onPick: (pick: IssueTracker | null) => void;
}

/** Default first and picked at the start, then each tracker set up. */
export function TrackerField({ options, chosen, disabled, onPick }: TrackerFieldProps) {
	const trackers = shownTrackers(options);
	if (trackers.length === 0) return null;
	return (
		<label className="field">
			<span className="field-label">Tracker</span>
			<select className="field-input" name="tracker" value={chosen ?? ""} disabled={disabled} onChange={event => onPick(trackerOfOption(event.target.value))}>
				<option value="">{defaultTrackerLabel(options)}</option>
				{trackers.map(tracker => <option key={tracker} value={tracker}>{TRACKER_NAMES[tracker]}</option>)}
			</select>
			<span className="field-hint">
				{chosen === null
					? "An issue number or key in Name is read with Timber's default tracker."
					: `An issue ${chosen === "github" ? "number" : "key"} in Name is read as a ${TRACKER_NAMES[chosen]} issue, for this worktree only.`}
			</span>
		</label>
	);
}
