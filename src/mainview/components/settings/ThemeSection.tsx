import { useEffect, useId, useState } from "react";
import { freeName, newThemeId } from "../../../shared/custom-themes";
import { type Theme, type ThemeChoice, availableThemes, findTheme, resolveTheme, sameThemeChoice } from "../../../shared/theme";
import { useAppState, useStore } from "../../store/react";
import { applySavedTheme, previewTheme } from "../../theme-apply";
import { THEME_MODE_LABELS, type ContrastLevel, type ThemeDraft, choosing, draftFrom, draftModel, draftOf, switchThemeMode, themesFor, uses, withoutTheme } from "../../theme-format";
import { type SectionSave, SettingsSection, useSectionSave } from "./SettingsSection";
import { ThemeMakerView } from "./ThemeMaker";
import { ThemePreview } from "./ThemeSamples";

const THEME_MODES: readonly ThemeChoice["mode"][] = ["fixed", "system"];

function systemIsDark(): boolean {
	return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
}

interface ThemeGridProps {
	legend: string;
	name: string;
	themes: readonly Theme[];
	chosen: string;
	onChoose: (id: string) => void;
}

/** The themes as cards to pick one from, each a radio button with its picture. */
function ThemeGrid({ legend, name, themes, chosen, onChoose }: ThemeGridProps) {
	return (
		<fieldset className="theme-grid">
			<legend className="field-label">{legend}</legend>
			{themes.map(theme => (
				<label key={theme.id} className={theme.id === chosen ? "theme-card chosen" : "theme-card"}>
					<input className="theme-card-input" type="radio" name={name} value={theme.id} checked={theme.id === chosen} onChange={() => onChoose(theme.id)} />
					<ThemePreview theme={theme} />
					<span className="theme-card-name">{theme.name}</span>
				</label>
			))}
		</fieldset>
	);
}

/** What the last action on a theme file or a custom theme came to, shown under the list until the next one. */
export type ThemeNotice =
	| { kind: "done"; text: string }
	| { kind: "failed"; title: string; text: string };

export interface ThemeSectionViewProps {
	choice: ThemeChoice;
	saved: ThemeChoice;
	themes: readonly Theme[];
	custom: readonly Theme[];
	save: SectionSave;
	/** Waiting on a file dialog or a save, so the theme actions wait too. */
	busy: boolean;
	notice: ThemeNotice | null;
	/** The custom theme whose Delete asks to be confirmed, if any. */
	confirming: string | null;
	onChoose: (choice: ThemeChoice) => void;
	onSave: () => void;
	onNew: (from: string) => void;
	onEdit: (id: string) => void;
	onExport: (id: string) => void;
	onImport: () => void;
	onDelete: (id: string) => void;
	onConfirmDelete: (id: string | null) => void;
}

/** The person's own themes, each with Edit, Export, and Delete, and how to make or import another. */
function CustomThemes({ choice, saved, themes, custom, busy, notice, confirming, onNew, onEdit, onExport, onImport, onDelete, onConfirmDelete }: ThemeSectionViewProps) {
	const startId = useId();
	const inUse = resolveTheme(choice, systemIsDark(), themes).id;
	const [from, setFrom] = useState<string | null>(null);
	const start = from !== null && themes.some(theme => theme.id === from) ? from : inUse;
	return (
		<section className="custom-themes" aria-label="Your themes">
			<h4 className="field-label">Your themes</h4>
			{custom.length === 0 ? (
				<p className="field-hint">None yet. Make one from any theme, or import a theme file someone shared.</p>
			) : (
				<ul className="custom-theme-list">
					{custom.map(theme => (
						<li key={theme.id} className="custom-theme">
							{confirming === theme.id ? (
								<>
									<span className="custom-theme-question" role="alert">
										Delete {theme.name}?{uses(saved, theme.id) ? ` It is in use, so the app goes back to ${theme.appearance === "light" ? "Timber Light" : "Timber Dark"}.` : ""} This cannot be undone, unless you exported it.
									</span>
									<span className="custom-theme-actions">
										<button type="button" className="button danger" disabled={busy} onClick={() => onDelete(theme.id)}>Delete theme</button>
										<button type="button" className="button quiet" autoFocus onClick={() => onConfirmDelete(null)}>Keep</button>
									</span>
								</>
							) : (
								<>
									<span className="custom-theme-swatches" aria-hidden="true">
										{[theme.ui.bgMain, theme.ui.text, theme.ui.behind, theme.ui.ahead, theme.ui.error].map((color, index) => <span key={index} className="custom-theme-swatch" style={{ background: color }} />)}
									</span>
									<span className="custom-theme-name">
										{theme.name}
										{uses(saved, theme.id) && <span className="custom-theme-tag">In use</span>}
									</span>
									<span className="custom-theme-actions">
										<button type="button" className="button quiet" disabled={busy} aria-label={`Edit ${theme.name}`} onClick={() => onEdit(theme.id)}>Edit</button>
										<button type="button" className="button quiet" disabled={busy} aria-label={`Export ${theme.name}`} onClick={() => onExport(theme.id)}>Export</button>
										<button type="button" className="button quiet" disabled={busy} aria-label={`Delete ${theme.name}`} onClick={() => onConfirmDelete(theme.id)}>Delete</button>
									</span>
								</>
							)}
						</li>
					))}
				</ul>
			)}
			<div className="custom-theme-new">
				<label className="field-label" htmlFor={startId}>Start from</label>
				<select id={startId} className="field-input" value={start} disabled={busy} onChange={event => setFrom(event.target.value)}>
					{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
				</select>
				<button type="button" className="button" disabled={busy} onClick={() => onNew(start)}>New theme</button>
				<button type="button" className="button quiet" disabled={busy} onClick={onImport}>Import a theme file</button>
				<button type="button" className="button quiet" disabled={busy} onClick={() => onExport(start)}>Export this one</button>
			</div>
			{notice?.kind === "done" && <p className="settings-section-status" role="status">{notice.text}</p>}
			{notice?.kind === "failed" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">{notice.title}</p>
					<p className="sidebar-error-text">{notice.text}</p>
					<p className="sidebar-error-text">Nothing was changed.</p>
				</div>
			)}
		</section>
	);
}

/** The Theme section's picker as drawn from its data, so it can be tested without a window. */
export function ThemeSectionView(props: ThemeSectionViewProps) {
	const { choice, saved, themes, save, onChoose, onSave } = props;
	const name = useId();
	return (
		<SettingsSection
			title="Theme"
			description="The colors of the whole app, the terminals included. A theme shows as soon as you choose it, Save keeps it, and closing Settings without saving goes back to the saved one. The app remembers it in its own settings file."
			save={save}
			canSave={!sameThemeChoice(choice, saved)}
			onSave={onSave}
		>
			<fieldset className="settings-choice">
				<legend className="field-label">Use</legend>
				{THEME_MODES.map(mode => (
					<label key={mode} className="check">
						<input type="radio" name={`${name}-mode`} value={mode} checked={choice.mode === mode} onChange={() => onChoose(switchThemeMode(choice, mode, systemIsDark(), themes))} />
						<span className="check-text">{THEME_MODE_LABELS[mode]}</span>
					</label>
				))}
			</fieldset>
			{choice.mode === "fixed" ? (
				<ThemeGrid legend="Theme" name={`${name}-fixed`} themes={themes} chosen={choice.theme} onChoose={theme => onChoose({ mode: "fixed", theme })} />
			) : (
				<>
					<ThemeGrid legend="When the system is light" name={`${name}-light`} themes={themesFor("light", themes)} chosen={choice.light} onChoose={light => onChoose({ ...choice, light })} />
					<ThemeGrid legend="When the system is dark" name={`${name}-dark`} themes={themesFor("dark", themes)} chosen={choice.dark} onChoose={dark => onChoose({ ...choice, dark })} />
				</>
			)}
			<CustomThemes {...props} />
		</SettingsSection>
	);
}

/** The maker for one draft, with its own Save. */
function ThemeMaker({ draft: first, start, onDone }: { draft: ThemeDraft; start: Theme; onDone: () => void }) {
	const { theme: saved, customThemes } = useAppState().preferences;
	const [draft, setDraft] = useState(first);
	const [level, setLevel] = useState<ContrastLevel>("aa");
	const { save, run, reset } = useSectionSave();
	const themes = availableThemes(customThemes);

	const onSave = async () => {
		const theme = draftModel(draft, start, themes, level).theme;
		if (theme === null) return;
		const isNew = draft.id === null;
		const next = isNew ? [...customThemes, theme] : customThemes.map(other => other.id === theme.id ? theme : other);
		// A new theme is put to use. A changed one stays where it was used.
		const choice = isNew ? choosing(saved, theme) : saved;
		if (await run({ customThemes: next, theme: choice })) {
			applySavedTheme(choice, next);
			onDone();
		}
	};
	return (
		<ThemeMakerView
			draft={draft}
			start={start}
			themes={themes}
			level={level}
			save={save}
			onEdit={next => {
				setDraft(next);
				reset();
			}}
			onLevel={setLevel}
			onSave={() => void onSave()}
			onCancel={onDone}
		/>
	);
}

/** The picker, with the person's own themes. */
function ThemePicker({ onMake }: { onMake: (draft: ThemeDraft, start: Theme) => void }) {
	const store = useStore();
	const { theme: saved, customThemes } = useAppState().preferences;
	// Null follows what is saved, so a choice is only ever what the person picked.
	const [chosen, setChosen] = useState<ThemeChoice | null>(null);
	const choice = chosen ?? saved;
	const { save, run, reset } = useSectionSave();
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<ThemeNotice | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const themes = availableThemes(customThemes);

	// What is chosen shows at once. Leaving Settings without saving puts the saved theme back.
	useEffect(() => {
		previewTheme(chosen);
	}, [chosen]);
	useEffect(() => () => previewTheme(null), []);

	const onChoose = (next: ThemeChoice) => {
		setChosen(next);
		setNotice(null);
		reset();
	};
	const onSave = async () => {
		if (await run({ theme: choice })) {
			// Applied as saved before the preview is let go, so the old theme never shows in between.
			applySavedTheme(choice, customThemes);
			setChosen(null);
		}
	};
	/** Run one action on themes, with the actions put away until it ends. */
	const act = async (action: () => Promise<void>) => {
		setBusy(true);
		setNotice(null);
		try {
			await action();
		} finally {
			setBusy(false);
		}
	};
	const saveCustom = async (change: { customThemes: Theme[]; theme?: ThemeChoice }, done: string, failed: string): Promise<boolean> => {
		const result = await store.savePreferences(change);
		if (result.outcome === "saved") {
			applySavedTheme(result.preferences.theme, result.preferences.customThemes);
			setNotice({ kind: "done", text: done });
			return true;
		}
		setNotice({ kind: "failed", title: failed, text: result.message });
		return false;
	};

	const onExport = (id: string) => void act(async () => {
		const theme = findTheme(id, "dark", themes);
		const result = await store.exportTheme(theme);
		if (result.outcome === "exported") setNotice({ kind: "done", text: `Exported ${theme.name} to ${result.path}` });
		else if (result.outcome === "failed") setNotice({ kind: "failed", title: `Could not export ${theme.name}`, text: result.message });
	});
	const onImport = () => void act(async () => {
		const result = await store.importTheme();
		if (result.outcome === "cancelled") return;
		if (result.outcome === "refused") {
			setNotice({ kind: "failed", title: result.file === "" ? "Could not import a theme" : `Could not import ${result.file}`, text: result.reason });
			return;
		}
		const name = freeName(result.theme.name, themes);
		const theme: Theme = { ...result.theme, id: newThemeId(name, themes), name };
		const named = name === result.theme.name ? "" : `, as ${name} because that name was taken`;
		// Imported and kept at once; using it is a choice like any other, shown now and saved with Save.
		if (await saveCustom({ customThemes: [...customThemes, theme] }, `Imported ${result.theme.name}${named}. It shows now; Save to keep using it.`, "Could not add the imported theme")) {
			setChosen(choosing(choice, theme));
		}
	});
	const onDelete = (id: string) => void act(async () => {
		const theme = customThemes.find(other => other.id === id);
		setConfirming(null);
		if (!theme) return;
		// Where the theme is in use, the app's own theme of that slot takes its place, in the same save.
		const change = { customThemes: customThemes.filter(other => other.id !== id), theme: withoutTheme(saved, id) };
		if (await saveCustom(change, `Deleted ${theme.name}.`, `Could not delete ${theme.name}`) && chosen !== null) setChosen(withoutTheme(chosen, id));
	});
	const onNew = (from: string) => {
		const start = findTheme(from, "dark", themes);
		onMake(draftFrom(start, themes), start);
	};
	const onEdit = (id: string) => {
		const theme = customThemes.find(other => other.id === id);
		if (theme) onMake(draftOf(theme), theme);
	};

	return (
		<ThemeSectionView
			choice={choice}
			saved={saved}
			themes={themes}
			custom={customThemes}
			save={save}
			busy={busy || save.state === "saving"}
			notice={notice}
			confirming={confirming}
			onChoose={onChoose}
			onSave={() => void onSave()}
			onNew={onNew}
			onEdit={onEdit}
			onExport={onExport}
			onImport={onImport}
			onDelete={onDelete}
			onConfirmDelete={id => {
				setConfirming(id);
				setNotice(null);
			}}
		/>
	);
}

/**
 * How the app looks: one theme, or one for each of the system's light and
 * dark settings, and the person's own themes. Making or changing one shows
 * the maker in place of the picker until it is saved or cancelled.
 */
export function ThemeSection() {
	const [making, setMaking] = useState<{ draft: ThemeDraft; start: Theme } | null>(null);
	if (making !== null) return <ThemeMaker draft={making.draft} start={making.start} onDone={() => setMaking(null)} />;
	return <ThemePicker onMake={(draft, start) => setMaking({ draft, start })} />;
}
