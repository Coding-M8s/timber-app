import { useState } from "react";
import { SIDEBAR_SIDES, type SidebarSide } from "../../../shared/preferences";
import { SIDEBAR_SIDE_LABELS } from "../../shell";
import { useAppState } from "../../store/react";
import { SettingsSection, useSectionSave } from "./SettingsSection";

/** Where the window's parts go. Today that is the side of the sidebar. */
export function LayoutSection() {
	const saved = useAppState().preferences.sidebarSide;
	// Null follows what is saved, so a choice is only ever what the person picked.
	const [chosen, setChosen] = useState<SidebarSide | null>(null);
	const side = chosen ?? saved;
	const { save, run, reset } = useSectionSave();

	const choose = (next: SidebarSide) => {
		setChosen(next);
		reset();
	};
	const onSave = async () => {
		if (await run({ sidebarSide: side })) setChosen(null);
	};

	return (
		<SettingsSection
			title="Layout"
			description="Where the sidebar sits in the window. It moves as soon as you save, and the app remembers it in its own settings file."
			save={save}
			canSave={side !== saved}
			onSave={() => void onSave()}
		>
			<fieldset className="settings-choice">
				<legend className="field-label">Sidebar side</legend>
				{SIDEBAR_SIDES.map(option => (
					<label key={option} className="check">
						<input type="radio" name="sidebar-side" value={option} checked={side === option} onChange={() => choose(option)} />
						<span className="check-text">{SIDEBAR_SIDE_LABELS[option]}</span>
					</label>
				))}
			</fieldset>
		</SettingsSection>
	);
}
