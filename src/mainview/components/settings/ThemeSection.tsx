import { type CSSProperties, useEffect, useId, useState } from "react";
import { type Theme, type ThemeChoice, availableThemes, sameThemeChoice, themeVariables } from "../../../shared/theme";
import { useAppState } from "../../store/react";
import { applySavedTheme, previewTheme } from "../../theme-apply";
import { THEME_MODE_LABELS, switchThemeMode, themesFor } from "../../theme-format";
import { type SectionSave, SettingsSection, useSectionSave } from "./SettingsSection";

const THEME_MODES: readonly ThemeChoice["mode"][] = ["fixed", "system"];

function systemIsDark(): boolean {
	return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
}

/**
 * A small picture of the app in a theme: a sidebar with a selected row, a
 * diff, and a line of terminal colors. It sets the theme's custom
 * properties on itself, so everything inside is drawn in that theme.
 */
export function ThemePreview({ theme }: { theme: Theme }) {
	const ansi = [theme.terminal.red, theme.terminal.green, theme.terminal.yellow, theme.terminal.blue, theme.terminal.magenta, theme.terminal.cyan];
	return (
		<span className="theme-preview" style={themeVariables(theme) as CSSProperties} aria-hidden="true">
			<span className="theme-preview-sidebar">
				<span className="theme-preview-row selected">
					<span className="theme-preview-text" />
					<span className="theme-preview-dot" style={{ background: "var(--ahead)" }} />
				</span>
				<span className="theme-preview-row">
					<span className="theme-preview-text faint" />
					<span className="theme-preview-dot" style={{ background: "var(--behind)" }} />
				</span>
				<span className="theme-preview-row">
					<span className="theme-preview-text faint" />
					<span className="theme-preview-dot" style={{ background: "var(--modified)" }} />
				</span>
			</span>
			<span className="theme-preview-main">
				<span className="theme-preview-line" />
				<span className="theme-preview-line added" />
				<span className="theme-preview-line removed" />
				<span className="theme-preview-terminal" style={{ background: theme.terminal.background }}>
					{ansi.map((color, index) => <span key={index} className="theme-preview-swatch" style={{ background: color }} />)}
				</span>
			</span>
		</span>
	);
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

export interface ThemeSectionViewProps {
	choice: ThemeChoice;
	saved: ThemeChoice;
	themes: readonly Theme[];
	save: SectionSave;
	onChoose: (choice: ThemeChoice) => void;
	onSave: () => void;
}

/** The Theme section as drawn from its data, so it can be tested without a window. */
export function ThemeSectionView({ choice, saved, themes, save, onChoose, onSave }: ThemeSectionViewProps) {
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
		</SettingsSection>
	);
}

/** How the app looks: one theme, or one for each of the system's light and dark settings. */
export function ThemeSection() {
	const saved = useAppState().preferences.theme;
	// Null follows what is saved, so a choice is only ever what the person picked.
	const [chosen, setChosen] = useState<ThemeChoice | null>(null);
	const choice = chosen ?? saved;
	const { save, run, reset } = useSectionSave();

	// What is chosen shows at once. Leaving Settings without saving puts the saved theme back.
	useEffect(() => {
		previewTheme(chosen);
	}, [chosen]);
	useEffect(() => () => previewTheme(null), []);

	const onChoose = (next: ThemeChoice) => {
		setChosen(next);
		reset();
	};
	const onSave = async () => {
		if (await run({ theme: choice })) {
			// Applied as saved before the preview is let go, so the old theme never shows in between.
			applySavedTheme(choice);
			setChosen(null);
		}
	};
	return <ThemeSectionView choice={choice} saved={saved} themes={availableThemes()} save={save} onChoose={onChoose} onSave={() => void onSave()} />;
}
