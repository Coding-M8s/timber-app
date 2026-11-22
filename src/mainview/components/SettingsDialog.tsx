import { type ComponentType, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SETTINGS_NAV_FOOT, SETTINGS_NAV_GROUPS, SETTINGS_SECTION_LABELS } from "../shell";
import { useAppState, useStore } from "../store/react";
import { SETTINGS_SECTIONS, type SettingsSection } from "../store/state";
import { AboutSection } from "./settings/AboutSection";
import { AgentsSection } from "./settings/AgentsSection";
import { ChopsSection } from "./settings/ChopsSection";
import { EditorSection } from "./settings/EditorSection";
import { FetchSection } from "./settings/FetchSection";
import { PullSection } from "./settings/PullSection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { LayoutSection } from "./settings/LayoutSection";
import { SettingsSavingContext } from "./settings/SettingsSection";
import { CloseIcon, SettingsSectionIcon } from "./settings/SettingsIcons";
import { RenderingSection } from "./settings/RenderingSection";
import { MachineSection, RepositorySection } from "./settings/TimberSections";
import { TerminalSection } from "./settings/TerminalSection";
import { TimberExecutableSection } from "./settings/TimberExecutableSection";
import { ThemeSection } from "./settings/ThemeSection";

/**
 * What each section of the Settings dialog draws. A new section is an entry
 * here, in `SETTINGS_SECTIONS` (store/state.ts), and in
 * `SETTINGS_SECTION_LABELS` (shell.ts).
 */
const SECTION_VIEWS: Record<SettingsSection, ComponentType> = {
	layout: LayoutSection,
	theme: ThemeSection,
	terminal: TerminalSection,
	rendering: RenderingSection,
	editor: EditorSection,
	agents: AgentsSection,
	chops: ChopsSection,
	notifications: NotificationsSection,
	fetch: FetchSection,
	pull: PullSection,
	about: AboutSection,
	executable: TimberExecutableSection,
	machine: MachineSection,
	repository: RepositorySection,
};

/**
 * The app's own settings, with the sections down the side. Each section saves
 * its own values with its own Save. Every section stays mounted and only the
 * one chosen shows, so what was typed in one is still there after looking at
 * another. While a section saves, the dialog cannot be closed and the
 * sections cannot be switched, so its answer is never lost.
 *
 * The list groups the sections under headings, with About on its own at
 * the foot. Each section scrolls on its own, below the list's fixed place,
 * with its Save in a bar along the bottom.
 *
 * Under "Timber", Executable picks which Timber the app runs, an app
 * preference like the others. The Machine and Repository sections show Timber's own
 * settings, read through Timber each time the dialog opens, in groups that
 * each save through Timber with their own Save. The app never writes
 * Timber's files itself.
 */
export function SettingsDialog({ initialSection }: { initialSection: SettingsSection }) {
	const store = useStore();
	const problem = useAppState().preferencesProblem;
	const dialog = useRef<HTMLDialogElement>(null);
	const current = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const idPrefix = useId();
	const [section, setSection] = useState<SettingsSection>(initialSection);
	// The count is read from the ref when asked to close, because a key can arrive before the next render.
	const savingCount = useRef(0);
	const [saving, setSaving] = useState(false);

	const reportSaving = useCallback((started: boolean) => {
		savingCount.current += started ? 1 : -1;
		setSaving(savingCount.current > 0);
	}, []);
	const savingContext = useMemo(() => ({ reportSaving }), [reportSaving]);

	// Opened as a modal, so the rest of the window is inert and focus stays inside. Focus starts on the section that shows.
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		current.current?.focus();
		return () => element?.close();
	}, []);

	const close = () => {
		if (savingCount.current === 0) store.closeDialog();
	};
	const navId = (candidate: SettingsSection) => `${idPrefix}-nav-${candidate}`;
	const panelId = (candidate: SettingsSection) => `${idPrefix}-panel-${candidate}`;
	const navItem = (candidate: SettingsSection) => (
		<button
			key={candidate}
			ref={candidate === section ? current : undefined}
			type="button"
			id={navId(candidate)}
			className={candidate === section ? "settings-nav-item selected" : "settings-nav-item"}
			aria-current={candidate === section ? "page" : undefined}
			aria-controls={panelId(candidate)}
			disabled={saving && candidate !== section}
			onClick={() => setSection(candidate)}
		>
			<SettingsSectionIcon section={candidate} />
			{SETTINGS_SECTION_LABELS[candidate]}
		</button>
	);

	return (
		<dialog
			ref={dialog}
			className="dialog settings-dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				// Escape asks to close, through the store, so the store stays the one that says what is open.
				event.preventDefault();
				close();
			}}
		>
			<div className="settings-body">
				<nav className="settings-nav" aria-label="Settings sections">
					<h2 id={titleId} className="dialog-title">Settings</h2>
					{SETTINGS_NAV_GROUPS.map(group => (
						<div key={group.label} className="settings-nav-section">
							<p className="settings-nav-group">{group.label}</p>
							{group.sections.map(navItem)}
						</div>
					))}
					<div className="settings-nav-foot">{navItem(SETTINGS_NAV_FOOT)}</div>
				</nav>
				<div className="settings-main">
					{problem !== null && (
						<div className="sidebar-error settings-problem" role="alert">
							<p className="sidebar-error-title">Could not read the saved settings</p>
							<p className="sidebar-error-text">{problem}</p>
							<p className="sidebar-error-text">The defaults are shown. Saving a section writes them anew.</p>
						</div>
					)}
					<SettingsSavingContext value={savingContext}>
						{SETTINGS_SECTIONS.map(candidate => {
							const View = SECTION_VIEWS[candidate];
							return (
								<div key={candidate} className="settings-panel" id={panelId(candidate)} aria-labelledby={navId(candidate)} hidden={candidate !== section}>
									<View />
								</div>
							);
						})}
					</SettingsSavingContext>
				</div>
			</div>
			<button type="button" className="settings-close" aria-label="Close" title="Close" disabled={saving} onClick={close}>
				<CloseIcon />
			</button>
		</dialog>
	);
}
