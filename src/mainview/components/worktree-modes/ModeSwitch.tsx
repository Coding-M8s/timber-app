import { useId } from "react";

interface ModeSwitchProps {
	/** One per mode, in order, for example "New branch" and "Existing branch". */
	labels: readonly string[];
	/** The position of the selected mode in `labels`. */
	selected: number;
	/** True while a command runs: the mode cannot change under it. */
	disabled: boolean;
	onSelect: (index: number) => void;
	/** What the choice is about, for a screen reader. */
	label?: string;
	/** The id of a hint that says more about the choice. */
	describedBy?: string;
	/** Per mode, true when that one mode cannot be chosen now. The others stay usable. */
	unavailable?: readonly boolean[];
}

/**
 * The switch between the modes of the worktree dialog. A group of radio
 * buttons drawn as one segmented control, so Tab reaches it, the arrow keys
 * move the choice, and a screen reader hears one choice out of several.
 */
export function ModeSwitch({ labels, selected, disabled, onSelect, label = "What to make the worktree from", describedBy, unavailable = [] }: ModeSwitchProps) {
	const name = useId();
	return (
		<div className="mode-switch" role="radiogroup" aria-label={label} aria-describedby={describedBy}>
			{labels.map((label, index) => (
				<label key={label} className={index === selected ? "mode-option selected" : "mode-option"}>
					<input
						className="mode-radio"
						type="radio"
						name={name}
						checked={index === selected}
						disabled={disabled || unavailable[index] === true}
						onChange={() => onSelect(index)}
					/>
					<span className="mode-label">{label}</span>
				</label>
			))}
		</div>
	);
}
