import { useId } from "react";
import { APPEARANCES, type TerminalColor, type Theme, type UiColor } from "../../../shared/theme";
import {
	COLOR_GROUPS,
	CONTRAST_LEVELS,
	type ContrastLevel,
	type ThemeDraft,
	TERMINAL_COLOR_LABELS,
	UI_COLOR_LABELS,
	describeWarning,
	draftModel,
	pickedColor,
	pickerValue,
} from "../../theme-format";
import { type SectionSave, SettingsSection } from "./SettingsSection";
import { TerminalSample, ThemeSample } from "./ThemeSamples";

const APPEARANCE_LABELS = { dark: "Dark", light: "Light" } as const;

interface ColorRowProps {
	label: string;
	value: string;
	warned: string | null;
	invalid: boolean;
	onChange: (value: string) => void;
}

/** One color: a picker for the color, and the text, which also takes rgba() for see-through colors. */
function ColorRow({ label, value, warned, invalid, onChange }: ColorRowProps) {
	const id = useId();
	const hintId = useId();
	return (
		<div className="theme-color">
			<input className="theme-color-picker" type="color" aria-label={`${label}: pick a color`} value={pickerValue(value)} onChange={event => onChange(pickedColor(value, event.target.value))} />
			<label className="theme-color-label" htmlFor={id} title={label}>{label}</label>
			<input
				id={id}
				className="field-input mono theme-color-text"
				type="text"
				spellCheck={false}
				autoComplete="off"
				aria-invalid={invalid}
				aria-describedby={warned !== null || invalid ? hintId : undefined}
				value={value}
				onChange={event => onChange(event.target.value)}
			/>
			{invalid ? (
				<span id={hintId} className="theme-color-note error">Not a color</span>
			) : warned !== null ? (
				<span id={hintId} className="theme-color-note" title={warned}>Low contrast</span>
			) : null}
		</div>
	);
}

export interface ThemeMakerViewProps {
	draft: ThemeDraft;
	/** The theme the draft started from. */
	start: Theme;
	/** Every theme there is, to keep names apart. */
	themes: readonly Theme[];
	level: ContrastLevel;
	save: SectionSave;
	onEdit: (draft: ThemeDraft) => void;
	onLevel: (level: ContrastLevel) => void;
	onSave: () => void;
	onCancel: () => void;
}

/**
 * The theme maker, as drawn from its data so it can be tested without a
 * window: the name, whether the theme is dark or light, every color, the
 * contrast check, and previews of the interface and of a terminal that
 * change as the colors do.
 */
export function ThemeMakerView({ draft, start, themes, level, save, onEdit, onLevel, onSave, onCancel }: ThemeMakerViewProps) {
	const nameId = useId();
	const nameHintId = useId();
	const levelId = useId();
	const appearanceName = useId();
	const model = draftModel(draft, start, themes, level);
	const warningFor = (key: string) => {
		const found = model.warnings.filter(warning => warning.color === key);
		return found.length === 0 ? null : found.map(describeWarning).join("\n");
	};
	const setColor = (part: "ui" | "terminal", key: UiColor | TerminalColor, value: string) =>
		onEdit(part === "ui" ? { ...draft, ui: { ...draft.ui, [key]: value } } : { ...draft, terminal: { ...draft.terminal, [key]: value } });

	return (
		<SettingsSection
			title={draft.id === null ? "New theme" : `Edit ${start.name}`}
			description={draft.id === null
				? `A copy of ${start.name} to change. The previews follow every change. Save adds it to your themes and uses it.`
				: "The previews follow every change. Save keeps the changes, and the app redraws at once where the theme is in use."}
			save={save}
			canSave={model.theme !== null && model.changed}
			onSave={onSave}
			secondary={<button type="button" className="button quiet" onClick={onCancel}>Cancel</button>}
		>
			<div className="theme-maker">
				<div className="theme-maker-fields">
					<div className="field">
						<label className="field-label" htmlFor={nameId}>Name</label>
						<input
							id={nameId}
							className="field-input"
							type="text"
							autoComplete="off"
							maxLength={120}
							aria-invalid={model.nameError !== null}
							aria-describedby={model.nameError !== null ? nameHintId : undefined}
							value={draft.name}
							onChange={event => onEdit({ ...draft, name: event.target.value })}
						/>
						{model.nameError !== null && <span id={nameHintId} className="field-hint error">{model.nameError}</span>}
					</div>
					<fieldset className="settings-choice inline">
						<legend className="field-label">This theme is</legend>
						{APPEARANCES.map(appearance => (
							<label key={appearance} className="check">
								<input type="radio" name={appearanceName} value={appearance} checked={draft.appearance === appearance} onChange={() => onEdit({ ...draft, appearance })} />
								<span className="check-text">{APPEARANCE_LABELS[appearance]}</span>
							</label>
						))}
					</fieldset>
					<div className="field">
						<label className="field-label" htmlFor={levelId}>Check contrast against</label>
						<select id={levelId} className="field-input" value={level} onChange={event => onLevel(event.target.value as ContrastLevel)}>
							{(Object.keys(CONTRAST_LEVELS) as ContrastLevel[]).map(key => <option key={key} value={key}>{CONTRAST_LEVELS[key].label}</option>)}
						</select>
					</div>
					{model.warnings.length === 0 ? (
						<p className="theme-check clear" role="status">Every text and meaning color stands out enough from the surfaces it is drawn on.</p>
					) : (
						<div className="theme-check" role="status">
							<p className="theme-check-title">
								{model.warnings.length === 1 ? "1 color is" : `${model.warnings.length} colors are`} too close to what {model.warnings.length === 1 ? "it is" : "they are"} drawn on
							</p>
							<p className="theme-check-text">Color carries meaning in the app, so these can be hard to see. The theme can still be saved.</p>
							<ul className="theme-check-list">
								{model.warnings.map(warning => <li key={`${warning.color}-${warning.on}`}>{describeWarning(warning)}</li>)}
							</ul>
						</div>
					)}
					{COLOR_GROUPS.map(group => (
						<fieldset key={group.title} className="theme-colors">
							<legend className="field-label">{group.title}</legend>
							{group.keys.map(key => {
								const value = group.part === "ui" ? draft.ui[key as UiColor] : draft.terminal[key as TerminalColor];
								const label = group.part === "ui" ? UI_COLOR_LABELS[key as UiColor] : TERMINAL_COLOR_LABELS[key as TerminalColor];
								return (
									<ColorRow
										key={key}
										label={label}
										value={value}
										warned={warningFor(group.part === "ui" ? key : `terminal.${key}`)}
										invalid={model.unreadable.includes(`${group.part}.${key}`)}
										onChange={next => setColor(group.part, key, next)}
									/>
								);
							})}
						</fieldset>
					))}
				</div>
				<div className="theme-maker-preview">
					<ThemeSample theme={model.preview} />
					<TerminalSample colors={model.preview.terminal} />
				</div>
			</div>
		</SettingsSection>
	);
}
