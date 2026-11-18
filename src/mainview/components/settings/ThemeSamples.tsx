import { type CSSProperties, useEffect, useRef } from "react";
import { type Theme, themeVariables } from "../../../shared/theme";
import type { SampleTerminal } from "../../terminal-sample-view";

/** The theme's custom properties on an element, so everything inside is drawn in that theme. */
const themed = (theme: Theme) => themeVariables(theme) as CSSProperties;

/**
 * A small picture of the app in a theme, for a card in the picker: a sidebar
 * with a selected row, a diff, and a line of terminal colors.
 */
export function ThemePreview({ theme }: { theme: Theme }) {
	const ansi = [theme.terminal.red, theme.terminal.green, theme.terminal.yellow, theme.terminal.blue, theme.terminal.magenta, theme.terminal.cyan];
	return (
		<span className="theme-preview" style={themed(theme)} aria-hidden="true">
			<span className="theme-preview-sidebar">
				<span className="theme-preview-row selected">
					<span className="theme-preview-text" />
					<span className="theme-preview-dot" style={{ background: "var(--ahead)" }} />
				</span>
				<span className="theme-preview-row">
					<span className="theme-preview-text faint" />
					<span className="theme-preview-dot" style={{ background: "var(--behind)" }} />
				</span>
				<span className="theme-preview-row">
					<span className="theme-preview-text faint" />
					<span className="theme-preview-dot" style={{ background: "var(--modified)" }} />
				</span>
			</span>
			<span className="theme-preview-main">
				<span className="theme-preview-line" />
				<span className="theme-preview-line added" />
				<span className="theme-preview-line removed" />
				<span className="theme-preview-terminal" style={{ background: theme.terminal.background }}>
					{ansi.map((color, index) => <span key={index} className="theme-preview-swatch" style={{ background: color }} />)}
				</span>
			</span>
		</span>
	);
}

/**
 * The maker's preview of the interface: a sidebar with branch states and
 * changes, a worktree's head with its buttons, and a diff, drawn with the
 * app's own words in the theme's colors.
 */
export function ThemeSample({ theme }: { theme: Theme }) {
	return (
		<div className="theme-sample" style={themed(theme)} aria-label="Preview of the interface" role="img">
			<div className="theme-sample-sidebar">
				<p className="theme-sample-group">timber-app</p>
				<p className="theme-sample-row">
					<span className="theme-sample-branch">main</span>
					<span className="theme-sample-behind">{"↓"}2</span>
				</p>
				<p className="theme-sample-row selected">
					<span className="theme-sample-branch">feature/login</span>
					<span className="theme-sample-ahead">{"↑"}1</span>
				</p>
				<p className="theme-sample-row">
					<span className="theme-sample-sub">Agent running</span>
					<span className="theme-sample-counts">
						<span className="theme-sample-modified">3M</span> <span className="theme-sample-untracked">1U</span>
					</span>
				</p>
				<p className="theme-sample-row">
					<span className="theme-sample-branch">old-spike</span>
					<span className="theme-sample-error">force-pushed</span>
				</p>
			</div>
			<div className="theme-sample-main">
				<p className="theme-sample-title">feature/login</p>
				<p className="theme-sample-meta">2 modified, 1 untracked <span className="theme-sample-faint">No saved base</span></p>
				<p className="theme-sample-buttons">
					<span className="theme-sample-button primary">Save</span>
					<span className="theme-sample-button">Rebase</span>
					<span className="theme-sample-button danger">Delete</span>
					<span className="theme-sample-button focused">Done</span>
				</p>
				<div className="theme-sample-diff">
					<p className="theme-sample-diff-line">{"  "}export function login() {"{"}</p>
					<p className="theme-sample-diff-line removed">-{"   "}return check(user);</p>
					<p className="theme-sample-diff-line added">+{"   "}return check(user, token);</p>
					<p className="theme-sample-diff-line">{"  "}{"}"}</p>
				</div>
				<p className="theme-sample-toast">Fetch failed <span className="theme-sample-faint">offline</span></p>
			</div>
		</div>
	);
}

/**
 * The maker's preview of a terminal: a real one, showing the mock shell's
 * `sample`, so the sixteen colors, the box drawing, and the selection are seen
 * as a terminal draws them. It loads only once it is on screen.
 */
export function TerminalSample({ colors }: { colors: Theme["terminal"] }) {
	const host = useRef<HTMLDivElement>(null);
	const terminal = useRef<SampleTerminal | null>(null);
	const latest = useRef(colors);
	latest.current = colors;

	useEffect(() => {
		let gone = false;
		void import("../../terminal-sample-view").then(({ createSampleTerminal }) => {
			if (gone || !host.current) return;
			terminal.current = createSampleTerminal(host.current, latest.current);
		});
		return () => {
			gone = true;
			terminal.current?.dispose();
			terminal.current = null;
		};
	}, []);
	useEffect(() => {
		terminal.current?.setColors(colors);
	}, [colors]);

	return <div ref={host} className="theme-sample-terminal" style={{ background: colors.background }} aria-label="Preview of a terminal" role="img" />;
}
