import { useEffect, useId, useRef, useState } from "react";
import type { AgentSetting } from "../../../shared/agent";
import { CHOP_DESCRIPTION_LIMIT, CHOP_KINDS, CHOP_TEXT_LIMIT, type ChopKind, type ChopList, type PersonalChop, chopKindWord, samePersonalChops } from "../../../shared/chops";
import { renameInArrangements, sameChopArrangements } from "../../../shared/chop-order";
import { DEFAULT_SHORTCUTS, type ShortcutId, type ShortcutSettings, chordLetterOf, describeChord, shortcutLetter, shortcutProblem, withShortcut } from "../../../shared/shortcuts";
import { SESSION_NAME_LIMIT } from "../../../shared/terminal";
import {
	type ChopDraft, type ChopDraftChange, type ChopsSwitches, addChopDraft, chopAgentOptions, chopsSectionChange, chopsSectionRenames, chopDraftsOf, chopScopeOptions, chopsDraftModel, describeChopSource, describeChopsFile,
	describeOverride, editChopDraft, isBlankChopDraft, removeChopDraft,
} from "../../chop-format";
import { useAppState, useStore } from "../../store/react";
import { selectedWorktree, shownChopOrder } from "../../store/state";
import { type SectionSave, SettingsSection, useDraftSection } from "./SettingsSection";

/** The repository whose chops show, as drawn: the selected worktree's. */
export interface ChopsRepository {
	repositoryName: string;
	/** Null until the first read answered. */
	list: ChopList | null;
}

export interface ChopsSectionViewProps {
	/** Whether to name the keys as on macOS: Cmd for Ctrl. */
	mac?: boolean;
	drafts: readonly ChopDraft[];
	saved: readonly PersonalChop[];
	/** The switches as shown: what is saved, or what the person switched them to. */
	switches: ChopsSwitches;
	/** Whether the section's Save has something it can save: the switch, the rows, or both. */
	canSave: boolean;
	repositories: readonly { path: string; name: string }[];
	agents: readonly AgentSetting[];
	/** Null when no worktree is selected. */
	repository: ChopsRepository | null;
	save: SectionSave;
	onSwitch: (change: Partial<ChopsSwitches>) => void;
	onAdd: () => void;
	onEdit: (key: string, change: ChopDraftChange) => void;
	onRemove: (key: string) => void;
	onSave: () => void;
	onReadAgain: () => void;
}

/** The chops a repository shares in its main checkout, read-only, with the ones a personal chop overrides. */
function RepositoryChops({ repository, onReadAgain }: { repository: ChopsRepository | null; onReadAgain: () => void }) {
	const titleId = useId();
	if (repository === null) {
		return <p className="dialog-note">Select a worktree to see the chops its repository shares.</p>;
	}
	const { list } = repository;
	const where = repository.repositoryName;
	const fromFile = list?.outcome === "listed" ? list.chops.filter(chop => chop.source === "repository-file") : [];
	const line = list?.outcome === "listed" ? describeChopsFile(list.file, list.path) : null;
	return (
		<section className="chops-repository" aria-labelledby={titleId}>
			<div className="chops-repository-head">
				<h4 id={titleId} className="timber-block-title">From the repository</h4>
				<button type="button" className="button quiet" onClick={onReadAgain}>Read again</button>
			</div>
			<p className="field-hint">
				{where}{list?.outcome === "listed" ? `: ${list.path}` : ""}. The app reads this file from the repository's main checkout, for every worktree, and never changes it. A branch's change to it shows once it reaches the main checkout. Your chop with the same name wins.
			</p>
			{list === null && <p className="dialog-note" role="status">Reading the chops</p>}
			{list !== null && list.outcome !== "listed" && <p className="dialog-note">{list.message}</p>}
			{line !== null && <p className={line.tone === "problem" ? "field-error" : "field-hint"}>{line.text}</p>}
			{list?.outcome === "listed" && (fromFile.length > 0 || list.overridden.length > 0) && (
				<ul className="chop-list" aria-label="Chops from the repository">
					{fromFile.map(chop => (
						<li key={chop.name} className="chop-item">
							<p className="chop-item-head"><span className="chop-item-name">{chop.name}</span> <span className="chop-item-meta">{chopKindWord(chop.kind)}, {describeChopSource(chop.source)}{chop.agent === null ? "" : `, for ${chop.agent}`}</span></p>
							{chop.description !== "" && <p className="field-hint">{chop.description}</p>}
							<pre className="dialog-command">{chop.text}</pre>
						</li>
					))}
					{list.overridden.map(chop => (
						<li key={`overridden-${chop.name}`} className="chop-item overridden">
							<p className="chop-item-head"><span className="chop-item-name">{chop.name}</span> <span className="chop-item-meta">{chopKindWord(chop.kind)}, {describeOverride(chop.by)}{chop.agent === null ? "" : `, for ${chop.agent}`}</span></p>
							{chop.description !== "" && <p className="field-hint">{chop.description}</p>}
							<pre className="dialog-command">{chop.text}</pre>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** The modifier keys, which a shortcut field lets pass while the chord is being pressed. */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"]);

/** What a pressed key that is not a chord says, so the person knows what to press. */
export function describeNotAChord(mac: boolean): string {
	return `Press ${mac ? "Cmd" : "Ctrl"}+Shift and a letter, such as ${describeChord("T", mac)}.`;
}

/**
 * One chop shortcut, set by pressing it: the field shows the key as set,
 * and takes the next Ctrl+Shift and a letter (Cmd+Shift on macOS) pressed
 * in it. A key that is taken, by the app, its text editor, or the other
 * chop shortcut, is refused with the reason, and the key shown stays. Tab
 * and Escape do what they always do. Reset goes back to the default.
 */
export function ShortcutField({ id, label, settings, mac, onChange }: { id: ShortcutId; label: string; settings: ShortcutSettings; mac: boolean; onChange: (next: ShortcutSettings) => void }) {
	const fieldId = useId();
	const [problem, setProblem] = useState<string | null>(null);
	const letter = shortcutLetter(settings, id);
	const isDefault = letter === DEFAULT_SHORTCUTS[id];
	return (
		<div className="field chop-shortcut">
			<label className="field-label" htmlFor={fieldId}>{label}</label>
			<div className="chop-shortcut-row">
				<input
					id={fieldId}
					className="field-input mono"
					type="text"
					readOnly
					value={describeChord(letter, mac)}
					aria-describedby={`${fieldId}-hint`}
					aria-invalid={problem !== null}
					onKeyDown={event => {
						if (event.key === "Tab" || event.key === "Escape" || MODIFIER_KEYS.has(event.key)) return;
						event.preventDefault();
						const pressed = chordLetterOf(event.nativeEvent);
						if (pressed === null) return setProblem(describeNotAChord(mac));
						const refused = shortcutProblem(id, pressed, settings);
						setProblem(refused);
						if (refused === null && pressed !== letter) onChange(withShortcut(settings, id, pressed));
					}}
					onBlur={event => {
						// The error stays while the keyboard goes to Reset, which may say its own.
						if (!(event.relatedTarget instanceof HTMLElement && event.currentTarget.parentElement?.contains(event.relatedTarget))) setProblem(null);
					}}
				/>
				{!isDefault && (
					<button
						type="button"
						className="button quiet"
						aria-label={`Reset ${label} to ${describeChord(DEFAULT_SHORTCUTS[id], mac)}`}
						onClick={() => {
							const refused = shortcutProblem(id, DEFAULT_SHORTCUTS[id], settings);
							setProblem(refused);
							if (refused === null) onChange(withShortcut(settings, id, DEFAULT_SHORTCUTS[id]));
						}}
					>
						Reset
					</button>
				)}
			</div>
			{problem === null
				? <span id={`${fieldId}-hint`} className="field-hint">To change it, focus this field and press the new key.</span>
				: <span id={`${fieldId}-hint`} className="field-error" role="alert">{problem}</span>}
		</div>
	);
}

/** Settings, Chops as drawn from its data, so it can be tested without a window. */
export function ChopsSectionView({ mac = false, drafts, saved, switches, canSave, repositories, agents, repository, save, onSwitch, onAdd, onEdit, onRemove, onSave, onReadAgain }: ChopsSectionViewProps) {
	const idPrefix = useId();
	const useHintId = `${idPrefix}-use-hint`;
	const soundsHintId = `${idPrefix}-sounds-hint`;
	const model = chopsDraftModel(drafts, saved);
	const addId = `${idPrefix}-add`;
	const removeId = (key: string) => `${idPrefix}-remove-${key}`;

	// As in Agents: after adding, focus goes to the new row's name; after removing, to the next row's Remove or to Add.
	const pendingFocus = useRef<{ kind: "added" } | { kind: "removed"; index: number } | null>(null);
	useEffect(() => {
		const pending = pendingFocus.current;
		if (pending === null) return;
		pendingFocus.current = null;
		if (pending.kind === "added") {
			const last = drafts.at(-1);
			if (last) document.getElementById(`${idPrefix}-name-${last.key}`)?.focus();
			return;
		}
		const next = drafts[Math.min(pending.index, drafts.length - 1)];
		document.getElementById(next ? removeId(next.key) : addId)?.focus();
	});
	const add = () => {
		pendingFocus.current = { kind: "added" };
		onAdd();
	};
	const remove = (key: string) => {
		pendingFocus.current = { kind: "removed", index: drafts.findIndex(draft => draft.key === key) };
		onRemove(key);
	};

	return (
		<SettingsSection
			title="Chops"
			description="Saved commands and prompts to run in a worktree, listed in the chops panel beside the workspace while Use chops is on. Yours are kept in the app's settings, for every repository or for one, and can be made, changed, and deleted here or in the panel. A repository can share more in .timber/chops.json, which the app only reads."
			save={save}
			canSave={canSave}
			onSave={onSave}
		>
			<div className="field">
				<label className="check">
					<input type="checkbox" role="switch" checked={switches.useChops} aria-describedby={useHintId} onChange={event => onSwitch({ useChops: event.target.checked })} />
					<span className="check-text">Use chops</span>
				</label>
				<span id={useHintId} className="field-hint">
					Off, chops are gone from the app: the title bar's Chops button, the chops panel, the chop shortcuts, the palette, and the session menus. Your chops stay saved here and come back when you turn it on.
				</span>
			</div>
			{/* Gone with chops, as the shortcuts are. */}
			{switches.useChops && (
				<div className="chop-shortcuts">
					<ShortcutField id="chops-panel" label="Show or hide the panel" settings={switches.shortcuts ?? {}} mac={mac} onChange={shortcuts => onSwitch({ shortcuts })} />
					<ShortcutField id="run-chop" label="Search and run a chop" settings={switches.shortcuts ?? {}} mac={mac} onChange={shortcuts => onSwitch({ shortcuts })} />
				</div>
			)}
			<div className="field">
				<label className="check">
					<input type="checkbox" role="switch" checked={switches.playChopSounds} aria-describedby={soundsHintId} onChange={event => onSwitch({ playChopSounds: event.target.checked })} />
					<span className="check-text">Play each chop's sound</span>
				</label>
				<span id={soundsHintId} className="field-hint">
					A chop's sound, chosen in the chops panel, plays when the chop starts. Off, no chop plays one, and each keeps its sound for when you turn it on. One sound plays at a time, for at most 4 seconds.
				</span>
			</div>
			{drafts.length === 0 && <p className="dialog-note">You have no chops of your own.</p>}
			<ul className="chop-rows" aria-label="Your chops">
				{drafts.map((draft, index) => {
					const row = model.rows[index]!;
					const id = (part: string) => `${idPrefix}-${part}-${draft.key}`;
					const label = draft.name.trim() === "" ? `chop ${index + 1}` : draft.name.trim();
					return (
						<li key={draft.key} className="chop-row">
							<div className="chop-row-fields">
								<div className="field chop-name">
									<label className="field-label" htmlFor={id("name")}>Name</label>
									<input
										id={id("name")}
										className="field-input"
										type="text"
										autoComplete="off"
										maxLength={SESSION_NAME_LIMIT}
										value={draft.name}
										aria-invalid={row.problem !== null}
										onChange={event => onEdit(draft.key, { name: event.target.value })}
									/>
								</div>
								<div className="field chop-kind">
									<label className="field-label" htmlFor={id("kind")}>Kind</label>
									<select id={id("kind")} className="field-input" value={draft.kind} onChange={event => onEdit(draft.key, { kind: event.target.value as ChopKind })}>
										{CHOP_KINDS.map(kind => <option key={kind} value={kind}>{chopKindWord(kind)}</option>)}
									</select>
								</div>
								<div className="field chop-scope">
									<label className="field-label" htmlFor={id("scope")}>For</label>
									<select id={id("scope")} className="field-input" value={draft.repository ?? ""} onChange={event => onEdit(draft.key, { repository: event.target.value === "" ? null : event.target.value })}>
										{chopScopeOptions(repositories, draft.repository).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
									</select>
								</div>
								{draft.kind === "prompt" && (
									<div className="field chop-agent">
										<label className="field-label" htmlFor={id("agent")}>Agent</label>
										<select id={id("agent")} className="field-input" value={draft.agent ?? ""} onChange={event => onEdit(draft.key, { agent: event.target.value === "" ? null : event.target.value })}>
											{chopAgentOptions(agents, draft.agent).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
										</select>
									</div>
								)}
								<button type="button" id={removeId(draft.key)} className="text-button chop-remove" aria-label={`Remove ${label}`} onClick={() => remove(draft.key)}>Remove</button>
							</div>
							<div className="field">
								<label className="field-label" htmlFor={id("text")}>{draft.kind === "command" ? "Command" : "Prompt"}</label>
								<textarea
									id={id("text")}
									className="field-input mono"
									rows={Math.min(8, Math.max(2, draft.text.split("\n").length))}
									spellCheck={draft.kind === "prompt"}
									maxLength={CHOP_TEXT_LIMIT}
									value={draft.text}
									aria-invalid={row.problem !== null}
									onChange={event => onEdit(draft.key, { text: event.target.value })}
								/>
							</div>
							<div className="field">
								<label className="field-label" htmlFor={id("description")}>Description (optional)</label>
								<input
									id={id("description")}
									className="field-input"
									type="text"
									autoComplete="off"
									maxLength={CHOP_DESCRIPTION_LIMIT}
									value={draft.description}
									onChange={event => onEdit(draft.key, { description: event.target.value })}
								/>
							</div>
							{/* A row just added is not wrong yet: it says what it needs without an alert. */}
							{row.problem !== null && isBlankChopDraft(draft) && <p className="field-hint">Type a name and a {draft.kind}, or remove this row.</p>}
							{row.problem !== null && !isBlankChopDraft(draft) && <p className="field-error" role="alert">{row.problem}</p>}
						</li>
					);
				})}
			</ul>
			{model.error !== null && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Too many chops</p>
					<p className="sidebar-error-text">{model.error}</p>
				</div>
			)}
			<div className="chop-add">
				<button type="button" id={addId} className="button quiet" onClick={add}>Add a chop</button>
			</div>
			<RepositoryChops repository={repository} onReadAgain={onReadAgain} />
		</SettingsSection>
	);
}

/**
 * Settings, Chops: the person's own chops, edited row by row and saved with
 * the section's Save, and the chops the selected worktree's repository
 * shares in its main checkout, read-only. The store reads those for the
 * selected repository (`ChopsKeeper`), again when the file changes, and on
 * "Read again".
 */
export function ChopsSection() {
	const store = useStore();
	const state = useAppState();
	const saved = state.preferences.chops;
	const [shown, setShown] = useState<{ saved: readonly PersonalChop[]; drafts: ChopDraft[] }>(() => ({ saved, drafts: chopDraftsOf(saved) }));
	// Rows keep their keys while what is saved stays the same, so a field keeps its focus.
	const fromSaved = shown.saved === saved ? shown.drafts : chopDraftsOf(saved);
	if (shown.saved !== saved) setShown({ saved, drafts: fromSaved });
	// The rows only ever differ from what is saved by what the person did.
	const { draft: drafts, save, change, commit, reset } = useDraftSection(fromSaved);
	// Unset follows what is saved, so a switch only differs from it by what the person did.
	const [chosen, setChosen] = useState<Partial<ChopsSwitches>>({});
	const savedSwitches: ChopsSwitches = { useChops: state.preferences.useChops, playChopSounds: state.preferences.playChopSounds, shortcuts: state.preferences.shortcuts };
	const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
	const switches: ChopsSwitches = { ...savedSwitches, ...chosen };
	const pending = chopsSectionChange(chopsDraftModel(drafts, saved), saved, switches, savedSwitches);
	const canSave = pending !== null;

	const selected = selectedWorktree(state);
	const repositoryPath = selected?.repository.path ?? null;

	const onSave = async () => {
		if (pending === null) return;
		// A renamed chop keeps its place and star in the chops panel, saved with it, from the order on screen.
		const renames = pending.chops === undefined ? [] : chopsSectionRenames(saved, fromSaved, drafts);
		const order = shownChopOrder(store.getState());
		const chopOrder = renames.length === 0 ? null : renameInArrangements(order, renames);
		store.noteChopRenames(renames);
		await commit(chopOrder === null || sameChopArrangements(order, chopOrder) ? pending : { ...pending, chopOrder }, () => setChosen({}));
		// Nothing was renamed when the save failed, so the panel keeps the saved order by the names it lists.
		if (renames.length > 0 && !samePersonalChops(store.getState().preferences.chops, pending.chops ?? [])) store.noteChopRenames([]);
	};
	const view = state.chops !== null && state.chops.repository === repositoryPath ? state.chops.list : null;

	return (
		<ChopsSectionView
			mac={mac}
			drafts={drafts}
			saved={saved}
			switches={switches}
			canSave={canSave}
			repositories={state.repositories}
			agents={state.preferences.agents}
			repository={selected === null ? null : { repositoryName: selected.repository.name, list: view }}
			save={save}
			onSwitch={change => {
				setChosen(current => ({ ...current, ...change }));
				reset();
			}}
			onAdd={() => change(addChopDraft(drafts))}
			onEdit={(key, edit) => change(editChopDraft(drafts, key, edit))}
			onRemove={key => change(removeChopDraft(drafts, key))}
			onSave={() => void onSave()}
			onReadAgain={() => {
				if (repositoryPath !== null) void store.readChops(repositoryPath);
			}}
		/>
	);
}

/**
 * Reads the chops of the selected worktree's repository whenever another
 * repository is selected or the saved chops or file chop sounds change, for the "+" menu, the
 * palette, "Insert chop", the chops panel, and Settings, Chops. It draws
 * nothing.
 */
export function ChopsKeeper() {
	const store = useStore();
	const state = useAppState();
	const repositoryPath = selectedWorktree(state)?.repository.path ?? null;
	const saved = state.preferences.chops;
	// A file chop's sound is listed with it, so a change to the sounds reads the list again too.
	const fileSounds = state.preferences.fileChopSounds;
	useEffect(() => {
		if (repositoryPath !== null) void store.readChops(repositoryPath);
	}, [store, repositoryPath, saved, fileSounds]);
	return null;
}
