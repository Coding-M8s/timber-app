import { type ChangeEvent, type FocusEvent, type KeyboardEvent, type Ref, useEffect, useId, useRef, useState } from "react";
import { MAX_GROUP_NAME } from "../../shared/repository-groups";
import { groupNameBlurAction, groupNameKeyAction } from "../sidebar-groups";

export interface RepositoryGroupNameViewProps {
	/** The field's name, such as "Name of the new group". */
	label: string;
	value: string;
	/** Why the last name was not saved, shown under the field. */
	problem: string | null;
	idBase: string;
	inputRef?: Ref<HTMLInputElement>;
	onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
	onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
	onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}

/** How the name field of a group looks. Stateless, so it can be drawn without a window. */
export function RepositoryGroupNameView({ label, value, problem, idBase, inputRef, onChange, onKeyDown, onBlur }: RepositoryGroupNameViewProps) {
	const problemId = `${idBase}-problem`;
	return (
		<div className="repository-group-name-field">
			<input
				ref={inputRef}
				type="text"
				className="repository-group-name-input"
				aria-label={label}
				placeholder="Group name"
				maxLength={MAX_GROUP_NAME}
				value={value}
				aria-invalid={problem !== null || undefined}
				aria-describedby={problem === null ? undefined : problemId}
				readOnly={onChange === undefined}
				onChange={onChange}
				onKeyDown={onKeyDown}
				onBlur={onBlur}
			/>
			{problem !== null && <p id={problemId} className="repository-group-name-problem" role="alert">{problem}</p>}
		</div>
	);
}

interface RepositoryGroupNameProps {
	label: string;
	/** The name it starts with: the group's name when renaming, empty for a new group. It is selected. */
	initial: string;
	problem: string | null;
	/** Save the name typed. The field stays until the caller takes it away. */
	onSubmit: (name: string) => void;
	/** Put the field away without saving. */
	onCancel: () => void;
	/** The person changed the text, which puts away the problem shown. */
	onEdit: () => void;
}

/**
 * The name of a group, typed in place in the sidebar. Enter saves and Escape
 * cancels. Leaving the field cancels when the text is empty or unchanged, and
 * saves otherwise.
 */
export function RepositoryGroupName({ label, initial, problem, onSubmit, onCancel, onEdit }: RepositoryGroupNameProps) {
	const idBase = useId();
	const [value, setValue] = useState(initial);
	const input = useRef<HTMLInputElement>(null);
	// Enter or Escape already answered, so the blur that follows when the field goes away does nothing more.
	const answered = useRef(false);

	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		const action = groupNameKeyAction(event.key);
		if (action === null) return;
		event.preventDefault();
		// Keys here are the field's: none of them may reach the header or the sidebar.
		event.stopPropagation();
		answered.current = true;
		if (action === "submit") onSubmit(value);
		else onCancel();
	};

	const onBlur = () => {
		const action = groupNameBlurAction(value, initial, answered.current, problem);
		if (action === "nothing") return;
		answered.current = true;
		if (action === "submit") onSubmit(value);
		else onCancel();
	};

	return (
		<RepositoryGroupNameView
			label={label}
			value={value}
			problem={problem}
			idBase={idBase}
			inputRef={input}
			onChange={event => {
				// Typing again is a new answer to give.
				answered.current = false;
				setValue(event.target.value);
				onEdit();
			}}
			onKeyDown={onKeyDown}
			onBlur={onBlur}
		/>
	);
}
