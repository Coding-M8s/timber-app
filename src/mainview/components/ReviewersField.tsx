import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { REVIEWERS_HINT, type ReviewerSuggestion, matchReviewers, withReviewerPicked } from "../pull-request-create-format";
import { stepActive } from "./BranchField";

interface ReviewersFieldProps {
	value: string;
	/** Called with the text as typed, or with a picked reviewer put in place of the name being typed. */
	onChange: (value: string) => void;
	/** The people and teams to offer: the ones the repository's pull requests already list. */
	suggestions: readonly ReviewerSuggestion[];
	/** True while Timber runs: nothing is offered or can be picked. A disabled field may keep the focus without a blur. */
	disabled?: boolean;
}

/**
 * The Reviewers field of the pull request form: logins or `org/team`,
 * separated by commas or spaces. While it has the focus, the people and
 * teams the repository's pull requests already list are offered under it,
 * narrowed by the name being typed (the text after the last comma or
 * space), without the ones already typed. The list is only a help: whatever
 * is typed is passed to Timber as it is. Arrow keys move through the list
 * and Enter takes the marked reviewer; with none marked, Enter submits the
 * form as usual.
 */
export function ReviewersField({ value, onChange, suggestions, disabled = false }: ReviewersFieldProps) {
	const inputId = useId();
	const listId = useId();
	const hintId = useId();
	const list = useRef<HTMLUListElement>(null);
	const [focused, setFocused] = useState(false);
	const [marked, setMarked] = useState(-1);
	const shown = focused && !disabled ? matchReviewers(suggestions, value) : [];
	const active = marked < shown.length ? marked : -1;

	useEffect(() => {
		if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const pick = (suggestion: ReviewerSuggestion) => {
		if (disabled) return;
		onChange(withReviewerPicked(value, suggestion.name));
		setMarked(-1);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if ((event.key === "ArrowDown" || event.key === "ArrowUp") && shown.length > 0) {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			const count = shown.length;
			setMarked(current => stepActive(current < count ? current : -1, step, count));
		} else if (event.key === "Enter" && active >= 0) {
			// Enter takes the marked reviewer. With none marked it submits the form.
			event.preventDefault();
			pick(shown[active]!);
		} else if (event.key === "Escape" && active >= 0) {
			event.preventDefault();
			setMarked(-1);
		}
	};

	return (
		<div className="field">
			<label className="field-label" htmlFor={inputId}>Reviewers</label>
			<input
				id={inputId}
				className="field-input mono"
				name="reviewers"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={shown.length > 0}
				aria-controls={shown.length > 0 ? listId : undefined}
				aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
				aria-describedby={hintId}
				autoComplete="off"
				autoCapitalize="off"
				spellCheck={false}
				placeholder="None"
				value={value}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					setMarked(-1);
				}}
				onChange={event => {
					setMarked(-1);
					onChange(event.target.value);
				}}
				onKeyDown={onKeyDown}
			/>
			{shown.length > 0 && (
				<ul id={listId} ref={list} className="reviewer-list" role="listbox" aria-label="Reviewers to pick from">
					{shown.map((suggestion, index) => (
						<li
							key={`${suggestion.kind}:${suggestion.name}`}
							id={`${listId}-${index}`}
							role="option"
							aria-selected={index === active}
							className={index === active ? "branch-option active" : "branch-option"}
							// Keeps the focus in the text field, so typing goes on after a pick.
							onMouseDown={event => event.preventDefault()}
							onClick={() => pick(suggestion)}
						>
							<span className="branch-name">{suggestion.name}</span>
							<span className="branch-kind">{suggestion.kind}</span>
						</li>
					))}
				</ul>
			)}
			<span className="field-hint" id={hintId}>{REVIEWERS_HINT}</span>
		</div>
	);
}
