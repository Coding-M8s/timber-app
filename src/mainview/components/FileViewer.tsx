import { useEffect, useMemo, useState } from "react";
import type { Worktree } from "../../shared/model";
import { terminalFontStack } from "../../shared/terminal-appearance";
import { textLines } from "../../shared/worktree-files";
import { OPEN_IN_EDITOR } from "../editor-format";
import { describeFileNotice } from "../file-view-format";
import { useStore } from "../store/react";
import type { FileView } from "../store/state";
import { terminalAppearance, watchTerminalAppearance } from "../terminal-look";
import { EditorIcon, useOpenInEditor } from "./OpenInEditor";

/** The terminal's font and size from Settings, Terminal, following every change. */
function useTerminalFont(): { fontFamily: string; fontSize: number } {
	const [appearance, setAppearance] = useState(terminalAppearance);
	useEffect(() => watchTerminalAppearance(setAppearance), []);
	return { fontFamily: terminalFontStack(appearance.fontFamily), fontSize: appearance.fontSize };
}

/**
 * The File tab: one file of the worktree, read-only, with line numbers, in
 * the terminal's font. The numbers and the text are two blocks side by side,
 * not an element per line, so a long file draws quickly.
 */
export function FileViewer({ repository, worktree, view }: { repository: string; worktree: Worktree; view: FileView }) {
	const store = useStore();
	const font = useTerminalFont();
	const { action, open } = useOpenInEditor(repository, worktree, view.path);
	const { result } = view;
	const text = result?.outcome === "read" && result.content.kind === "text" ? result.content.text : null;
	const lines = useMemo(() => text === null ? null : textLines(text), [text]);
	const numbers = useMemo(() => lines === null ? "" : lines.map((_, index) => index + 1).join("\n"), [lines]);
	const notice = result === null ? null : describeFileNotice(result);
	const onDisk = result?.outcome === "read";

	return (
		<section className="file-viewer" aria-label={`File ${view.path}`}>
			<div className="diff-title file-viewer-title">
				<span className="diff-path" title={view.path}>{view.path}</span>
				<span className="diff-area">Read-only</span>
				<button type="button" className="button quiet diff-editor" onClick={() => store.readFileAgain(worktree.id)}>Read again</button>
				{onDisk && (
					<button
						type="button"
						className="button quiet diff-editor"
						title={action.tooltip}
						aria-haspopup={action.opensSettings ? "dialog" : undefined}
						disabled={!action.available}
						onClick={open}
					>
						<EditorIcon />
						{OPEN_IN_EDITOR}
					</button>
				)}
				<button type="button" className="button quiet diff-editor" onClick={() => store.closeFile(worktree.id)}>Close</button>
			</div>
			{result === null && <p className="diff-reading" role="status">Reading {view.path}</p>}
			{notice !== null && (
				<div className="diff-notice" role="status">
					<p className="empty-title">{notice.title}</p>
					<p className="empty-text">{notice.text}</p>
				</div>
			)}
			{lines !== null && (
				<div className="file-viewer-body" tabIndex={0} aria-label={`Text of ${view.path}`} style={font}>
					{lines.length === 0
						? <p className="diff-reading">This file is empty.</p>
						: (
							<div className="file-viewer-lines">
								<pre className="file-viewer-numbers" aria-hidden="true">{numbers}</pre>
								<pre className="file-viewer-text">{lines.join("\n")}</pre>
							</div>
						)}
				</div>
			)}
		</section>
	);
}
