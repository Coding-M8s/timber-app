import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { BranchSuggestion } from "../../shared/model";

/** How many matching branches are listed at once. Typing narrows the list. */
export const SHOWN_BRANCHES = 100;

/**
 * The branches whose name contains the typed text, whatever its case, in the
 * order they were given. Every branch when nothing is typed.
 */
export function matchBranches(branches: readonly BranchSuggestion[], text: string): BranchSuggestion[] {
	const query = text.trim().toLowerCase();
	return query === "" ? [...branches] : branches.filter(branch => branch.selector.toLowerCase().includes(query));
}

/** The next option to mark when an arrow key is pressed. `active` is -1 when none is marked. Wraps around. */
export function stepActive(active: number, step: 1 | -1, count: number): number {
	if (count === 0) return -1;
	if (active === -1) return step === 1 ? 0 : count - 1;
	return (active + step + count) % count;
}

interface BranchFieldProps {
	label: string;
	value: string;
	/** Called with the text as typed, or with the name of a picked branch. */
	onChange: (value: string) => void;
	/** The branches to offer. Undefined while they are read, null when they could not be read. */
	branches: readonly BranchSuggestion[] | null | undefined;
	/** True while the dialog's command runs: nothing can be picked. */
	disabled?: boolean;
}

/**
 * A text field with the repository's branches listed under it for picking.
 * The list is only a help: it narrows as the person types, and whatever is
 * typed is used as it is, whether or not a branch matches. Arrow keys move
 * through the list and Enter takes the marked branch.
 */
export function BranchField({ label, value, onChange, branches, disabled = false }: BranchFieldProps) {
	const inputId = useId();
	const listId = useId();
	const list = useRef<HTMLUListElement>(null);
	const [marked, setMarked] = useState(-1);
	const matches = branches ? matchBranches(branches, value) : [];
	const shown = matches.slice(0, SHOWN_BRANCHES);
	const active = marked < shown.length ? marked : -1;

	useEffect(() => {
		if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const pick = (branch: BranchSuggestion) => {
		if (disabled) return;
		onChange(branch.selector);
		setMarked(-1);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if ((event.key === "ArrowDown" || event.key === "ArrowUp") && shown.length > 0) {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			const count = shown.length;
			// From the latest mark, so two quick presses move two steps.
			setMarked(current => stepActive(current < count ? current : -1, step, count));
		} else if (event.key === "Enter" && active >= 0) {
			// Enter takes the marked branch. The next Enter submits the dialog.
			event.preventDefault();
			pick(shown[active]!);
		}
	};

	return (
		<div className="field">
			<label className="field-label" htmlFor={inputId}>{label}</label>
			<input
				id={inputId}
				className="field-input"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={shown.length > 0}
				aria-controls={shown.length > 0 ? listId : undefined}
				aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
				autoComplete="off"
				autoCapitalize="off"
				spellCheck={false}
				autoFocus
				value={value}
				onChange={event => {
					setMarked(-1);
					onChange(event.target.value);
				}}
				onKeyDown={onKeyDown}
			/>
			<div className="branch-box">
				{branches === undefined && <p className="branch-note">Reading branches</p>}
				{branches === null && <p className="branch-note">The branches could not be listed. Type the name instead.</p>}
				{branches && shown.length === 0 && (
					<p className="branch-note">
						{branches.length === 0 ? "This repository has no branch to list." : "No listed branch matches."} Timber decides what the text means.
					</p>
				)}
				{shown.length > 0 && (
					<ul id={listId} ref={list} className="branch-list" role="listbox" aria-label="Branches to pick from">
						{shown.map((branch, index) => (
							<li
								key={`${branch.kind}:${branch.selector}`}
								id={`${listId}-${index}`}
								role="option"
								aria-selected={index === active}
								className={index === active ? "branch-option active" : "branch-option"}
								// Keeps the focus in the text field, so typing goes on after a pick.
								onMouseDown={event => event.preventDefault()}
								onClick={() => pick(branch)}
							>
								<span className="branch-name">{branch.selector}</span>
								<span className="branch-kind">{branch.kind}</span>
							</li>
						))}
						{matches.length > shown.length && (
							<li role="presentation" className="branch-note">{matches.length - shown.length} more. Type to narrow the list.</li>
						)}
					</ul>
				)}
			</div>
		</div>
	);
}
