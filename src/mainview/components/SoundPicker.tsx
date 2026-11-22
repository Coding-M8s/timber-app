import { BUNDLED_SOUNDS, BUNDLED_SOUND_LABELS, type SoundChoice, soundFileName } from "../../shared/sound-setting";
import { pickSound, soundOptionOf } from "../notifications-format";

export interface SoundPickerProps {
	/** What the controls are named for assistive technology: "Sound: <label>", "Play sound: <label>", "Choose file: <label>". */
	label: string;
	/** The id of the select, for a visible label, if one is drawn. */
	id?: string;
	sound: SoundChoice | null;
	/** The file "Your own file" last chose, saved or not, so switching back to it finds it. */
	customPath: string | undefined;
	disabled: boolean;
	/** A sound was picked, or None with null. */
	onPick: (sound: SoundChoice | null) => void;
	/** Ask for a file of the person's own. */
	onChooseFile: () => void;
	/** Play the sound picked, as a preview. */
	onPlay: () => void;
}

/**
 * A sound to choose, with Play to try it: None, a sound that comes with the
 * app, the system's, or a file of the person's own, with Choose file. Used
 * by Settings, Notifications for each state and by the chops for each chop.
 * Its buttons never submit a form it is in.
 */
export function SoundPicker({ label, id, sound, customPath, disabled, onPick, onChooseFile, onPlay }: SoundPickerProps) {
	const choose = (value: string) => {
		const picked = pickSound(value, customPath);
		if (picked?.kind === "set") onPick(picked.sound);
		else if (picked?.kind === "choose-file") onChooseFile();
	};
	return (
		<>
			<select id={id} className="field-input" aria-label={id === undefined ? `Sound: ${label}` : undefined} value={soundOptionOf(sound)} disabled={disabled} onChange={event => choose(event.target.value)}>
				<option value="none">None</option>
				{BUNDLED_SOUNDS.map(name => <option key={name} value={`bundled:${name}`}>{BUNDLED_SOUND_LABELS[name]}</option>)}
				<option value="system">System sound</option>
				<option value="custom">{customPath === undefined ? "Your own file..." : `Your own file: ${soundFileName(customPath)}`}</option>
			</select>
			<span className="alert-state-actions">
				<button type="button" className="button quiet" aria-label={`Play sound: ${label}`} disabled={disabled || sound === null} onClick={onPlay}>Play</button>
				{sound?.kind === "custom" && <button type="button" className="button quiet" aria-label={`Choose file: ${label}`} disabled={disabled} onClick={onChooseFile}>Choose file</button>}
			</span>
		</>
	);
}
