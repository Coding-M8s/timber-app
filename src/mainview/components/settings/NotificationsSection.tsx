import { useState } from "react";
import { useAppState } from "../../store/react";
import { type SectionSave, SettingsSection, useSectionSave } from "./SettingsSection";

export interface NotificationsSectionViewProps {
	enabled: boolean;
	saved: boolean;
	save: SectionSave;
	onEdit: (enabled: boolean) => void;
	onSave: () => void;
}

/** The Notifications section as drawn from its data, so it can be tested without a window. */
export function NotificationsSectionView({ enabled, saved, save, onEdit, onSave }: NotificationsSectionViewProps) {
	return (
		<SettingsSection
			title="Notifications"
			description="Agents that support the Program Status Protocol, such as Claude Code and Codex, tell the app when they work, need you, or are done. The sidebar always shows it. A desktop notification can say it too, for a worktree that is not on screen."
			save={save}
			canSave={enabled !== saved}
			onSave={onSave}
		>
			<label className="check">
				<input type="checkbox" checked={enabled} onChange={event => onEdit(event.target.checked)} />
				<span className="check-text">
					Notify when an agent needs you or is done
					<span className="check-hint">
						Also when it reports an error or crashes. Never for the worktree on screen while the window has the focus. Clicking the notification shows the session.
					</span>
				</span>
			</label>
		</SettingsSection>
	);
}

/** The Notifications section of Settings: desktop notifications for agents' states on or off, saved with its own Save. */
export function NotificationsSection() {
	const saved = useAppState().preferences.statusNotifications;
	// Null follows what is saved, so the box only ever differs from it by what the person did.
	const [edited, setEdited] = useState<boolean | null>(null);
	const enabled = edited ?? saved;
	const { save, run, reset } = useSectionSave();

	const onEdit = (next: boolean) => {
		setEdited(next);
		reset();
	};
	const onSave = async () => {
		if (enabled === saved) return;
		if (await run({ statusNotifications: enabled })) setEdited(null);
	};

	return <NotificationsSectionView enabled={enabled} saved={saved} save={save} onEdit={onEdit} onSave={() => void onSave()} />;
}
