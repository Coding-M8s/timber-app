import { type MenuEntry, WorktreeMenu } from "./WorktreeMenu";

/** An entry of a repository's menu or of a group's menu, with what choosing it means. */
export interface ChoiceItem<Choice> {
	id: string;
	label: string;
	/** What the entry does, for assistive technology. Menu entries have no tooltip. */
	description?: string | null;
	disabled?: boolean;
	note?: string | null;
	choice: Choice;
}

/** The entries as the menu draws them. An entry is enabled, with no note, unless it says otherwise. */
export function repositoryMenuEntries(items: readonly ChoiceItem<unknown>[]): MenuEntry<string>[] {
	return items.map(item => ({ id: item.id, label: item.label, disabled: item.disabled ?? false, note: item.note ?? null, description: item.description ?? null }));
}

interface RepositoryMenuProps<Choice> {
	/** The menu's name, such as "Actions for timber". */
	label: string;
	items: readonly ChoiceItem<Choice>[];
	at: { left: number; top: number };
	/** Puts the menu away. `backToOpener` gives the keyboard back to the header that opened it. */
	onClose: (backToOpener: boolean) => void;
	/** An entry was chosen. The menu is already closed and the header has the keyboard back. */
	onChoose: (choice: Choice) => void;
}

/**
 * A repository header's menu, or a group header's, open. It is the worktree
 * row's menu with other entries, so it is placed, moved through, and put away
 * the same way: the arrows, Home, and End move and wrap; Escape and Tab give
 * the keyboard back; a click elsewhere, scrolling, resizing, or leaving the
 * window put it away.
 */
export function RepositoryMenu<Choice>({ label, items, at, onClose, onChoose }: RepositoryMenuProps<Choice>) {
	return (
		<WorktreeMenu
			label={label}
			items={repositoryMenuEntries(items)}
			at={at}
			onClose={onClose}
			onChoose={id => {
				const item = items.find(candidate => candidate.id === id);
				if (item) onChoose(item.choice);
			}}
		/>
	);
}
