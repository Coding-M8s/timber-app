import { useId, useState } from "react";
import { SIDEBAR_SIDES, type SidebarSide } from "../../../shared/preferences";
import { zoomChoices, zoomLabel } from "../../../shared/zoom";
import { SIDEBAR_SIDE_LABELS } from "../../shell";
import { useAppState } from "../../store/react";
import { SettingsSection, useSectionSave } from "./SettingsSection";

/** Where the window's parts go and how large they are drawn: the side of the sidebar and the zoom. */
export function LayoutSection() {
	const { sidebarSide: savedSide, zoom: savedZoom } = useAppState().preferences;
	// Null follows what is saved, so a choice is only ever what the person picked.
	const [chosenSide, setChosenSide] = useState<SidebarSide | null>(null);
	const [chosenZoom, setChosenZoom] = useState<number | null>(null);
	const side = chosenSide ?? savedSide;
	const zoom = chosenZoom ?? savedZoom;
	const { save, run, reset } = useSectionSave();
	const zoomId = useId();
	const zoomHintId = useId();

	const chooseSide = (next: SidebarSide) => {
		setChosenSide(next);
		reset();
	};
	const chooseZoom = (next: number) => {
		setChosenZoom(next);
		reset();
	};
	const onSave = async () => {
		if (await run({ sidebarSide: side, zoom })) {
			setChosenSide(null);
			setChosenZoom(null);
		}
	};

	return (
		<SettingsSection
			title="Layout"
			description="Where the sidebar sits in the window, and how large everything is drawn. Both change as soon as you save, and the app remembers them in its own settings file."
			save={save}
			canSave={side !== savedSide || zoom !== savedZoom}
			onSave={() => void onSave()}
		>
			<fieldset className="settings-choice">
				<legend className="field-label">Sidebar side</legend>
				{SIDEBAR_SIDES.map(option => (
					<label key={option} className="check">
						<input type="radio" name="sidebar-side" value={option} checked={side === option} onChange={() => chooseSide(option)} />
						<span className="check-text">{SIDEBAR_SIDE_LABELS[option]}</span>
					</label>
				))}
			</fieldset>
			<div className="field">
				<label className="field-label" htmlFor={zoomId}>Zoom</label>
				<select id={zoomId} className="field-input" aria-describedby={zoomHintId} value={String(zoom)} onChange={event => chooseZoom(Number(event.target.value))}>
					{zoomChoices(savedZoom).map(choice => <option key={choice} value={String(choice)}>{zoomLabel(choice)}</option>)}
				</select>
				<span id={zoomHintId} className="field-hint">
					Raise it when text is too small because the app does not follow the scale of your display, as can happen on Linux under Wayland.
				</span>
			</div>
		</SettingsSection>
	);
}
