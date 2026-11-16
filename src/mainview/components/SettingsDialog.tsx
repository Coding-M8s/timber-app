import { type ComponentType, useEffect, useId, useRef, useState } from "react";
import { SETTINGS_SECTION_LABELS } from "../shell";
import { useStore } from "../store/react";
import { SETTINGS_SECTIONS, type SettingsSection } from "../store/state";
import { LayoutSection } from "./settings/LayoutSection";

/** What each section of the Settings dialog draws. A new section is one entry here and one in `SETTINGS_SECTIONS`. */
const SECTION_VIEWS: Record<SettingsSection, ComponentType> = {
	layout: LayoutSection,
};

const sectionTabId = (section: SettingsSection) => `settings-tab-${section}`;

/**
 * The app's own settings, with the sections down the side. Each section saves
 * its own values with its own Save. Nothing here runs Timber.
 */
export function SettingsDialog({ initialSection }: { initialSection: SettingsSection }) {
	const store = useStore();
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const panelId = useId();
	const [section, setSection] = useState<SettingsSection>(initialSection);
	const View = SECTION_VIEWS[section];

	// Opened as a modal, so the rest of the window is inert and focus stays inside.
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);

	return (
		<dialog
			ref={dialog}
			className="dialog settings-dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				// Escape closes, through the store, so the store stays the one that says what is open.
				event.preventDefault();
				store.closeDialog();
			}}
		>
			<header className="dialog-head settings-head">
				<h2 id={titleId} className="dialog-title">Settings</h2>
				<button type="button" className="button quiet" onClick={() => store.closeDialog()}>Close</button>
			</header>
			<div className="settings-body">
				<nav className="settings-nav" aria-label="Settings sections">
					{SETTINGS_SECTIONS.map(candidate => (
						<button
							key={candidate}
							type="button"
							id={sectionTabId(candidate)}
							className={candidate === section ? "settings-nav-item selected" : "settings-nav-item"}
							aria-current={candidate === section ? "page" : undefined}
							aria-controls={panelId}
							onClick={() => setSection(candidate)}
						>
							{SETTINGS_SECTION_LABELS[candidate]}
						</button>
					))}
				</nav>
				{/* A key per section, so a section left unsaved starts again from what is saved. */}
				<div className="settings-panel" id={panelId}>
					<View key={section} />
				</div>
			</div>
		</dialog>
	);
}
