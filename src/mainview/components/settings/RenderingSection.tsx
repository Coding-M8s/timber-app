import { useId, useState } from "react";
import { DMABUF_CHOICES, type DmabufChoice } from "../../../shared/rendering";
import { DMABUF_CHOICE_LABELS, describeRendering, restartChangesRendering } from "../../rendering-format";
import { useAppState } from "../../store/react";
import { ModeSwitch } from "../worktree-modes/ModeSwitch";
import { SettingsSection, useSectionSave } from "./SettingsSection";

/** How WebKitGTK draws the window on Linux. Read once at start, so a saved change waits for the next start. */
export function RenderingSection() {
	const { preferences, rendering } = useAppState();
	const saved = preferences.dmabuf;
	// Null follows what is saved, so a choice is only ever what the person picked.
	const [chosen, setChosen] = useState<DmabufChoice | null>(null);
	const choice = chosen ?? saved;
	const { save, run, reset } = useSectionSave();
	const hintId = useId();

	const choose = (next: DmabufChoice) => {
		setChosen(next);
		reset();
	};
	const onSave = async () => {
		if (await run({ dmabuf: choice })) setChosen(null);
	};

	return (
		<SettingsSection
			title="Rendering"
			description="How the window is drawn on Linux. Try another choice when scrolling or typing feels choppy. The app reads it when it starts."
			save={save}
			canSave={choice !== saved}
			onSave={() => void onSave()}
			offerRestart={rendering === null || restartChangesRendering(rendering)}
		>
			<div className="settings-row">
				<div className="settings-row-text">
					<span className="field-label">DMA-BUF renderer</span>
					<span id={hintId} className="field-hint">{describeRendering(rendering, saved)}</span>
				</div>
				<ModeSwitch
					label="DMA-BUF renderer"
					describedBy={hintId}
					labels={DMABUF_CHOICES.map(option => DMABUF_CHOICE_LABELS[option])}
					selected={DMABUF_CHOICES.indexOf(choice)}
					disabled={false}
					onSelect={index => choose(DMABUF_CHOICES[index]!)}
				/>
			</div>
		</SettingsSection>
	);
}
