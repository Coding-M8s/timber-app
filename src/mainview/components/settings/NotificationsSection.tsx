import { useId, useState } from "react";
import { type Preferences, readAlertStates } from "../../../shared/preferences";
import { BUNDLED_SOUNDS, BUNDLED_SOUND_LABELS, type SoundChoice, type SoundOutcome, sameSoundChoice, soundFileName } from "../../../shared/sound-setting";
import { ALERT_STATES, type AlertState } from "../../../shared/status-notices";
import { useAppState, useStore } from "../../store/react";
import { type SectionSave, SettingsSection, useSectionSave } from "./SettingsSection";

/** What the section edits: the parts of the preferences it saves. */
export interface NotificationsDraft {
	statusNotifications: boolean;
	notifyStates: readonly AlertState[];
	soundStates: readonly AlertState[];
	sound: SoundChoice;
}

export function notificationsDraftOf(preferences: Preferences): NotificationsDraft {
	const { statusNotifications, notifyStates, soundStates, sound } = preferences;
	return { statusNotifications, notifyStates, soundStates, sound };
}

export function sameNotificationsDraft(one: NotificationsDraft, other: NotificationsDraft): boolean {
	const sameStates = (left: readonly AlertState[], right: readonly AlertState[]) => left.length === right.length && left.every(state => right.includes(state));
	return one.statusNotifications === other.statusNotifications && sameStates(one.notifyStates, other.notifyStates)
		&& sameStates(one.soundStates, other.soundStates) && sameSoundChoice(one.sound, other.sound);
}

/** A list of statuses with one turned on or off, kept in Settings order. */
export function toggleState(states: readonly AlertState[], state: AlertState, on: boolean): AlertState[] {
	return readAlertStates(on ? [...states, state] : states.filter(other => other !== state)) ?? [];
}

const STATE_LABELS: Record<AlertState, string> = {
	"needs-you": "Needs you",
	"done": "Done",
	"error": "Error",
	"crashed": "Crashed",
};

/** The sound picker's value for a choice: `bundled:<name>`, `system`, or `custom`. */
function optionOf(choice: SoundChoice): string {
	return choice.kind === "bundled" ? `bundled:${choice.name}` : choice.kind;
}

/** Words for a preview that did not play. Null when it played. */
export function describeSoundOutcome(outcome: SoundOutcome): string | null {
	switch (outcome.outcome) {
		case "played":
			return null;
		case "busy":
			return "Another sound is still playing. Try again in a moment.";
		case "no-player":
			return "No program that can play this sound was found. On Linux the app uses pw-play, paplay, or aplay.";
		case "missing":
			return "The sound file is not there any more. Choose it again.";
		case "failed":
			return "The sound could not be played. The file may be of a kind the player cannot read.";
	}
}

export interface NotificationsSectionViewProps {
	draft: NotificationsDraft;
	saved: NotificationsDraft;
	save: SectionSave;
	/** What went wrong with the last preview or file choice, or null. */
	problem: string | null;
	/** The file the person chose but has not saved yet, kept so switching back to "Your own file" finds it. */
	customPath: string | null;
	onEdit: (change: Partial<NotificationsDraft>) => void;
	onChooseFile: () => void;
	onPlay: () => void;
	onSave: () => void;
}

/** The Notifications section as drawn from its data, so it can be tested without a window. */
export function NotificationsSectionView({ draft, saved, save, problem, customPath, onEdit, onChooseFile, onPlay, onSave }: NotificationsSectionViewProps) {
	const soundId = useId();
	const soundHintId = useId();
	const busy = save.state === "saving";
	const anySound = draft.soundStates.length > 0;
	const chooseSound = (value: string) => {
		if (value === "system") onEdit({ sound: { kind: "system" } });
		else if (value === "custom") {
			if (customPath !== null) onEdit({ sound: { kind: "custom", path: customPath } });
			else onChooseFile();
		} else {
			const name = BUNDLED_SOUNDS.find(sound => `bundled:${sound}` === value);
			if (name) onEdit({ sound: { kind: "bundled", name } });
		}
	};
	return (
		<SettingsSection
			title="Notifications"
			description="Agents that support the Program Status Protocol, such as Claude Code and Codex, tell the app when they work, need you, or are done. The sidebar always shows it. A desktop notification and a sound can say it too, for a worktree that is not on screen."
			save={save}
			canSave={!sameNotificationsDraft(draft, saved)}
			onSave={onSave}
		>
			<label className="check">
				<input type="checkbox" checked={draft.statusNotifications} disabled={busy} onChange={event => onEdit({ statusNotifications: event.target.checked })} />
				<span className="check-text">
					Show desktop notifications
					<span className="check-hint">
						Never for the worktree on screen while the window has the focus. Clicking one shows the session. Each session has at most one, taken away once it no longer holds.
					</span>
				</span>
			</label>
			<fieldset className="settings-choice alert-states">
				<legend className="field-label">When an agent</legend>
				<span className="alert-states-head" aria-hidden="true">Notify</span>
				<span className="alert-states-head" aria-hidden="true">Sound</span>
				{ALERT_STATES.map(state => (
					<div key={state} className="alert-state">
						<span className="alert-state-name" aria-hidden="true">{STATE_LABELS[state]}</span>
						<label className="check">
							<input
								type="checkbox"
								aria-label={`Notify: ${STATE_LABELS[state]}`}
								checked={draft.notifyStates.includes(state)}
								disabled={busy || !draft.statusNotifications}
								onChange={event => onEdit({ notifyStates: toggleState(draft.notifyStates, state, event.target.checked) })}
							/>
						</label>
						<label className="check">
							<input
								type="checkbox"
								aria-label={`Sound: ${STATE_LABELS[state]}`}
								checked={draft.soundStates.includes(state)}
								disabled={busy}
								onChange={event => onEdit({ soundStates: toggleState(draft.soundStates, state, event.target.checked) })}
							/>
						</label>
					</div>
				))}
			</fieldset>
			<div className="field">
				<label className="field-label" htmlFor={soundId}>Sound</label>
				<div className="sound-row">
					<select id={soundId} className="field-input" aria-describedby={soundHintId} value={optionOf(draft.sound)} disabled={busy} onChange={event => chooseSound(event.target.value)}>
						{BUNDLED_SOUNDS.map(sound => <option key={sound} value={`bundled:${sound}`}>{BUNDLED_SOUND_LABELS[sound]}</option>)}
						<option value="system">System sound</option>
						<option value="custom">{customPath === null ? "Your own file..." : `Your own file: ${soundFileName(customPath)}`}</option>
					</select>
					{draft.sound.kind === "custom" && <button type="button" className="button quiet" disabled={busy} onClick={onChooseFile}>Choose file</button>}
					<button type="button" className="button quiet" disabled={busy} onClick={onPlay}>Play</button>
				</div>
				<span id={soundHintId} className="field-hint">
					{anySound ? "Plays for the states ticked under Sound, with the same rules as notifications." : "Tick a state under Sound to hear it. Off until then."}
					{" "}Your own file can be WAV, Ogg, FLAC, MP3, or AIFF.
				</span>
			</div>
			{problem !== null && <p className="field-hint error" role="alert">{problem}</p>}
		</SettingsSection>
	);
}

/** The Notifications section of Settings: which states notify, which play a sound, and the sound, saved with its own Save. */
export function NotificationsSection() {
	const store = useStore();
	const saved = notificationsDraftOf(useAppState().preferences);
	// Null follows what is saved, so the fields only ever differ from it by what the person did.
	const [edited, setEdited] = useState<NotificationsDraft | null>(null);
	const draft = edited ?? saved;
	const [chosenPath, setChosenPath] = useState<string | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const { save, run, reset } = useSectionSave();
	const customPath = chosenPath ?? (saved.sound.kind === "custom" ? saved.sound.path : null);

	const onEdit = (change: Partial<NotificationsDraft>) => {
		setEdited({ ...draft, ...change });
		setProblem(null);
		reset();
	};
	const onChooseFile = async () => {
		const result = await store.chooseSoundFile();
		if (result.outcome === "chosen") {
			setChosenPath(result.path);
			// From the draft as it is now, not as it was when the dialog opened, so boxes ticked meanwhile are kept.
			setEdited(current => ({ ...(current ?? saved), sound: { kind: "custom", path: result.path } }));
			setProblem(null);
			reset();
		} else if (result.outcome === "refused") setProblem(result.message);
	};
	const onPlay = async () => {
		setProblem(describeSoundOutcome(await store.playSound(draft.sound)));
	};
	const onSave = async () => {
		if (sameNotificationsDraft(draft, saved)) return;
		if (await run({ ...draft })) setEdited(null);
	};

	return (
		<NotificationsSectionView
			draft={draft}
			saved={saved}
			save={save}
			problem={problem}
			customPath={customPath}
			onEdit={onEdit}
			onChooseFile={() => void onChooseFile()}
			onPlay={() => void onPlay()}
			onSave={() => void onSave()}
		/>
	);
}
