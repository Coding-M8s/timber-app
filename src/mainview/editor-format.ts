import { splitCommandLine } from "../shared/command-line";
import { EDITOR_PRESETS, type EditorPreset, type EditorSetting, TERMINAL_EDITOR_REASON, describeEditorCommand, editorTarget, presetOf, sameEditorSetting } from "../shared/editor";
import type { Worktree } from "../shared/model";
import type { EditorProblem } from "./store/state";

/**
 * Words and rules for "Open in editor" and the Editor section of Settings.
 * Pure, so they can be tested without a window.
 */

export const OPEN_IN_EDITOR = "Open in editor";

/** What an "Open in editor" control offers for one worktree. */
export interface EditorAction {
	/** False when pressing it could not open anything. `reason` then says why. */
	available: boolean;
	/** True when pressing it opens Settings at Editor instead, because no usable editor is set. */
	opensSettings: boolean;
	/** The exact command it runs, or null when there is none. */
	command: string | null;
	tooltip: string;
	reason: string | null;
}

export const NO_EDITOR_HINT = "No editor is set yet. This opens Settings to choose one.";
export const FOLDER_MISSING_REASON = "The folder of this worktree is missing.";

/**
 * What "Open in editor" offers for a worktree, or for one file in it when
 * `file` names one, relative to the worktree as Git reports it.
 */
export function describeEditorAction(editor: EditorSetting | null, worktree: Pick<Worktree, "path" | "pathExists">, running: boolean, file?: string): EditorAction {
	const target = editorTarget(worktree.path, file);
	const command = editor && (target.ok ? describeEditorCommand(editor, target.path) : null);
	if (editor === null || command === null) {
		const hint = editor === null ? NO_EDITOR_HINT : "The editor command in Settings cannot be read. This opens Settings to correct it.";
		return { available: true, opensSettings: true, command: null, tooltip: `${OPEN_IN_EDITOR}. ${hint}`, reason: null };
	}
	const unavailable = (reason: string): EditorAction => ({ available: false, opensSettings: false, command, tooltip: `${OPEN_IN_EDITOR}: ${command}. ${reason}`, reason });
	if (editor.terminal) return unavailable(TERMINAL_EDITOR_REASON);
	if (!worktree.pathExists) return unavailable(FOLDER_MISSING_REASON);
	if (running) return { available: false, opensSettings: false, command, tooltip: `Opening: ${command}`, reason: null };
	return { available: true, opensSettings: false, command, tooltip: `${OPEN_IN_EDITOR}: ${command}`, reason: null };
}

/** The toast once an editor was started. */
export const describeOpenedInEditor = (label: string) => `Opened ${label} in the editor`;

/** What to tell the person when "Open in editor" did not open anything. */
export function describeEditorProblem(problem: EditorProblem, label: string): { title: string; text: string; command: string | null } {
	const title = problem.kind === "terminal-editor" ? `Cannot open ${label} in a terminal editor yet` : `Could not open ${label} in the editor`;
	return { title, text: problem.message, command: problem.command };
}

/** The choices of the Editor section: no editor, a preset, or a command of one's own. */
export type EditorChoice = "none" | EditorPreset["id"] | "other";

export const EDITOR_CHOICES: readonly { id: EditorChoice; label: string }[] = [
	{ id: "none", label: "None" },
	...EDITOR_PRESETS.map(preset => ({ id: preset.id, label: preset.label })),
	{ id: "other", label: "Other command" },
];

/** What is typed in the Editor section and not saved yet. */
export interface EditorDraft {
	choice: EditorChoice;
	command: string;
	terminal: boolean;
}

/** The choice that a command and its terminal flag amount to. */
export function choiceFor(command: string, terminal: boolean): EditorChoice {
	if (command.trim() === "") return "none";
	return presetOf({ command, terminal })?.id ?? "other";
}

/** The draft that shows what is saved. */
export function draftOf(saved: EditorSetting | null): EditorDraft {
	if (saved === null) return { choice: "none", command: "", terminal: false };
	return { choice: choiceFor(saved.command, saved.terminal), command: saved.command, terminal: saved.terminal };
}

/** The draft after picking a choice. A preset fills the fields, None empties them, and Other keeps them to edit. */
export function chooseEditor(draft: EditorDraft, choice: EditorChoice): EditorDraft {
	if (choice === "none") return { choice, command: "", terminal: false };
	if (choice === "other") return { ...draft, choice };
	const preset = EDITOR_PRESETS.find(candidate => candidate.id === choice)!;
	return { choice, command: preset.setting.command, terminal: preset.setting.terminal };
}

/**
 * The draft after typing in the command field or changing the terminal flag.
 * An emptied field stays a command to type, never quietly "None": only
 * choosing None removes the editor.
 */
export function editEditor(draft: EditorDraft, change: { command?: string; terminal?: boolean }): EditorDraft {
	const command = change.command ?? draft.command;
	const terminal = change.terminal ?? draft.terminal;
	const choice = choiceFor(command, terminal);
	return { choice: choice === "none" ? "other" : choice, command, terminal };
}

/** Editors that run in a terminal, by the name of their executable. */
const TERMINAL_EDITORS = ["nvim", "vim", "vi", "hx", "nano", "micro"];

/**
 * The name of a known terminal editor that `words` start, or null. Emacs
 * counts only with the option that keeps it in the terminal.
 */
export function knownTerminalEditor(words: readonly string[]): string | null {
	const [executable, ...args] = words;
	if (executable === undefined) return null;
	const name = (executable.split(/[\\/]/).pop() ?? executable).replace(/\.exe$/i, "").toLowerCase();
	if (TERMINAL_EDITORS.includes(name)) return name;
	if (name === "emacs" && args.some(arg => arg === "-nw" || arg === "--no-window-system")) return "emacs -nw";
	return null;
}

/** A folder to show the command with, with spaces, so the quoting shows. */
export const EXAMPLE_WORKTREE = "/work/my project-worktrees/feat login";

export interface EditorDraftModel {
	/** What Save would save: null for no editor. */
	setting: EditorSetting | null;
	/** Why the command cannot be saved, or null. */
	error: string | null;
	/** What is still to do before Save, or null. */
	hint: string | null;
	/** A command that can be saved but will likely not work as meant, or null. */
	warning: string | null;
	/** The exact command for `EXAMPLE_WORKTREE`, or null when there is none. */
	example: string | null;
	canSave: boolean;
}

export function editorDraftModel(draft: EditorDraft, saved: EditorSetting | null): EditorDraftModel {
	const none = { setting: null, error: null, hint: null, warning: null, example: null };
	if (draft.choice === "none") return { ...none, canSave: saved !== null };
	const command = draft.command.trim();
	if (command === "") return { ...none, hint: "Type a command, or choose None for no editor.", canSave: false };
	const reading = splitCommandLine(command);
	const error = !reading.ok ? reading.message : reading.words[0] === "" ? "The command starts with an empty word. Type the editor first." : null;
	if (error !== null || !reading.ok) return { ...none, error, canSave: false };
	const setting = { command, terminal: draft.terminal };
	const terminalEditor = draft.terminal ? null : knownTerminalEditor(reading.words);
	const warning = terminalEditor === null
		? null
		: `${terminalEditor} runs in a terminal. Without "Runs in a terminal" it would be started with no terminal to show it in.`;
	return { setting, error: null, hint: null, warning, example: describeEditorCommand(setting, EXAMPLE_WORKTREE), canSave: !sameEditorSetting(setting, saved) };
}
