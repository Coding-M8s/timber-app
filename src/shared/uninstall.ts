/**
 * Uninstalling the app from inside the app. Pure: nothing here reads a file
 * or runs a process.
 *
 * The app never removes its own install. Electrobun's uninstaller, installed
 * beside the app, does that, and the app only runs it and then quits. See
 * docs/architecture.md, "Uninstalling from the app".
 */

/**
 * What the uninstaller is run with: no questions, and the web data and cache
 * go too. `--delete-data` is only accepted after `--quiet`.
 */
export const UNINSTALL_ARGUMENTS: readonly string[] = ["--quiet", "--delete-data"];

/** Whether this copy of the app can uninstall itself, and what that would do. */
export type UninstallPlan =
	| {
		available: true;
		/** The uninstaller and its arguments, exactly as they would run. */
		command: string[];
		/** The folders and files the uninstaller removes that are there now. */
		removes: string[];
		/** The app's own settings folder, which goes only when asked. */
		settingsFolder: string;
	}
	| { available: false; reason: string };

/** The plan of a copy that can uninstall itself. */
export type AvailableUninstallPlan = Extract<UninstallPlan, { available: true }>;

export interface UninstallRequest {
	/** Also delete the saved repository list and the app's settings. */
	forgetSettings: boolean;
}

export type UninstallResult =
	/**
	 * The app is removed. With `settingsProblem` null the app quits by itself
	 * in a moment. Otherwise the settings were asked to go and could not, and
	 * the app stays open to say so.
	 */
	| { outcome: "uninstalled"; settingsProblem: string | null }
	/** Nothing ran: this copy cannot uninstall itself. */
	| { outcome: "unavailable"; message: string }
	/** The uninstaller ran and did not finish. The settings were not touched. */
	| { outcome: "failed"; message: string };

/** What the installer recorded beside the uninstaller, as far as the app reads it. */
export interface InstallRecord {
	identifier: string;
	/** The folder of this install under the identifier, normally the channel. */
	installRoot: string;
	/** The menu entry and the desktop shortcut, when the installer made them. */
	entries: string[];
	cacheHome: string | null;
	stateHome: string | null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

/** Read `.electrobun-uninstall.json`. Null when it is not such a record. */
export function parseInstallRecord(content: string): InstallRecord | null {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const identifier = text(record.identifier);
	const installRoot = text(record.install_root_name) ?? text(record.channel);
	if (identifier === null || installRoot === null) return null;
	return {
		identifier,
		installRoot,
		entries: [text(record.application_entry), text(record.desktop_entry)].filter(entry => entry !== null),
		cacheHome: text(record.xdg_cache_home),
		stateHome: text(record.xdg_state_home),
	};
}

/**
 * Every place the uninstaller removes from for this install: its folder,
 * its cache and log folders, and both entries. Some may not be there.
 */
export function uninstallTargets(root: string, record: InstallRecord): string[] {
	const under = (home: string | null) => home === null ? [] : [`${home.replace(/\/+$/, "")}/${record.identifier}/${record.installRoot}`];
	return [root, ...under(record.cacheHome), ...under(record.stateHome), ...record.entries];
}
