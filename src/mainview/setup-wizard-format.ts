import { describeCommandLine } from "../shared/command-line";
import { type TimberConfigScope, type TimberSettingsSaveRequest, type TimberSettingsSnapshot, type TimberValues, invalidFieldsAt } from "../shared/timber-config";
import {
	type GroupDrafts, type LauncherDraft, type TimberGroup, type TrackingDraft, DRAWN_PATHS, TIMBER_GROUPS, TIMBER_GROUP_TITLES, TRACKER_CHOICES, credentialsToSave,
	describeJiraSprint, loginsChange, valuesWithAll,
} from "./timber-settings-format";

/**
 * The setup wizard as data: its steps, where Timber's messages about a
 * field send the person, and the choices in words for the last step. Pure,
 * so it can be tested without a window.
 *
 * The wizard asks what `timber setup` asks, in the same order: where the
 * settings go, then each group of Settings > Repository, then a last look
 * with the exact command that saves them all at once.
 */

export const WIZARD_STEPS = ["scope", ...TIMBER_GROUPS, "review"] as const;
export type WizardStep = typeof WIZARD_STEPS[number];

export const WIZARD_STEP_TITLES: Record<WizardStep, string> = {
	scope: "Where to save",
	...TIMBER_GROUP_TITLES,
	review: "Save",
};

/** The step a message from Timber is about, so the wizard can go back there. Null when no step draws that field. */
export function stepOfField(message: string): TimberGroup | null {
	return TIMBER_GROUPS.find(group => DRAWN_PATHS[group].some(path => invalidFieldsAt([message], path).length > 0)) ?? null;
}

/** The first step any of Timber's messages is about, in the order of the steps, or the last step when none draws them. */
export function firstStepOf(messages: readonly string[]): WizardStep {
	const steps = new Set(messages.map(stepOfField));
	return TIMBER_GROUPS.find(group => steps.has(group)) ?? "review";
}

/** Where a scope's settings go, in words. */
export function describeScope(scope: TimberConfigScope, repositoryName: string): string {
	return scope === "repository" ? `${repositoryName} only` : "Every repository on this machine";
}

function describeLauncher(draft: LauncherDraft, inherit: string, automatic: string): string {
	if (draft.mode === "inherit") return inherit;
	if (draft.mode === "off") return "Off";
	const line = draft.command === "" ? "(no program)" : describeCommandLine([draft.command, ...draft.args]);
	return draft.enabled ? `${line}, ${automatic}` : line;
}

/** The Jira site with its sprint source and project, as one part of the tracking line. */
function describeJira(tracking: TrackingDraft): string | null {
	if (tracking.jiraMode === "off") return "Jira off";
	if (tracking.jiraMode !== "set") return null;
	const typed = (text: string) => text.trim() === "" ? undefined : text.trim();
	const sprint = describeJiraSprint({
		board: tracking.sprintSource === "board" ? typed(tracking.board) : undefined,
		sprint_jql: tracking.sprintSource === "jql" ? typed(tracking.sprintJql) : undefined,
		project: typed(tracking.jiraProject),
	});
	return [`Jira at ${tracking.siteUrl || "(no site)"}`, ...sprint].join(", ");
}

/**
 * Each group's choice in one line, for the last step. Logins are only said
 * to change, never shown. `inherit` names what a value left alone falls
 * back to in this scope.
 */
export function describeChoices(drafts: GroupDrafts, scope: TimberConfigScope): { group: TimberGroup; text: string }[] {
	const inherit = scope === "repository" ? "Machine default" : "Timber's default";
	const { editor, agent, git, scripts, tracking } = drafts;
	const gitParts = [
		git.base_branch !== "" ? `starts from ${git.base_branch}` : null,
		git.remote !== "" ? `remote ${git.remote}` : null,
		git.worktree_dir !== "" ? `worktrees in ${git.worktree_dir}` : null,
	].filter(part => part !== null);
	const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
	const tracker = TRACKER_CHOICES.find(choice => choice.value === tracking.tracker)?.label;
	const trackingParts = [
		tracker !== undefined ? `${tracker} issues` : null,
		describeJira(tracking),
		tracking.githubProject.trim() !== "" ? `GitHub project ${tracking.githubProject.trim()}` : null,
		tracking.githubMilestone.trim() !== "" ? `milestone ${tracking.githubMilestone.trim()}` : null,
		tracking.linearTeam.trim() !== "" ? `Linear team ${tracking.linearTeam.trim()}` : null,
		loginsChange(tracking) ? "logins change" : null,
	].filter(part => part !== null);
	return [
		{ group: "editor", text: describeLauncher(editor, inherit, "opens by itself") },
		{ group: "agent", text: describeLauncher(agent, inherit, "starts by itself") },
		{ group: "git", text: gitParts.length > 0 ? gitParts.join(", ") : inherit },
		{
			group: "scripts",
			text: scripts.mode === "inherit" ? inherit : scripts.mode === "off" ? "Off"
				: `${plural(scripts.setup.length, "setup script")}, ${plural(scripts.preDone.length, "pre-done script")}`,
		},
		{ group: "tracking", text: trackingParts.length > 0 ? trackingParts.join(", ") : inherit },
	];
}

/**
 * The one save at the end of the wizard: every group's fields on top of the
 * scope's settings as last read, with the revision they were read at, so a
 * change made outside the app in between is refused as a conflict. A
 * tracked file changes only with the person's say-so. Null when a login
 * typed is refused (`credentialsToSave`): then nothing may be sent.
 */
export function wizardSaveRequest(
	scope: TimberConfigScope,
	repository: string,
	settings: Pick<TimberSettingsSnapshot, "revision" | "values" | "tracked">,
	drafts: GroupDrafts,
	editTracked: boolean,
	machine: TimberValues | null,
): TimberSettingsSaveRequest | null {
	const logins = credentialsToSave(drafts.tracking, machine);
	if ("refused" in logins) return null;
	return {
		scope,
		repository: scope === "repository" ? repository : null,
		revision: settings.revision,
		values: valuesWithAll(drafts, settings.values),
		...logins,
		editTracked: settings.tracked && editTracked,
	};
}
