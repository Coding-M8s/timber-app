/**
 * The words of an agent row's status line in Settings, Agents, and of the
 * status hook dialogs (see docs/design.md, "Status hooks"). Pure.
 */
import { type HookDetails, type StatusHookView, describeStates, hookedAgent } from "../shared/status-hooks";

/** What a status line's buttons and a dialog do. */
export type HookAction = "install" | "remove" | "add-by-hand" | "remove-by-hand" | "differs";

export interface StatusLineModel {
	/** The words before the line's text, set apart: "Status" or "Status hook". */
	label: string;
	text: string;
	/** An error line is in the error color, and says its label in its text. */
	tone: "hint" | "error";
	actions: { action: HookAction; label: string }[];
}

/** The line under a saved agent's row, or null when the row shows none: an agent not known, or one that cannot report. */
export function describeStatusLine(view: StatusHookView): StatusLineModel | null {
	if (view.source === "osc-7501") {
		const states = describeStates(view.reports);
		return { label: "Status", text: states === "" ? "Reports its status itself." : `Reports ${states} itself.`, tone: "hint", actions: [] };
	}
	const hook = view.hook;
	if (view.source !== "hook" || hook === null) return null;
	// A file of the app's own is added and taken out whole, not as entries.
	const own = hook.kind === "file";
	const remove = { action: hook.byHand === null ? "remove" as const : "remove-by-hand" as const, label: hook.byHand === null ? "Remove…" : own ? "Show the file to delete…" : "Show the entries to remove…" };
	switch (hook.state.kind) {
		case "off":
			return hook.byHand === null
				? { label: "Status hook", text: `Off. ${(own && hookedAgent(hook.agent)?.status.hook.caveat) || "Its sessions show only running or exited."}`, tone: "hint", actions: [{ action: "install", label: "Turn on…" }] }
				: { label: "Status hook", text: `Off. ${hook.byHand}`, tone: "hint", actions: [{ action: "add-by-hand", label: own ? "Show the plugin to add…" : "Show the entries to add…" }] };
		case "on": {
			const states = describeStates(view.reports);
			const missing = view.reports.includes("blocked") ? "" : "; not needs you";
			return { label: "Status hook", text: `On, in ${hook.file}. Reports ${states}${missing}.${hook.run ? "" : ` Not yet checked by running ${hook.agentName}.`}`, tone: "hint", actions: [remove] };
		}
		case "changed":
			return {
				label: "Status hook changed",
				text: `${hook.state.reason} Checked against ${hook.checked}. The app does not rewrite it.`,
				tone: "error",
				// A script that is not the app's has nothing to compare among the entries.
				actions: hook.state.script ? [remove] : [{ action: "differs", label: "Show what differs…" }, remove],
			};
		case "broken":
			// The app's entries can still be taken out when they are there, as when only the script is missing.
			return {
				label: "Status hook broken",
				text: `${hook.state.reason} ${hook.present.length === 0 ? "Fix it by hand" : own ? "Remove deletes the app's plugin, or fix it by hand" : "Remove takes out the app's entries, or fix it by hand"}, then open Settings, Agents again.`,
				tone: "error",
				actions: hook.present.length > 0 ? [remove] : [],
			};
	}
}

export interface HookDialogModel {
	title: string;
	lead: string;
	/** A note under the lead, quieter, or null. */
	note: string | null;
	/** Exact text, each under its label, shown in full. */
	blocks: { label: string; text: string }[];
	/** The button that writes, or null for a dialog that only shows. */
	confirm: { label: string; danger: boolean; running: string } | null;
	/** What Copy puts on the clipboard, or null for no Copy. */
	copy: string | null;
	/** The label of the button that closes. */
	cancel: string;
	/** From the differs dialog: the button that opens Remove, or null. */
	next: { action: HookAction; label: string } | null;
}

/** The dialog for an action on an agent's hook, as last read. */
export function describeHookDialog(hook: HookDetails, reports: StatusHookView["reports"], action: HookAction): HookDialogModel {
	if (hook.kind === "file") return describePluginDialog(hook, reports, action);
	const name = hook.agentName;
	const count = hook.entries.match(/"command":/g)?.length ?? 0;
	const states = describeStates(reports);
	const present = hook.present.join("\n");
	const quiet = { note: null, copy: null, next: null };
	switch (action) {
		case "install":
			return {
				...quiet,
				title: `Turn on the ${name} status hook?`,
				lead: `${name} does not report its status. This adds ${count === 1 ? "an entry" : `${count} entries`} to its hooks file, so its sessions in the app show ${states}, with their notifications and sounds. ${name} runs them in every terminal; outside the app they do nothing.`,
				note: [hook.exists ? `Adds to ${hook.file}. Nothing else in it changes.` : `Makes ${hook.file}, which is not there yet.`, hookedAgent(hook.agent)?.status.hook.caveat].filter(Boolean).join(" ") + notRun(hook),
				blocks: [
					{ label: hook.exists ? `Added to ${hook.file}` : hook.file, text: hook.entries },
					{ label: `The script they run, ${hook.scriptPath ?? ""}`, text: hook.script ?? "" },
				],
				confirm: { label: "Turn on", danger: false, running: "Turning on…" },
				cancel: "Cancel",
			};
		case "remove":
			return {
				...quiet,
				title: `Remove the ${name} status hook?`,
				lead: `Takes the app's entries out of ${hook.file}. Your own hooks and every other key stay as they are. ${name} sessions then show only running or exited.`,
				blocks: [{ label: `Removed from ${hook.file}`, text: present }],
				confirm: { label: "Remove", danger: true, running: "Removing…" },
				cancel: "Cancel",
			};
		case "add-by-hand":
			return {
				...quiet,
				title: `Add the ${name} status hook by hand`,
				lead: `${hook.byHand ?? ""} Add these entries to its "hooks" yourself; Settings shows On once they are there.`,
				note: `Done puts the script they run at ${hook.scriptPath}, in the app's own folder.`,
				blocks: [
					{ label: "Entries to add", text: hook.entries },
					{ label: `The script they run, ${hook.scriptPath ?? ""}`, text: hook.script ?? "" },
				],
				confirm: { label: "Done", danger: false, running: "Writing the script…" },
				copy: hook.entries,
				cancel: "Cancel",
			};
		case "remove-by-hand":
			return {
				...quiet,
				title: `Remove the ${name} status hook by hand`,
				lead: `${hook.byHand ?? ""} Take these entries out of its "hooks" yourself; Settings shows Off once they are gone.`,
				blocks: [{ label: `Entries to take out of ${hook.file}`, text: present }],
				confirm: null,
				copy: present,
				cancel: "Close",
			};
		case "differs":
			return {
				...quiet,
				title: `The ${name} status hook changed`,
				lead: `${hook.state.kind === "changed" ? hook.state.reason : ""} The app does not rewrite it. Remove takes out the app's entries as they are; Turn on then adds them again as the app writes them.`,
				blocks: [
					{ label: `In ${hook.file} now`, text: present === "" ? "(none)" : present },
					{ label: "As the app writes them", text: hook.entries },
				],
				confirm: null,
				cancel: "Close",
				next: hook.byHand === null ? { action: "remove", label: "Remove…" } : { action: "remove-by-hand", label: "Show the entries to remove…" },
			};
	}
}

/** A note for a hook built from the agent's source and never run: " Not yet checked by running <agent>.", or "". */
function notRun(hook: HookDetails): string {
	return hook.run ? "" : ` Not yet checked by running ${hook.agentName}.`;
}

/** The dialogs for a plugin file of the app's own, added and deleted whole (OpenCode's). */
function describePluginDialog(hook: HookDetails, reports: StatusHookView["reports"], action: HookAction): HookDialogModel {
	const name = hook.agentName;
	const states = describeStates(reports);
	const present = hook.present.join("\n");
	const folder = hook.file.slice(0, hook.file.lastIndexOf("/") + 1) || hook.file;
	const quiet = { note: null, copy: null, next: null };
	const caveat = hookedAgent(hook.agent)?.status.hook.caveat;
	switch (action) {
		case "install":
			return {
				...quiet,
				title: `Turn on the ${name} status hook?`,
				lead: `This adds a plugin of the app's, so its sessions in the app show ${states}, with their notifications and sounds. ${name} loads it in every terminal; outside the app it does nothing.`,
				note: `${[`Makes ${hook.file}. Nothing else in ${folder} changes.`, caveat].filter(Boolean).join(" ")}${notRun(hook)}`,
				blocks: [{ label: hook.file, text: hook.entries }],
				confirm: { label: "Turn on", danger: false, running: "Turning on…" },
				cancel: "Cancel",
			};
		case "remove":
			return {
				...quiet,
				title: `Remove the ${name} status hook?`,
				lead: `Deletes ${hook.file}, the app's plugin. Your other plugins stay as they are. Sessions that need it then show only running or exited.`,
				blocks: [{ label: `Deleted: ${hook.file}`, text: present }],
				confirm: { label: "Remove", danger: true, running: "Removing…" },
				cancel: "Cancel",
			};
		case "add-by-hand":
			return {
				...quiet,
				title: `Add the ${name} status hook by hand`,
				lead: `${hook.byHand ?? ""} Save this as ${hook.file} yourself; Settings shows On once it is there.`,
				note: notRun(hook).trim() || null,
				blocks: [{ label: "Plugin to save", text: hook.entries }],
				confirm: null,
				copy: hook.entries,
				cancel: "Close",
			};
		case "remove-by-hand":
			return {
				...quiet,
				title: `Remove the ${name} status hook by hand`,
				lead: `${hook.byHand ?? ""} Delete ${hook.file} yourself; Settings shows Off once it is gone.`,
				blocks: [{ label: `In ${hook.file}`, text: present }],
				confirm: null,
				cancel: "Close",
			};
		case "differs":
			return {
				...quiet,
				title: `The ${name} status hook changed`,
				lead: `${hook.state.kind === "changed" ? hook.state.reason : ""} The app does not rewrite it. Remove deletes the file as it is; Turn on then writes it as this version of the app does.`,
				blocks: [
					{ label: `In ${hook.file} now`, text: present === "" ? "(none)" : present },
					{ label: "As the app writes it", text: hook.entries },
				],
				confirm: null,
				cancel: "Close",
				next: hook.byHand === null ? { action: "remove", label: "Remove…" } : { action: "remove-by-hand", label: "Show the file to delete…" },
			};
	}
}
