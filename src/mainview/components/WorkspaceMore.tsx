import { type KeyboardEvent, useRef, useState } from "react";
import type { Worktree } from "../../shared/model";
import { useStore } from "../store/react";
import { describeWorkspaceMenu, describeWorkspaceMore, workspaceMenuChoice, workspaceMenuItems, workspaceMoreKeyOpens } from "../workspace-actions-format";
import { MoreIcon } from "./MoreIcon";
import { WorktreeMenu } from "./WorktreeMenu";

interface OpenMenu {
	at: { left: number; top: number };
	start: "first" | "last";
}

/**
 * More on the workspace header's title line, and its menu: Rebase and Done.
 * Enter, Space, or Down open it on its first entry, Up on its last. Escape,
 * Tab, or choosing gives the keyboard back to More, so a dialog opened from
 * it hands the keyboard back to More when it closes.
 */
export function WorkspaceMore({ repository, worktree, removing }: { repository: string; worktree: Worktree; removing: boolean }) {
	const store = useStore();
	const button = useRef<HTMLButtonElement>(null);
	const [menu, setMenu] = useState<OpenMenu | null>(null);

	const open = (start: OpenMenu["start"]) => {
		const box = button.current?.getBoundingClientRect();
		// Under the button, its right edge on the button's; it is kept inside the window once drawn.
		setMenu({ at: { left: box ? box.right - 200 : 0, top: box ? box.bottom + 4 : 0 }, start });
	};

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const start = workspaceMoreKeyOpens(event.key);
		if (start === null) return;
		event.preventDefault();
		open(start);
	};

	return (
		<>
			<button
				ref={button}
				type="button"
				className="icon-button workspace-more"
				aria-label={describeWorkspaceMore(worktree)}
				// No tooltip while its menu is open: it would cover the menu.
				title={menu !== null ? undefined : describeWorkspaceMore(worktree)}
				aria-haspopup="menu"
				aria-expanded={menu !== null}
				onClick={() => open("first")}
				onKeyDown={onKeyDown}
			>
				<MoreIcon />
			</button>
			{menu !== null && (
				<WorktreeMenu
					label={describeWorkspaceMenu(worktree)}
					items={workspaceMenuItems(worktree, removing)}
					at={menu.at}
					start={menu.start}
					onClose={backToMore => {
						setMenu(null);
						if (backToMore) button.current?.focus();
					}}
					onChoose={id => {
						const dialog = workspaceMenuChoice(repository, worktree, id, removing);
						if (dialog) store.openDialog(dialog);
					}}
				/>
			)}
		</>
	);
}
