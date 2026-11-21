import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import type { SuggestedIssue } from "../../../shared/issue-search";
import { issueKeyLabel } from "../../issue-format";
import type { IssueSuggestions, SuggestionsState } from "./issue-suggestions";

/** The suggestions controller and what it shows now. */
export interface Suggestions {
	controller: Pick<IssueSuggestions, "key" | "pick" | "blur">;
	state: SuggestionsState;
}

interface NameFieldProps {
	value: string;
	/** Null when no issues are suggested, as in tests of other parts. */
	suggestions: Suggestions | null;
	/** True while the dialog's command runs: nothing can be picked. */
	disabled: boolean;
	onChange: (value: string) => void;
}

/** One suggested issue: its key, title, and status, and a mark when it already has a worktree. */
function SuggestionRow({ issue }: { issue: SuggestedIssue }) {
	return (
		<>
			<span className="suggestion-key">{issueKeyLabel(issue.tracker, issue.key)}</span>
			<span className="suggestion-title">{issue.title}</span>
			{issue.worktree !== null && (
				<span className="suggestion-mark" title={issue.worktree.path}>Has a worktree</span>
			)}
			<span className={`suggestion-status ${issue.status.category}`}>{issue.status.name}</span>
		</>
	);
}

/**
 * The Name field of "New branch", with the tracker's issues that match the
 * typed text listed under it (see ./issue-suggestions.ts). The list is only a
 * help: whatever is typed is used as it is. Nothing is marked until an arrow
 * key moves there, so Enter on typed text still creates. Enter takes the
 * marked issue, and Escape closes the list without closing the dialog.
 */
export function NameField({ value, suggestions, disabled, onChange }: NameFieldProps) {
	const inputId = useId();
	const listId = useId();
	const hintId = useId();
	const list = useRef<HTMLUListElement>(null);
	const state = suggestions?.state ?? null;
	const open = state !== null && state.open && state.issues.length > 0 && !disabled;
	const active = open ? state.highlighted : -1;

	useEffect(() => {
		if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const pick = (issue: SuggestedIssue) => {
		if (disabled || !suggestions) return;
		onChange(suggestions.controller.pick(issue));
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!suggestions || disabled) return;
		const used = suggestions.controller.key(event.key);
		if (used === false) return;
		// The list used the key: Enter does not submit, and Escape does not close the dialog.
		event.preventDefault();
		event.stopPropagation();
		if (used !== true) pick(used);
	};

	return (
		<div className="field name-field">
			<label className="field-label" htmlFor={inputId}>Name</label>
			<input
				id={inputId}
				className="field-input"
				name="name"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
				aria-describedby={hintId}
				value={value}
				placeholder="Fix login bug"
				autoComplete="off"
				spellCheck={false}
				autoFocus
				onChange={event => onChange(event.target.value)}
				onKeyDown={onKeyDown}
				// A click on a row keeps the keyboard here (see its onMouseDown), so this is Tab or a click elsewhere.
				onBlur={() => suggestions?.controller.blur()}
			/>
			{open && (
				<ul id={listId} ref={list} className="suggestion-list" role="listbox" aria-label="Issues to pick from">
					{state.issues.map((issue, index) => (
						<li
							key={`${issue.tracker}:${issue.key}`}
							id={`${listId}-${index}`}
							role="option"
							aria-selected={index === active}
							className={index === active ? "suggestion active" : "suggestion"}
							// Keeps the focus in the text field, so typing goes on after a pick.
							onMouseDown={event => event.preventDefault()}
							onClick={() => pick(issue)}
						>
							<SuggestionRow issue={issue} />
						</li>
					))}
				</ul>
			)}
			<span id={hintId} className="field-hint">
				A branch name, a sentence, or an issue: github:123, jira:ENG-1, or linear:ENG-1. Timber decides the branch and the folder.
				{state?.hint ? <span className="suggestion-hint"> {state.hint}</span> : null}
			</span>
		</div>
	);
}
