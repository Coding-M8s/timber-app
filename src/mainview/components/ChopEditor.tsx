import type { FormEvent, KeyboardEvent, Ref } from "react";
import type { AgentSetting } from "../../shared/agent";
import { CHOP_DESCRIPTION_LIMIT, CHOP_KINDS, CHOP_TEXT_LIMIT, type ChopKind, type ListedChop, chopKindWord } from "../../shared/chops";
import type { SoundChoice } from "../../shared/sound-setting";
import { SESSION_NAME_LIMIT } from "../../shared/terminal";
import { type ChopDraftChange, type ChopForm, type ChopScopeOption, chopAgentOptions, describeFileChopView } from "../chop-format";
import { SoundPicker } from "./SoundPicker";

/*
 * What the chops panel draws in place of a row, or above its list, while a
 * chop is made, changed, viewed, or deleted. Drawn from their data, so they
 * can be tested without a window. Escape cancels each of them.
 */

const cancelOnEscape = (onCancel: () => void) => (event: KeyboardEvent<HTMLElement>) => {
	if (event.key !== "Escape") return;
	// The panel's own keys, so nothing behind it takes the Escape too.
	event.preventDefault();
	event.stopPropagation();
	onCancel();
};

export interface ChopFormViewProps {
	idBase: string;
	mode: "new" | "edit";
	form: ChopForm;
	scopeOptions: readonly ChopScopeOption[];
	agents: readonly AgentSetting[];
	/** Why the form cannot be saved as it is, or null. */
	problem: string | null;
	/** Whether Save was tried with the problem, so it is said as an alert. Before that, a form with nothing typed only says what it needs. */
	tried: boolean;
	/** What the form says without stopping the save, such as a chop it takes the place of. */
	notes: readonly string[];
	/** Why the last save failed, or null. */
	failure: string | null;
	/** Why nothing can be saved now, or null. */
	blocked: string | null;
	saving: boolean;
	/** What choosing or playing the sound last came to, when it went wrong, or null. */
	soundProblem: string | null;
	/** The file "Your own file" last chose for this form, saved or not. */
	customSoundPath: string | undefined;
	nameRef?: Ref<HTMLInputElement>;
	onChange: (change: ChopDraftChange) => void;
	onChooseSoundFile: () => void;
	onPlaySound: () => void;
	onSave: () => void;
	onCancel: () => void;
	/** Only when editing: asks before the chop is deleted. */
	onDelete?: (() => void) | undefined;
}

/** The form that makes a chop, or changes one of the person's own. */
export function ChopFormView({
	idBase, mode, form, scopeOptions, agents, problem, tried, notes, failure, blocked, saving, soundProblem, customSoundPath, nameRef, onChange, onChooseSoundFile, onPlaySound, onSave, onCancel, onDelete,
}: ChopFormViewProps) {
	const id = (part: string) => `${idBase}-${part}`;
	const blank = form.name.trim() === "" && form.text.trim() === "";
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!saving && blocked === null) onSave();
	};
	const title = mode === "new" ? `New ${form.kind === "command" ? "command" : "prompt"}` : `Edit ${form.name.trim() === "" ? "chop" : form.name.trim()}`;
	const unavailable = saving || blocked !== null;
	return (
		<form className="chop-editor" aria-labelledby={id("title")} onSubmit={submit} onKeyDown={cancelOnEscape(onCancel)} noValidate>
			<h3 id={id("title")} className="chop-editor-title">{title}</h3>
			<div className="chop-editor-pair">
				<div className="field">
					<label className="field-label" htmlFor={id("kind")}>Kind</label>
					<select id={id("kind")} className="field-input" value={form.kind} onChange={event => onChange({ kind: event.target.value as ChopKind })}>
						{CHOP_KINDS.map(kind => <option key={kind} value={kind}>{chopKindWord(kind)}</option>)}
					</select>
				</div>
				<div className="field">
					<label className="field-label" htmlFor={id("scope")}>For</label>
					<select id={id("scope")} className="field-input" value={form.repository ?? ""} onChange={event => onChange({ repository: event.target.value === "" ? null : event.target.value })}>
						{scopeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
					</select>
				</div>
			</div>
			<div className="field">
				<label className="field-label" htmlFor={id("name")}>Name</label>
				<input
					ref={nameRef}
					id={id("name")}
					className="field-input"
					type="text"
					autoComplete="off"
					maxLength={SESSION_NAME_LIMIT}
					value={form.name}
					aria-invalid={tried && problem !== null}
					onChange={event => onChange({ name: event.target.value })}
				/>
			</div>
			<div className="field">
				<label className="field-label" htmlFor={id("text")}>{form.kind === "command" ? "Command" : "Prompt"}</label>
				<textarea
					id={id("text")}
					className="field-input mono"
					rows={Math.min(8, Math.max(3, form.text.split("\n").length))}
					spellCheck={form.kind === "prompt"}
					maxLength={CHOP_TEXT_LIMIT}
					value={form.text}
					aria-invalid={tried && problem !== null}
					onChange={event => onChange({ text: event.target.value })}
				/>
			</div>
			{form.kind === "prompt" && (
				<div className="field">
					<label className="field-label" htmlFor={id("agent")}>Agent</label>
					<select id={id("agent")} className="field-input" value={form.agent ?? ""} onChange={event => onChange({ agent: event.target.value === "" ? null : event.target.value })}>
						{chopAgentOptions(agents, form.agent).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
					</select>
				</div>
			)}
			<div className="field">
				<label className="field-label" htmlFor={id("description")}>Description (optional)</label>
				<input
					id={id("description")}
					className="field-input"
					type="text"
					autoComplete="off"
					maxLength={CHOP_DESCRIPTION_LIMIT}
					value={form.description}
					onChange={event => onChange({ description: event.target.value })}
				/>
			</div>
			<div className="field">
				<label className="field-label" htmlFor={id("sound")}>Sound</label>
				<div className="chop-editor-sound">
					<SoundPicker
						id={id("sound")}
						label={form.name.trim() === "" ? "chop" : form.name.trim()}
						sound={form.sound}
						customPath={customSoundPath}
						disabled={saving}
						onPick={sound => onChange({ sound })}
						onChooseFile={onChooseSoundFile}
						onPlay={onPlaySound}
					/>
				</div>
				<span className="field-hint">{CHOP_SOUND_HINT}</span>
				{soundProblem !== null && <p className="field-error" role="alert">{soundProblem}</p>}
			</div>
			{notes.map(note => <p key={note} className="field-hint">{note}</p>)}
			{problem !== null && !tried && blank && <p className="field-hint">Type a name and a {form.kind}.</p>}
			{problem !== null && !tried && !blank && <p className="field-error">{problem}</p>}
			{problem !== null && tried && <p className="field-error" role="alert">{problem}</p>}
			{blocked !== null && <p className="field-error">{blocked}</p>}
			{failure !== null && <p className="field-error" role="alert">Not saved: {failure}</p>}
			<div className="chop-editor-actions">
				{onDelete && <button type="button" className="text-button chop-editor-delete" aria-disabled={unavailable} title={blocked ?? undefined} onClick={() => !unavailable && onDelete()}>Delete</button>}
				<button type="button" className="button quiet" onClick={onCancel}>Cancel</button>
				<button type="submit" className="button primary" aria-disabled={unavailable} title={blocked ?? undefined}>{saving ? "Saving" : "Save"}</button>
			</div>
		</form>
	);
}

/** What a chop's Sound field says under it. */
export const CHOP_SOUND_HINT = "Plays when the chop starts, unless Play each chop's sound is off in Settings, Chops. One sound plays at a time, for at most 4 seconds.";

export interface FileChopViewProps {
	idBase: string;
	chop: ListedChop;
	/** The repository file's full path. */
	path: string;
	/** Whether the sound's save waits for its answer. */
	saving: boolean;
	/** Why nothing can be saved now, or null. */
	blocked: string | null;
	/** Why the sound was not saved, or what choosing or playing it came to, or null. */
	soundProblem: string | null;
	/** The file "Your own file" last chose here, saved or not. */
	customSoundPath: string | undefined;
	closeRef?: Ref<HTMLButtonElement>;
	onClose: () => void;
	/** A sound was picked: it is saved at once, in the app's settings. */
	onPickSound: (sound: SoundChoice | null) => void;
	onChooseSoundFile: () => void;
	onPlaySound: () => void;
}

/** A chop from the repository file, shown whole and read-only: the app never writes that file. Its sound is the person's, kept in the app's settings. */
export function FileChopView({ idBase, chop, path, saving, blocked, soundProblem, customSoundPath, closeRef, onClose, onPickSound, onChooseSoundFile, onPlaySound }: FileChopViewProps) {
	const titleId = `${idBase}-title`;
	const soundId = `${idBase}-sound`;
	return (
		<section className="chop-editor" aria-labelledby={titleId} onKeyDown={cancelOnEscape(onClose)}>
			<h3 id={titleId} className="chop-editor-title">{chop.name}</h3>
			<p className="chop-item-meta">{chopKindWord(chop.kind)}{chop.agent === null ? "" : `, for ${chop.agent}`}</p>
			{chop.description !== "" && <p className="field-hint">{chop.description}</p>}
			<pre className="dialog-command">{chop.text}</pre>
			<p className="field-hint">{describeFileChopView(path)}</p>
			<div className="field">
				<label className="field-label" htmlFor={soundId}>Sound</label>
				<div className="chop-editor-sound">
					<SoundPicker
						id={soundId}
						label={chop.name}
						sound={chop.sound}
						customPath={customSoundPath}
						disabled={saving || blocked !== null}
						onPick={onPickSound}
						onChooseFile={onChooseSoundFile}
						onPlay={onPlaySound}
					/>
				</div>
				<span className="field-hint">{saving ? "Saving the sound" : `Kept in the app's settings, never in the file. ${CHOP_SOUND_HINT}`}</span>
				{blocked !== null && <p className="field-error">{blocked}</p>}
				{soundProblem !== null && <p className="field-error" role="alert">{soundProblem}</p>}
			</div>
			<div className="chop-editor-actions">
				<button ref={closeRef} type="button" className="button quiet" onClick={onClose}>Close</button>
			</div>
		</section>
	);
}

export interface DeleteChopViewProps {
	idBase: string;
	/** What it asks, such as "Delete Test? ...". */
	question: string;
	failure: string | null;
	blocked: string | null;
	saving: boolean;
	cancelRef?: Ref<HTMLButtonElement>;
	onDelete: () => void;
	onCancel: () => void;
}

/** Asks before one of the person's own chops is deleted. The keyboard starts on Cancel. */
export function DeleteChopView({ idBase, question, failure, blocked, saving, cancelRef, onDelete, onCancel }: DeleteChopViewProps) {
	const questionId = `${idBase}-question`;
	const unavailable = saving || blocked !== null;
	return (
		<section className="chop-editor chop-delete" role="group" aria-labelledby={questionId} onKeyDown={cancelOnEscape(onCancel)}>
			<p id={questionId} className="chop-delete-question">{question}</p>
			{blocked !== null && <p className="field-error">{blocked}</p>}
			{failure !== null && <p className="field-error" role="alert">Not deleted: {failure}</p>}
			<div className="chop-editor-actions">
				<button ref={cancelRef} type="button" className="button quiet" onClick={onCancel}>Cancel</button>
				<button type="button" className="button danger" aria-disabled={unavailable} title={blocked ?? undefined} onClick={() => !unavailable && onDelete()}>{saving ? "Deleting" : "Delete"}</button>
			</div>
		</section>
	);
}
