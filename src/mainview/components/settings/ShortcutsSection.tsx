import { useId, useState } from "react";
import {
	CHOP_SHORTCUT_IDS, DEFAULT_SHORTCUTS, SHORTCUT_IDS, SHORTCUT_LABELS, type ShortcutContext, type ShortcutId, type ShortcutSettings, chordLetterOf, describeChord, pressedKeyProblem, sameShortcuts,
	shortcutLetter, shortcutProblem, withShortcut,
} from "../../../shared/shortcuts";
import { useAppState } from "../../store/react";
import { type SectionSave, SettingsSection, useDraftSection } from "./SettingsSection";

/** The modifier keys, which a shortcut field lets pass while the chord is being pressed. */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"]);

/** The shortcuts Settings lists: every one, without the chop shortcuts while "Use chops" is off. */
export function listedShortcuts(useChops: boolean): ShortcutId[] {
	return SHORTCUT_IDS.filter(id => useChops || !CHOP_SHORTCUT_IDS.includes(id));
}

/** The app's keys that cannot be changed, as Settings lists them under the ones that can. */
export function fixedKeys(mac: boolean): { keys: string; words: string }[] {
	return mac
		? [
			{ keys: "Cmd+Shift+[ and Cmd+Shift+]", words: "Go to the previous or next session of the worktree, from a terminal" },
			{ keys: "Cmd+C and Cmd+V", words: "Copy and paste in a terminal" },
			{ keys: "Cmd+=, Cmd+-, and Cmd+0", words: "Zoom in, zoom out, and back to 100%" },
		]
		: [
			{ keys: "Ctrl+PageUp and Ctrl+PageDown", words: "Go to the previous or next session of the worktree, from a terminal" },
			{ keys: "Ctrl+Shift+C and Ctrl+Shift+V", words: "Copy and paste in a terminal" },
			{ keys: "Ctrl+=, Ctrl+-, and Ctrl+0", words: "Zoom in, zoom out, and back to 100%" },
		];
}

/**
 * One shortcut, set by pressing it: the field shows the key as set, and
 * takes the next Ctrl+Shift and a letter (Cmd+Shift on macOS) pressed in
 * it. A key that is taken, by a terminal, the text editor, or another
 * shortcut, is refused with the reason, and the key shown stays. Tab and
 * Escape do what they always do. Reset goes back to the default.
 */
export function ShortcutField({ id, settings, context, onChange }: { id: ShortcutId; settings: ShortcutSettings; context: ShortcutContext; onChange: (next: ShortcutSettings) => void }) {
	const fieldId = useId();
	const [problem, setProblem] = useState<string | null>(null);
	const mac = context.mac ?? false;
	const label = SHORTCUT_LABELS[id];
	const letter = shortcutLetter(settings, id);
	const isDefault = letter === DEFAULT_SHORTCUTS[id];
	return (
		<div className="field shortcut-field" data-shortcut={id}>
			<label className="field-label" htmlFor={fieldId}>{label}</label>
			<div className="shortcut-row">
				<input
					id={fieldId}
					className="field-input mono"
					type="text"
					readOnly
					value={describeChord(letter, mac)}
					aria-describedby={`${fieldId}-hint`}
					aria-invalid={problem !== null}
					onKeyDown={event => {
						if (event.key === "Tab" || event.key === "Escape" || MODIFIER_KEYS.has(event.key)) return;
						event.preventDefault();
						const pressed = chordLetterOf(event.nativeEvent);
						if (pressed === null) return setProblem(pressedKeyProblem(event.nativeEvent, mac));
						const refused = pressed === letter ? null : shortcutProblem(id, pressed, settings, context);
						setProblem(refused);
						if (refused === null && pressed !== letter) onChange(withShortcut(settings, id, pressed));
					}}
					onBlur={event => {
						// The error stays while the keyboard goes to Reset, which may say its own.
						if (!(event.relatedTarget instanceof HTMLElement && event.currentTarget.parentElement?.contains(event.relatedTarget))) setProblem(null);
					}}
				/>
				{!isDefault && (
					<button
						type="button"
						className="button quiet"
						aria-label={`Reset ${label} to ${describeChord(DEFAULT_SHORTCUTS[id], mac)}`}
						onClick={() => {
							const refused = shortcutProblem(id, DEFAULT_SHORTCUTS[id], settings, context);
							setProblem(refused);
							if (refused === null) onChange(withShortcut(settings, id, DEFAULT_SHORTCUTS[id]));
						}}
					>
						Reset
					</button>
				)}
			</div>
			{problem === null
				? <span id={`${fieldId}-hint`} className="field-hint">{isDefault ? "The default." : `The default is ${describeChord(DEFAULT_SHORTCUTS[id], mac)}.`}</span>
				: <span id={`${fieldId}-hint`} className="field-error" role="alert">{problem}</span>}
		</div>
	);
}

export interface ShortcutsSectionViewProps {
	/** Whether to name the keys as on macOS: Cmd for Ctrl. */
	mac?: boolean;
	/** The keys as shown: what is saved, or what the person pressed. */
	shortcuts: ShortcutSettings;
	/** "Use chops" as saved: off, the chop shortcuts are not listed. */
	useChops: boolean;
	canSave: boolean;
	save: SectionSave;
	onChange: (next: ShortcutSettings) => void;
	onSave: () => void;
}

/** Settings, Shortcuts as drawn from its data, so it can be tested without a window. */
export function ShortcutsSectionView({ mac = false, shortcuts, useChops, canSave, save, onChange, onSave }: ShortcutsSectionViewProps) {
	const fixedId = useId();
	const context: ShortcutContext = { mac, useChops };
	const modifier = mac ? "Cmd" : "Ctrl";
	return (
		<SettingsSection
			title="Shortcuts"
			description={`The app's keys, each ${modifier}+Shift and a letter. To change one, focus its field and press the new key. A key that a terminal or the text editor keeps, or that another shortcut has, is refused with the reason. They are kept in the app's settings file.`}
			save={save}
			canSave={canSave}
			onSave={onSave}
		>
			<div className="shortcut-fields">
				{listedShortcuts(useChops).map(id => <ShortcutField key={id} id={id} settings={shortcuts} context={context} onChange={onChange} />)}
			</div>
			{!useChops && <p className="field-hint">The chop shortcuts are listed here while Use chops is on, in Settings, Chops.</p>}
			<section className="shortcut-fixed" aria-labelledby={fixedId}>
				<h4 id={fixedId} className="timber-block-title">Keys that stay as they are</h4>
				<p className="field-hint">These follow the ways of terminals and browsers.</p>
				<dl className="shortcut-fixed-list">
					{fixedKeys(mac).map(entry => (
						<div key={entry.keys} className="shortcut-fixed-row">
							<dt className="mono">{entry.keys}</dt>
							<dd>{entry.words}</dd>
						</div>
					))}
				</dl>
			</section>
		</SettingsSection>
	);
}

/**
 * Settings, Shortcuts: every app shortcut with its key as set, each changed
 * by pressing the new key or reset to its default, and saved with the
 * section's Save. It is the only section that saves `shortcuts`, so no two
 * drafts of them write over each other.
 */
export function ShortcutsSection() {
	const state = useAppState();
	const saved = state.preferences.shortcuts;
	const { draft, save, change, commit } = useDraftSection(saved);
	const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
	const canSave = !sameShortcuts(draft, saved);
	return (
		<ShortcutsSectionView
			mac={mac}
			shortcuts={draft}
			useChops={state.preferences.useChops}
			canSave={canSave}
			save={save}
			onChange={change}
			onSave={() => {
				if (canSave) void commit({ shortcuts: draft });
			}}
		/>
	);
}
