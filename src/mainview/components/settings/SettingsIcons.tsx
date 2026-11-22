import type { ReactNode } from "react";
import type { SettingsSection } from "../../store/state";

/** The strokes of each section's icon in the Settings list, on a 24 by 24 grid. */
const ICON_PATHS: Record<SettingsSection, ReactNode> = {
	layout: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
	theme: <><circle cx="12" cy="12" r="8" /><path d="M12 4v16M12 8h5M12 12h8M12 16h5" /></>,
	terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
	rendering: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.3 6.3l2 2M15.7 15.7l2 2M6.3 17.7l2-2M15.7 8.3l2-2" />,
	editor: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
	agents: <><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13v1M15 13v1" /></>,
	chops: <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" />,
	notifications: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0" />,
	fetch: <path d="M20 11a8 8 0 0 0-14.6-4.4M4 4v4h4M4 13a8 8 0 0 0 14.6 4.4M20 20v-4h-4" />,
	// An arrow down onto a line: commits coming into the branch.
	pull: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
	about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
	// A program with a prompt: which Timber executable runs.
	executable: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 13l2 2-2 2" /></>,
	machine: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>,
	repository: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
};

/** A section's icon beside its name in the Settings list. Decoration only: the name says what it is. */
export function SettingsSectionIcon({ section }: { section: SettingsSection }) {
	return (
		<svg className="settings-nav-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			{ICON_PATHS[section]}
		</svg>
	);
}

/** The cross on the Settings dialog's close button. */
export function CloseIcon() {
	return (
		<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			<path d="M6 6l12 12M18 6 6 18" />
		</svg>
	);
}
