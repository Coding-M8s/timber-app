import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { blockComment, copyLineDown, copyLineUp, defaultKeymap, deleteLine, history, historyKeymap, indentWithTab, lineComment, moveLineDown, moveLineUp, toggleBlockComment } from "@codemirror/commands";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, gotoLine, search, searchKeymap, searchPanelOpen, selectNextOccurrence, selectSelectionMatches, setSearchQuery } from "@codemirror/search";
import { Compartment, EditorState, type Extension, StateEffect, Text } from "@codemirror/state";
import { EditorView, type KeyBinding, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { codeHighlighting, describeLanguage, pickLanguage } from "../editor-language";
import { hasUnsavedEdits } from "../file-view-format";
import { useStore } from "../store/react";
import { MAX_MATCHES, describeCaret, describeLineCount, describeMatches, indentUnitOf } from "../text-editor-format";

/** After this long without typing, the text goes to the store. */
const COMMIT_MILLISECONDS = 150;

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = isMac ? "Cmd" : "Ctrl";

/** A key as a set of its parts, so "Shift-Mod-k" and "Mod-Shift-k" are the same key. */
const keyParts = (key: string) => key.split("-").map(part => part.toLowerCase()).sort().join("-");
/**
 * Keys the window keeps for itself (the palette, chops, the next session, the changes), taken out of the editor's own.
 * Ctrl+Shift+G is find previous in CodeMirror; Shift+Enter and Shift+F3 still do that here. The chop
 * shortcuts set in Settings are not followed here: they never take a key the editor binds (`RESERVED_SHORTCUTS` in
 * ../../shared/shortcuts.ts), and the window hears them first.
 */
const WINDOW_KEYS = new Set(["Mod-Shift-p", "Mod-Shift-k", "Mod-Shift-j", "Mod-Shift-g"].map(keyParts));
/**
 * What CodeMirror's keys would do beyond typing, undo, search, indenting, and toggling a line comment, which this editor
 * leaves out: go to a line, select the next match or every one, block comments, delete, move, or copy a line.
 */
const LEFT_OUT: ReadonlySet<unknown> = new Set([gotoLine, selectNextOccurrence, selectSelectionMatches, toggleBlockComment, lineComment, blockComment, deleteLine, moveLineUp, moveLineDown, copyLineUp, copyLineDown]);
const isWindowKey = (key: string | undefined) => key !== undefined && WINDOW_KEYS.has(keyParts(key));
/** A binding's Shift variant, such as find previous on Shift with Mod-g, is left out when Shift makes it a window key. */
const withoutWindowShift = (binding: KeyBinding): KeyBinding => {
	if (!binding.shift || !(isWindowKey(binding.key && `Shift-${binding.key}`) || isWindowKey(binding.mac && `Shift-${binding.mac}`))) return binding;
	const { shift: _shift, ...rest } = binding;
	return rest;
};
export const editorKeys = (bindings: readonly KeyBinding[]) => bindings
	.filter(binding => !LEFT_OUT.has(binding.run) && !isWindowKey(binding.key) && !isWindowKey(binding.mac))
	.map(withoutWindowShift);

/** The search: the text as typed (no patterns), matching case only when asked. */
const searchFor = (text: string, caseSensitive: boolean) => new SearchQuery({ search: text, caseSensitive, literal: true });

/** How many matches the query has, up to `MAX_MATCHES`, and which one is selected (-1 for none). */
function countMatches(state: EditorState): { count: number; current: number } {
	const query = getSearchQuery(state);
	if (!query.valid) return { count: 0, current: -1 };
	const { from, to } = state.selection.main;
	let count = 0;
	let current = -1;
	const cursor = query.getCursor(state);
	for (let next = cursor.next(); !next.done && count < MAX_MATCHES; next = cursor.next()) {
		if (next.value.from === from && next.value.to === to) current = count;
		count++;
	}
	return { count, current };
}

const caretOf = (state: EditorState) => {
	const head = state.selection.main.head;
	const line = state.doc.lineAt(head);
	return { line: line.number, column: head - line.from + 1, lines: state.doc.lines };
};

/**
 * The File tab's editor, on CodeMirror: one file's text with line numbers,
 * undo and redo, search, Save, coloring by language (`editor-language.ts`),
 * matching and closing brackets, and Ctrl+/ to toggle a line comment. No
 * completion, language servers, linting, or replace. CodeMirror draws and
 * colors only the lines in view, so a long file types as quickly as a short
 * one.
 *
 * Not `editable`, it shows the text read-only, as Markdown's Source and a
 * file whose line endings could not be saved, and gives nothing to the store.
 *
 * The text goes to the store's draft at once when the file turns unsaved or
 * saved, else after a short pause, and always on leaving the editor, on
 * Save, and when the editor goes. So a keystroke renders nothing but this
 * editor's status line. The editor's whole state, undo history included,
 * is kept between showings in the store's `fileEditMemory`.
 */
export function TextEditor({ worktreeId, path, draft, base, editable, saving, font, onSave }: {
	worktreeId: string;
	path: string;
	/** The text when the editor appears: the store's draft, or the file as read while there is none. */
	draft: string;
	/** The file as last read or saved, with plain new lines: the draft differs from it while unsaved. */
	base: string;
	/** False to show the text read-only. */
	editable: boolean;
	saving: boolean;
	font: { fontFamily: string; fontSize: number };
	onSave: () => void;
}) {
	const store = useStore();
	const host = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLInputElement>(null);
	const [view, setView] = useState<EditorView | null>(null);
	const [panel, setPanel] = useState<HTMLElement | null>(null);
	const [caret, setCaret] = useState(() => ({ line: 1, column: 1, lines: draft.split("\n").length }));
	const [found, setFound] = useState({ query: "", caseSensitive: false, count: 0, current: -1 });
	const baseText = useMemo(() => Text.of(base.split("\n")), [base]);
	// What the editor's handlers, made once, read when they run.
	const latest = useRef({ baseText, onSave, editable });
	latest.current = { baseText, onSave, editable };
	// Gives the store the editor's text now; set while the editor is there, for the search field's Ctrl+S.
	const commitNow = useRef<() => void>(() => {});
	// Whether the search bar should take the keyboard as it shows: not when it comes back open with the editor.
	const fieldTakesKeyboard = useRef(true);
	const [readOnly] = useState(() => new Compartment());
	const [languageSlot] = useState(() => new Compartment());
	// The language is picked once, from the name and the text the editor starts with.
	const [language] = useState(() => pickLanguage(path, { lines: draft.split("\n").length, length: draft.length }));
	const [languageProblem, setLanguageProblem] = useState<string | null>(null);

	useLayoutEffect(() => {
		const parent = host.current;
		if (!parent) return;
		const memory = store.fileEditMemory(worktreeId, path);
		// The text last given to the store; the editor starts with the draft.
		let committed: Text | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const commit = (editor: EditorView) => {
			if (timer !== null) clearTimeout(timer);
			timer = null;
			const { doc } = editor.state;
			// Read-only gives nothing; nor does an editor whose draft was dropped, as by Discard, while it goes.
			if (!latest.current.editable || memory.forgotten || committed === null || doc.eq(committed)) return;
			committed = doc;
			store.changeDraft(worktreeId, doc.toString());
		};

		const showFound = (state: EditorState) => {
			if (!searchPanelOpen(state)) return;
			const query = getSearchQuery(state);
			setFound({ query: query.search, caseSensitive: query.caseSensitive, ...countMatches(state) });
		};

		const extensions: Extension[] = [
			lineNumbers(),
			highlightActiveLineGutter(),
			highlightSpecialChars(),
			highlightActiveLine(),
			drawSelection(),
			history(),
			indentUnit.of(indentUnitOf(draft)),
			EditorState.tabSize.of(4),
			readOnly.of(EditorState.readOnly.of(!editable || saving)),
			// A parser loaded before, as for the last showing, colors at once; else it comes when loaded.
			languageSlot.of(language.kind === "colored" && language.description.support ? language.description.support : []),
			codeHighlighting,
			bracketMatching(),
			closeBrackets(),
			search({
				top: true,
				literal: true,
				createPanel: () => {
					const dom = document.createElement("div");
					dom.className = "text-editor-find";
					return { dom, top: true, mount: () => setPanel(dom), destroy: () => setPanel(null) };
				},
			}),
			keymap.of([
				...(editable ? closeBracketsKeymap : []),
				{
					key: "Mod-s",
					run: editor => {
						if (!latest.current.editable) return false;
						commit(editor);
						latest.current.onSave();
						return true;
					},
				},
				indentWithTab,
				...editorKeys(defaultKeymap),
				...editorKeys(historyKeymap),
				...editorKeys(searchKeymap),
			]),
			EditorView.contentAttributes.of({ "aria-label": `Text of ${path}`, spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
			EditorView.domEventHandlers({ blur: (_, editor) => commit(editor) }),
			EditorView.updateListener.of(update => {
				const { state } = update;
				if (update.docChanged || update.selectionSet) setCaret(caretOf(state));
				if (update.docChanged) {
					// The file turning unsaved, or saved again, goes to the store at once, so quitting asks about it. What the store
					// holds now is the measure, since a save changes the file without a change here.
					const unsaved = !state.doc.eq(latest.current.baseText);
					const shown = store.getState().files[worktreeId];
					if (!shown || unsaved !== hasUnsavedEdits(shown)) commit(update.view);
					else {
						if (timer !== null) clearTimeout(timer);
						timer = setTimeout(() => commit(update.view), COMMIT_MILLISECONDS);
					}
				}
				const searched = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setSearchQuery)));
				if (update.docChanged || update.selectionSet || searched) showFound(state);
			}),
		];

		// The state kept from the last showing, undo history and all, while it still holds the draft. It takes this editor's
		// handlers in place of the last one's.
		const kept = memory.state !== null && memory.state.doc.toString() === draft ? memory.state : null;
		const state = kept ? kept.update({ effects: StateEffect.reconfigure.of(extensions) }).state : EditorState.create({ doc: draft, extensions });
		const editor = new EditorView({ state, parent });
		committed = state.doc;
		commitNow.current = () => commit(editor);
		// A search bar that comes back open with the editor leaves the keyboard in the text.
		fieldTakesKeyboard.current = !searchPanelOpen(state);
		editor.scrollDOM.scrollTop = memory.scrollTop;
		editor.scrollDOM.scrollLeft = memory.scrollLeft;
		editor.focus();
		setView(editor);
		setCaret(caretOf(state));
		showFound(state);

		let gone = false;
		if (language.kind === "colored" && !language.description.support) {
			language.description.load().then(
				support => { if (!gone) editor.dispatch({ effects: languageSlot.reconfigure(support) }); },
				() => { if (!gone) setLanguageProblem(`Plain text: the ${language.name} coloring could not be loaded`); },
			);
		}

		return () => {
			gone = true;
			commit(editor);
			commitNow.current = () => {};
			memory.state = editor.state;
			memory.scrollTop = editor.scrollDOM.scrollTop;
			memory.scrollLeft = editor.scrollDOM.scrollLeft;
			editor.destroy();
			setView(null);
		};
		// Made once as the editor appears: later drafts come from this editor itself.
	}, []);

	useEffect(() => {
		view?.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(!editable || saving)) });
	}, [editable, readOnly, saving, view]);

	// The search field takes the keyboard when the search opens, but not when it comes back open with the editor.
	useEffect(() => {
		if (panel === null) return;
		if (fieldTakesKeyboard.current) {
			field.current?.focus();
			field.current?.select();
		}
		fieldTakesKeyboard.current = true;
	}, [panel]);

	const query = useCallback((text: string, caseSensitive: boolean) => {
		view?.dispatch({ effects: setSearchQuery.of(searchFor(text, caseSensitive)) });
	}, [view]);

	const go = (backwards: boolean) => {
		if (!view) return;
		if (backwards) findPrevious(view);
		else findNext(view);
	};

	const close = () => {
		if (!view) return;
		closeSearchPanel(view);
		view.focus();
	};

	return (
		<div className="text-editor">
			<div ref={host} className="text-editor-host" style={font} />
			{panel !== null && createPortal(
				<div className="text-editor-find-bar" role="search" aria-label={`Search ${path}`}>
					<input
						ref={field}
						// CodeMirror gives this field the keyboard when Ctrl+F is pressed with the bar open.
						main-field="true"
						type="search"
						className="text-editor-find-field"
						aria-label="Find"
						placeholder="Find"
						value={found.query}
						spellCheck={false}
						onKeyDown={event => {
							if (event.key === "Enter" || event.key === "F3") {
								event.preventDefault();
								go(event.shiftKey);
							} else if (event.key === "Escape") {
								event.preventDefault();
								close();
							} else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
								event.preventDefault();
								field.current?.select();
							} else if (editable && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
								// Save works from the search field too.
								event.preventDefault();
								commitNow.current();
								onSave();
							}
						}}
						onChange={event => query(event.target.value, found.caseSensitive)}
					/>
					<span className="text-editor-find-count" role="status">{describeMatches(found.query, found.count, found.current)}</span>
					<button type="button" className="button quiet" disabled={found.count === 0} title="Previous match (Shift+Enter)" onClick={() => go(true)}>Previous</button>
					<button type="button" className="button quiet" disabled={found.count === 0} title="Next match (Enter)" onClick={() => go(false)}>Next</button>
					<label className="text-editor-find-case">
						<input type="checkbox" checked={found.caseSensitive} onChange={event => query(found.query, event.target.checked)} />
						Match case
					</label>
					<button type="button" className="button quiet" title="Close (Escape)" onClick={close}>Close</button>
				</div>,
				panel,
			)}
			<div className="text-editor-status">
				<span>{describeCaret(caret.line, caret.column)}</span>
				<span>{describeLineCount(caret.lines)}</span>
				<span className="text-editor-language">{languageProblem ?? describeLanguage(language)}</span>
				<span className="text-editor-hint">
					{editable
						? `${MOD}+S to save, ${MOD}+F to find, ${MOD}+Z to undo, ${MOD}+/ to comment, Escape then Tab to leave the text`
						: `Read-only. ${MOD}+F to find, Escape then Tab to leave the text`}
				</span>
			</div>
		</div>
	);
}
