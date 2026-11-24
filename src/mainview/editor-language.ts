import { HighlightStyle, type Language, LanguageDescription, LanguageSupport, LRLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { TERMINAL_COLOR_PROPERTIES } from "../shared/theme";
import { type TokenTag, isPhpCode, phpTags, phpTokenTags } from "./php-language";

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

/**
 * What a language needs beyond its grammar's tags, by the name its parser
 * gives it. Both the editor and the Changes view use these.
 */
export interface LanguageHooks {
	/** Tokens whose tag comes from their text or their neighbors, which the grammar's tags cannot tell. */
	tokenTags?: (tree: Tree, read: (from: number, to: number) => string, from: number, to: number) => TokenTag[];
	/**
	 * For a template language, which reads a file as a page with code in it:
	 * whether a hunk's text is the code itself, and the language that reads
	 * it as code. A hunk is a piece cut from the middle of the file, usually
	 * without the tag that opens the code.
	 */
	hunkCode?: { isCode: (text: string) => boolean; language: (language: Language) => Language };
}

/** PHP read as code from its first character, keeping HTML after `?>`. */
const phpCode = new WeakMap<Language, Language>();

const LANGUAGE_HOOKS: Record<string, LanguageHooks> = {
	php: {
		tokenTags: phpTokenTags,
		hunkCode: {
			isCode: isPhpCode,
			language: language => {
				if (!(language instanceof LRLanguage)) return language;
				let code = phpCode.get(language);
				if (code === undefined) phpCode.set(language, code = language.configure({ top: "Program" }));
				return code;
			},
		},
	},
};

/** The hooks of a language, if it has any. */
export function languageHooks(language: Language): LanguageHooks | undefined {
	return LANGUAGE_HOOKS[language.name];
}

/** The class a token's tag is colored with, or null when it is not colored. */
export function tokenClass(tag: TokenTag["tag"]): string | null {
	return codeHighlightStyle.style([tag]);
}

/** The editor's marks for a language's token tags, over the lines on screen. */
function tokenMarks(state: EditorState, view: EditorView, find: NonNullable<LanguageHooks["tokenTags"]>): DecorationSet {
	const tree = syntaxTree(state);
	const marks = view.visibleRanges.flatMap(range => find(tree, (from, to) => state.doc.sliceString(from, to), range.from, range.to))
		.flatMap(token => {
			const className = tokenClass(token.tag);
			return className === null || token.to <= token.from ? [] : [Decoration.mark({ class: className }).range(token.from, token.to)];
		});
	return Decoration.set(marks, true);
}

/**
 * Colors a language's token tags in the editor. Its marks sit inside the
 * syntax coloring's, so their color wins.
 */
function tokenTagColors(find: NonNullable<LanguageHooks["tokenTags"]>): Extension {
	return Prec.highest(ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = tokenMarks(view.state, view, find);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
				this.decorations = tokenMarks(update.state, update.view, find);
			}
		}
	}, { decorations: plugin => plugin.decorations }));
}

/** PHP as `@codemirror/language-data` loads it, with Timber's tags and token colors added. */
function withPhpColors(base: LanguageDescription): LanguageDescription {
	return LanguageDescription.of({
		name: base.name,
		alias: base.alias,
		extensions: base.extensions,
		...(base.filename === undefined ? {} : { filename: base.filename }),
		load: async () => {
			const support = await base.load();
			if (!(support.language instanceof LRLanguage)) return support;
			return new LanguageSupport(support.language.configure({ props: [phpTags] }), [support.support, tokenTagColors(phpTokenTags)]);
		},
	});
}

/** The languages the editor knows, from `@codemirror/language-data`, with PHP's colors filled in. */
const editorLanguages = languages.map(description => description.name === "PHP" ? withPhpColors(description) : description);

/** The language to color a file in, or why it stays plain. */
export function pickLanguage(path: string, text: { lines: number; length: number }): EditorLanguage {
	const name = path.split(/[\\/]/).pop() ?? path;
	const description = LanguageDescription.matchFilename(editorLanguages, name);
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
