import { useId, useState } from "react";
import { BUNDLED_SOUNDS, BUNDLED_SOUND_LABELS, soundFileName } from "../../../shared/sound-setting";
import { ALERT_STATES, type AlertState } from "../../../shared/status-notices";
import { type NotificationsDraft, describeSoundOutcome, notificationsDraftOf, sameNotificationsDraft, pickSound, soundOptionOf, toggleState, withStateSound } from "../../notifications-format";
import { useAppState, useStore } from "../../store/react";
import { type SectionSave, SettingsSection, useDraftSection } from "./SettingsSection";

const STATE_LABELS: Record<AlertState, string> = {
	"needs-you": "Needs you",
	"done": "Done",
	"error": "Error",
	"crashed": "Crashed",
};

export interface NotificationsSectionViewProps {
	draft: NotificationsDraft;
	saved: NotificationsDraft;
	save: SectionSave;
	/** What went wrong with the last preview or file choice, or null. */
	problem: string | null;
	/** The file each state's row last chose, saved or not, so switching back to "Your own file" finds it. */
	customPaths: Partial<Record<AlertState, string>>;
	onEdit: (change: Partial<NotificationsDraft>) => void;
	onChooseFile: (state: AlertState) => void;
	onPlay: (state: AlertState) => void;
	onSave: () => void;
}

/** The Notifications section as drawn from its data, so it can be tested without a window. */
export function NotificationsSectionView({ draft, saved, save, problem, customPaths, onEdit, onChooseFile, onPlay, onSave }: NotificationsSectionViewProps) {
	const hintId = useId();
	const busy = save.state === "saving";
	const chooseSound = (state: AlertState, value: string) => {
		const picked = pickSound(value, customPaths[state]);
		if (picked?.kind === "set") onEdit({ sounds: withStateSound(draft.sounds, state, picked.sound) });
		else if (picked?.kind === "choose-file") onChooseFile(state);
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
			<fieldset className="settings-choice alert-states" aria-describedby={hintId}>
				<legend className="field-label">When an agent</legend>
				<span className="alert-states-head alert-states-notify" aria-hidden="true">Notify</span>
				<span className="alert-states-head" aria-hidden="true">Sound</span>
				{ALERT_STATES.map(state => {
					const label = STATE_LABELS[state];
					const sound = draft.sounds[state];
					const customPath = customPaths[state];
					return (
						<div key={state} className="alert-state">
							<span className="alert-state-name" aria-hidden="true">{label}</span>
							<label className="check">
								<input
									type="checkbox"
									aria-label={`Notify: ${label}`}
									checked={draft.notifyStates.includes(state)}
									disabled={busy || !draft.statusNotifications}
									onChange={event => onEdit({ notifyStates: toggleState(draft.notifyStates, state, event.target.checked) })}
								/>
							</label>
							<select className="field-input" aria-label={`Sound: ${label}`} value={soundOptionOf(sound)} disabled={busy} onChange={event => chooseSound(state, event.target.value)}>
								<option value="none">None</option>
								{BUNDLED_SOUNDS.map(name => <option key={name} value={`bundled:${name}`}>{BUNDLED_SOUND_LABELS[name]}</option>)}
								<option value="system">System sound</option>
								<option value="custom">{customPath === undefined ? "Your own file..." : `Your own file: ${soundFileName(customPath)}`}</option>
							</select>
							<span className="alert-state-actions">
								<button type="button" className="button quiet" aria-label={`Play sound: ${label}`} disabled={busy || sound === null} onClick={() => onPlay(state)}>Play</button>
								{sound?.kind === "custom" && <button type="button" className="button quiet" aria-label={`Choose file: ${label}`} disabled={busy} onClick={() => onChooseFile(state)}>Choose file</button>}
							</span>
						</div>
					);
				})}
			</fieldset>
			<span id={hintId} className="field-hint">
				Each state plays its own sound, with the same rules as notifications. None until you choose one. One sound plays at a time, for at most 4 seconds.
				{" "}Your own file can be WAV, Ogg, FLAC, MP3, or AIFF.
			</span>
			{problem !== null && <p className="field-hint error" role="alert">{problem}</p>}
		</SettingsSection>
	);
}

/** The Notifications section of Settings: which states notify, and the sound each plays, saved with its own Save. */
export function NotificationsSection() {
	const store = useStore();
	const saved = notificationsDraftOf(useAppState().preferences);
	const { draft, save, change, commit } = useDraftSection(saved);
	const [chosenPaths, setChosenPaths] = useState<Partial<Record<AlertState, string>>>({});
	const [problem, setProblem] = useState<string | null>(null);
	const customPaths: Partial<Record<AlertState, string>> = {};
	for (const state of ALERT_STATES) {
		const savedSound = saved.sounds[state];
		const path = chosenPaths[state] ?? (savedSound?.kind === "custom" ? savedSound.path : undefined);
		if (path !== undefined) customPaths[state] = path;
	}

	const onEdit = (edit: Partial<NotificationsDraft>) => {
		change({ ...draft, ...edit });
		setProblem(null);
	};
	const onChooseFile = async (state: AlertState) => {
		const result = await store.chooseSoundFile();
		if (result.outcome === "chosen") {
			setChosenPaths(current => ({ ...current, [state]: result.path }));
			// From the draft as it is now, not as it was when the dialog opened, so changes made meanwhile are kept.
			change(current => ({ ...current, sounds: withStateSound(current.sounds, state, { kind: "custom", path: result.path }) }));
			setProblem(null);
		} else if (result.outcome === "refused") setProblem(`${STATE_LABELS[state]}: ${result.message}`);
	};
	const onPlay = async (state: AlertState) => {
		const sound = draft.sounds[state];
		if (sound === null) return;
		const said = describeSoundOutcome(await store.playSound(sound));
		setProblem(said === null ? null : `${STATE_LABELS[state]}: ${said}`);
	};
	const onSave = async () => {
		if (sameNotificationsDraft(draft, saved)) return;
		await commit({ ...draft });
	};

	return (
		<NotificationsSectionView
			draft={draft}
			saved={saved}
			save={save}
			problem={problem}
			customPaths={customPaths}
			onEdit={onEdit}
			onChooseFile={state => void onChooseFile(state)}
			onPlay={state => void onPlay(state)}
			onSave={() => void onSave()}
		/>
	);
}
