import { describeCommandLine, splitCommandLine } from "./command-line";

/**
 * The editor that "Open in editor" starts, and how its command is built. Pure:
 * the main process runs the command (see src/bun/editor.ts), and the
 * interface shows it before it runs.
 */

/** The editor setting: one command line, and whether the editor runs in a terminal. */
export interface EditorSetting {
	/**
	 * What to run, as typed in Settings, for example `code` or
	 * `zed --new`. Split by `splitCommandLine`, never by a shell.
	 */
	command: string;
	/**
	 * True for an editor that runs in a terminal, such as Neovim. Those open in
	 * a terminal session of the worktree, which the app does not have yet.
	 */
	terminal: boolean;
}

/** Stands for the worktree's folder in a command. Without it, the folder is the last argument. */
export const PATH_TOKEN = "{path}";

export interface EditorPreset {
	id: "vscode" | "zed" | "neovim";
	label: string;
	setting: EditorSetting;
}

/** Editors offered as a starting point. Any command can be typed instead. */
export const EDITOR_PRESETS: readonly EditorPreset[] = [
	{ id: "vscode", label: "VS Code", setting: { command: "code", terminal: false } },
	{ id: "zed", label: "Zed", setting: { command: "zed", terminal: false } },
	{ id: "neovim", label: "Neovim", setting: { command: "nvim", terminal: true } },
];

/** The preset that a setting is, or null for any other command. Spaces around the command do not count. */
export function presetOf(setting: EditorSetting | null): EditorPreset | null {
	if (setting === null) return null;
	const command = setting.command.trim();
	return EDITOR_PRESETS.find(preset => preset.setting.command === command && preset.setting.terminal === setting.terminal) ?? null;
}

/** Why a terminal editor cannot be opened yet. */
export const TERMINAL_EDITOR_REASON = "Editors that run in a terminal open in a terminal session of the worktree, and the app does not have terminal sessions yet.";

export type EditorCommand =
	| { ok: true; executable: string; arguments: string[] }
	| { ok: false; message: string };

/**
 * The command that opens `path` in the editor: the executable, then its
 * arguments. The path is always exactly one argument, whatever it holds. It
 * takes the place of `{path}` where the command has it, also inside a word
 * such as `--folder={path}`, and is otherwise added as the last argument.
 */
export function editorCommand(setting: EditorSetting, path: string): EditorCommand {
	const reading = splitCommandLine(setting.command);
	if (!reading.ok) return { ok: false, message: `The editor command cannot be read: ${reading.message}` };
	const [executable, ...given] = reading.words;
	if (executable === undefined || executable === "") return { ok: false, message: "The editor command is empty." };
	const placed = given.some(word => word.includes(PATH_TOKEN));
	const args = placed ? given.map(word => word.replaceAll(PATH_TOKEN, path)) : [...given, path];
	return { ok: true, executable, arguments: args };
}

/** The command that opens `path`, as one line for showing, or null when the setting cannot be read. */
export function describeEditorCommand(setting: EditorSetting, path: string): string | null {
	const command = editorCommand(setting, path);
	return command.ok ? describeCommandLine([command.executable, ...command.arguments]) : null;
}

/** Whether a setting can be read and run: its command splits into at least an executable. */
export function readableEditorSetting(setting: EditorSetting): boolean {
	return editorCommand(setting, "").ok;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The editor preference from outside, such as the settings file or a save
 * from the interface: null for "no editor", undefined when the value is not
 * one. A command that cannot be split into an executable is not one.
 */
export function readEditorSetting(value: unknown): EditorSetting | null | undefined {
	if (value === null) return null;
	if (!isRecord(value)) return undefined;
	const { command, terminal } = value;
	if (typeof command !== "string" || typeof terminal !== "boolean") return undefined;
	const setting = { command, terminal };
	return readableEditorSetting(setting) ? setting : undefined;
}

/** The editor preference as it is written to the settings file. */
export function writeEditorSetting(setting: EditorSetting | null): { command: string; terminal: boolean } | null {
	return setting && { command: setting.command, terminal: setting.terminal };
}

export function sameEditorSetting(one: EditorSetting | null, other: EditorSetting | null): boolean {
	if (one === null || other === null) return one === other;
	return one.command === other.command && one.terminal === other.terminal;
}
