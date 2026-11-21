import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { TERMINAL_COLOR_PROPERTIES } from "../shared/theme";

/**
 * How the File tab's editor colors a file: the language it is picked by its
 * name and extension, from `@codemirror/language-data`, whose parsers each
 * load only when a file of their kind opens. A kind it does not know, and a
 * file too long to color, stay plain, with the reason in the status line.
 */

/** A file over this many lines, or characters, stays plain. */
export const MAX_COLORED_LINES = 15_000;
export const MAX_COLORED_CHARACTERS = 768 * 1024;

export type EditorLanguage =
	| { kind: "colored"; name: string; description: LanguageDescription }
	| { kind: "plain"; reason: string };

/** The language to color a file in, or why it stays plain. */
export function pickLanguage(path: string, text: { lines: number; length: number }): EditorLanguage {
	const name = path.split(/[\\/]/).pop() ?? path;
	const description = LanguageDescription.matchFilename(languages, name);
	if (!description) return { kind: "plain", reason: "Plain text: no coloring for this kind of file" };
	if (text.lines > MAX_COLORED_LINES || text.length > MAX_COLORED_CHARACTERS) {
		return { kind: "plain", reason: `Plain text: over ${MAX_COLORED_LINES.toLocaleString("en-US")} lines or ${MAX_COLORED_CHARACTERS / 1024} KB is too long to color` };
	}
	return { kind: "colored", name: description.name, description };
}

/** What the status line says of the coloring. */
export function describeLanguage(language: EditorLanguage): string {
	return language.kind === "colored" ? language.name : language.reason;
}

/** A terminal color of the theme, as CSS, so changing the theme recolors open files. */
const terminal = (color: keyof typeof TERMINAL_COLOR_PROPERTIES) => `var(${TERMINAL_COLOR_PROPERTIES[color]})`;

/**
 * Code's colors, from the theme's terminal palette, so built-in and custom
 * themes color code as their terminals do.
 */
export const codeHighlightStyle = HighlightStyle.define([
	{ tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.modifier, tags.self], color: terminal("magenta") },
	{ tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName)), tags.function(tags.propertyName), tags.macroName], color: terminal("blue") },
	{ tag: [tags.variableName], color: terminal("foreground") },
	{ tag: [tags.definition(tags.variableName), tags.labelName], color: terminal("red") },
	{ tag: [tags.propertyName, tags.definition(tags.propertyName)], color: terminal("cyan") },
	{ tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)], color: terminal("yellow") },
	{ tag: [tags.string, tags.special(tags.string), tags.character, tags.inserted], color: terminal("green") },
	{ tag: [tags.regexp, tags.escape, tags.url], color: terminal("cyan") },
	{ tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom, tags.unit, tags.constant(tags.variableName)], color: terminal("yellow") },
	{ tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: terminal("brightBlack"), fontStyle: "italic" },
	{ tag: [tags.bracket, tags.paren, tags.squareBracket, tags.brace, tags.angleBracket, tags.punctuation, tags.separator, tags.operator, tags.derefOperator], color: terminal("brightBlue") },
	{ tag: [tags.tagName], color: terminal("red") },
	{ tag: [tags.attributeName], color: terminal("yellow") },
	{ tag: [tags.meta, tags.processingInstruction, tags.documentMeta, tags.annotation], color: terminal("brightBlack") },
	{ tag: [tags.heading], color: terminal("blue"), fontWeight: "bold" },
	{ tag: [tags.strong], fontWeight: "bold" },
	{ tag: [tags.emphasis], fontStyle: "italic" },
	{ tag: [tags.strikethrough], textDecoration: "line-through" },
	{ tag: [tags.link], color: terminal("cyan"), textDecoration: "underline" },
	{ tag: [tags.quote, tags.monospace], color: terminal("green") },
	{ tag: [tags.deleted, tags.invalid], color: terminal("brightRed") },
	{ tag: [tags.changed], color: terminal("yellow") },
]);

/** The coloring, as the editor takes it. */
export const codeHighlighting: Extension = syntaxHighlighting(codeHighlightStyle);
