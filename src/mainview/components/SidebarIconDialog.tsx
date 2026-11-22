import { useEffect, useId, useRef, useState } from "react";
import { groupLabel } from "../../shared/repository-groups";
import { BUNDLED_ICONS, type IconChoice, type IconTarget, type RemoteIconSource, type SidebarIcon, describeRemoteIconAction, groupIcon, repositoryIcon } from "../../shared/sidebar-icons";
import { ICON_FILE_HINT, ICON_FILE_LABEL, ICON_REMOTE_HINT, ICON_SETTINGS_NOTE, NO_REMOTE_ICON, REMOVE_ICON_LABEL, describeCurrentIcon, describeIconDialogTitle } from "../sidebar-icon-format";
import { useAppState, useStore } from "../store/react";
import { BundledGlyph, GLYPH_NAMES, SidebarIconView } from "./SidebarIcon";

/** What is being asked of the engine, so its button can say so and the others wait. */
type Busy = "bundled" | "file" | "remote" | "remove" | null;

export interface SidebarIconDialogViewProps {
	kind: "repository" | "group";
	name: string;
	icon: SidebarIcon | null;
	/** Where a repository's icon can come from: undefined while it is read, null when nowhere. Always null for a group. */
	remote: RemoteIconSource | null | undefined;
	busy: Busy;
	/** Why the last choice was not saved, or null. */
	problem: string | null;
	onChoose: (choice: IconChoice | null) => void;
	onClose: () => void;
}

/** What the icon dialog shows for a given state. It holds no state of its own (see `SidebarIconDialog` below). */
export function SidebarIconDialogView({ kind, name, icon, remote, busy, problem, onChoose, onClose }: SidebarIconDialogViewProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const hintId = useId();
	const remoteHintId = useId();

	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);

	const waiting = busy !== null;
	return (
		<dialog
			ref={dialog}
			className="dialog sidebar-icon-dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="dialog-form">
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">{describeIconDialogTitle(kind, name)}</h2>
				</header>
				<p className="dialog-note sidebar-icon-current">
					<SidebarIconView icon={icon} className="sidebar-icon-preview" size={24} />
					<span>{describeCurrentIcon(icon, glyph => GLYPH_NAMES[glyph.name])}</span>
				</p>
				<div className="sidebar-icon-grid" role="group" aria-label="Bundled icons">
					{BUNDLED_ICONS.map(glyph => (
						<button
							key={glyph}
							type="button"
							className="icon-button sidebar-icon-choice"
							aria-label={GLYPH_NAMES[glyph]}
							title={GLYPH_NAMES[glyph]}
							aria-pressed={icon?.kind === "bundled" && icon.name === glyph}
							disabled={waiting}
							onClick={() => onChoose({ kind: "bundled", name: glyph })}
						>
							<BundledGlyph name={glyph} size={18} />
						</button>
					))}
				</div>
				<div className="sidebar-icon-actions">
					<button type="button" className="button" aria-describedby={hintId} disabled={waiting} onClick={() => onChoose({ kind: "file" })}>
						{busy === "file" ? "Waiting for the file" : ICON_FILE_LABEL}
					</button>
					{kind === "repository" && remote && (
						<button type="button" className="button" aria-describedby={remoteHintId} disabled={waiting} onClick={() => onChoose({ kind: "remote" })}>
							{busy === "remote" ? `Fetching from ${remote.host === "github" ? "GitHub" : "Bitbucket"}` : describeRemoteIconAction(remote, icon)}
						</button>
					)}
				</div>
				<p id={hintId} className="dialog-note">{ICON_FILE_HINT}</p>
				{kind === "repository" && remote && <p id={remoteHintId} className="dialog-note">{ICON_REMOTE_HINT}</p>}
				{kind === "repository" && remote === null && <p className="dialog-note">{NO_REMOTE_ICON}</p>}
				{problem && <p className="dialog-note sidebar-icon-problem" role="alert">{problem}</p>}
				<p className="dialog-note">{ICON_SETTINGS_NOTE}</p>
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button type="button" className="button quiet" disabled={waiting || icon === null} onClick={() => onChoose(null)}>{REMOVE_ICON_LABEL}</button>
						<button type="button" className="button primary" autoFocus onClick={onClose}>Done</button>
					</div>
				</footer>
			</div>
		</dialog>
	);
}

/**
 * The icon dialog of a repository or a group, from its menu. A bundled icon,
 * an image file, or the repository's remote icon is saved as soon as it is
 * chosen, and shows in the sidebar at once; a refusal or a failure is said
 * here and leaves the icon as it was. It closes itself when its repository or
 * group leaves the list.
 */
export function SidebarIconDialog({ target }: { target: IconTarget }) {
	const store = useStore();
	const state = useAppState();
	const [busy, setBusy] = useState<Busy>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [remote, setRemote] = useState<RemoteIconSource | null | undefined>(target.kind === "repository" ? undefined : null);

	const repository = target.kind === "repository" ? state.repositories.find(candidate => candidate.path === target.path) : undefined;
	const group = target.kind === "group" ? state.repositoryGroups.groups.find(candidate => candidate.id === target.id) : undefined;
	const gone = target.kind === "repository" ? !repository : !group;

	useEffect(() => {
		if (gone && state.loaded) store.closeDialog();
	}, [gone, state.loaded, store]);

	useEffect(() => {
		if (target.kind !== "repository") return;
		let left = false;
		void store.readRemoteIconSource(target.path).then(source => {
			if (!left) setRemote(source);
		});
		return () => {
			left = true;
		};
	}, [store, target]);

	if (gone) return null;
	const icon = target.kind === "repository" ? repositoryIcon(state.sidebarIcons, target.path) : groupIcon(state.sidebarIcons, target.id);
	const name = target.kind === "repository" ? repository!.name : groupLabel(state.repositoryGroups.groups, target.id);

	const choose = (choice: IconChoice | null) => {
		if (busy) return;
		setBusy(choice === null ? "remove" : choice.kind);
		setProblem(null);
		void store.setSidebarIcon(target, choice).then(result => {
			setBusy(null);
			if (result.outcome === "refused" || result.outcome === "failed") setProblem(result.message);
			else if (result.outcome === "overridden") setProblem("The repositories come from TIMBER_APP_REPOS, so no icon is saved.");
			else if (result.outcome === "unknown") store.closeDialog();
		});
	};

	return (
		<SidebarIconDialogView
			kind={target.kind}
			name={name}
			icon={icon}
			remote={remote}
			busy={busy}
			problem={problem}
			onChoose={choose}
			onClose={() => store.closeDialog()}
		/>
	);
}
