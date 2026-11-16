import { useId } from "react";

interface ModeSwitchProps {
	/** One per mode, in order, for example "New branch" and "Existing branch". */
	labels: readonly string[];
	/** The position of the selected mode in `labels`. */
	selected: number;
	/** True while a command runs: the mode cannot change under it. */
	disabled: boolean;
	onSelect: (index: number) => void;
}

/**
 * The switch between the modes of the worktree dialog. A group of radio
 * buttons drawn as one segmented control, so Tab reaches it, the arrow keys
 * move the choice, and a screen reader hears one choice out of several.
 */
export function ModeSwitch({ labels, selected, disabled, onSelect }: ModeSwitchProps) {
	const name = useId();
	return (
		<div className="mode-switch" role="radiogroup" aria-label="What to make the worktree from">
			{labels.map((label, index) => (
				<label key={label} className={index === selected ? "mode-option selected" : "mode-option"}>
					<input
						className="mode-radio"
						type="radio"
						name={name}
						checked={index === selected}
						disabled={disabled}
						onChange={() => onSelect(index)}
					/>
					<span className="mode-label">{label}</span>
				</label>
			))}
		</div>
	);
}
