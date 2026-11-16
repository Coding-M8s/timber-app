import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { AppStore } from "./store/store";
import { clipboardKey, leftInAlternateScreen, opensLink } from "./terminal-format";

/**
 * The drawn terminal of one session.
 *
 * It lives outside React, for as long as its session does, so selecting
 * another worktree and coming back finds it with its scrollback and its
 * screen as they were. A pane lends it a place on screen with `attach` and
 * takes it back with `detach`.
 */
export interface TerminalView {
	attach(container: HTMLElement): void;
	detach(): void;
	/** Fit the terminal to its place, which tells the session its new size. */
	fit(): void;
	focus(): void;
	/** Whether typing reaches the session. Off once its process ended. */
	setInput(enabled: boolean): void;
	dispose(): void;
}

const views = new Map<string, TerminalView>();

const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** A design token from the stylesheet, such as `--bg-pane`. */
function token(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value === "" ? fallback : value;
}

/**
 * The terminal's colors. Background, text, and selection follow the design
 * tokens. The sixteen ANSI colors are the programs' own, kept muted so they
 * sit on the dark surface.
 */
function theme(): ITheme {
	return {
		background: token("--bg-pane", "#0c0c0e"),
		foreground: token("--text", "#ececef"),
		cursor: token("--text", "#ececef"),
		cursorAccent: token("--bg-pane", "#0c0c0e"),
		selectionBackground: "rgba(255, 255, 255, 0.22)",
		black: "#1f1f23",
		red: "#f08b80",
		green: "#73c991",
		yellow: "#e2c08d",
		blue: "#6ea8fe",
		magenta: "#c79bf2",
		cyan: "#6ccfd8",
		white: "#a1a1aa",
		brightBlack: "#5c5c66",
		brightRed: "#ffa79d",
		brightGreen: "#93deac",
		brightYellow: "#f0d4a6",
		brightBlue: "#94c0ff",
		brightMagenta: "#dab8f7",
		brightCyan: "#93e2e9",
		brightWhite: "#ececef",
	};
}

function createView(store: AppStore, id: string): TerminalView {
	const host = document.createElement("div");
	host.className = "terminal-host";
	const terminal = new Terminal({
		fontFamily: token("--font-mono", "ui-monospace, monospace"),
		fontSize: 13,
		lineHeight: 1.2,
		cursorBlink: true,
		scrollback: 5000,
		theme: theme(),
		// Links that programs mark (OSC 8) open as plain ones do, never inside the app's own window.
		linkHandler: {
			activate: (event, uri) => {
				if (opensLink(event, isMac())) void store.openLink(uri);
			},
		},
	});
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.loadAddon(new WebLinksAddon((event, uri) => {
		event.preventDefault();
		if (opensLink(event, isMac())) void store.openLink(uri);
	}));
	terminal.onData(data => store.writeTerminal(id, data));
	terminal.onResize(({ cols, rows }) => store.resizeTerminal(id, cols, rows));
	const mac = isMac();
	terminal.attachCustomKeyEventHandler(event => {
		const action = clipboardKey(event, mac);
		if (action === "copy") {
			if (terminal.hasSelection()) void store.copyText(terminal.getSelection());
			event.preventDefault();
			return false;
		}
		if (action === "paste") {
			event.preventDefault();
			// `paste` marks it as pasted for programs that ask to know, so a pasted line is not run by itself.
			void store.pasteText().then(text => {
				if (text) terminal.paste(text);
			});
			return false;
		}
		return true;
	});
	let opened = false;
	let first = true;
	const stopWatching = store.watchTerminal(id, (draw, done) => {
		const replay = first;
		first = false;
		if (draw.reset) terminal.reset();
		terminal.write(draw.data, () => {
			done();
			// What was kept starts somewhere in the middle, so a full-screen program is drawn from half a picture.
			// Changing the size for a moment makes it draw the whole screen again.
			if ((replay || draw.reset) && leftInAlternateScreen(draw.data)) {
				store.resizeTerminal(id, terminal.cols, Math.max(1, terminal.rows - 1));
				store.resizeTerminal(id, terminal.cols, terminal.rows);
			}
		});
	});

	return {
		attach(container) {
			container.appendChild(host);
			// xterm measures its font when it opens, so it opens the first time it is on screen.
			if (!opened) {
				terminal.open(host);
				opened = true;
			}
			this.fit();
		},
		detach() {
			host.remove();
		},
		fit() {
			// A pane that is not drawn has no size, and fitting it would shrink the session to nothing.
			if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
			fitAddon.fit();
		},
		focus() {
			terminal.focus();
		},
		setInput(enabled) {
			terminal.options.disableStdin = !enabled;
			terminal.options.cursorBlink = enabled;
		},
		dispose() {
			stopWatching();
			terminal.dispose();
			host.remove();
		},
	};
}

/** The view of a session, made the first time it is asked for. */
export function terminalView(store: AppStore, id: string): TerminalView {
	let view = views.get(id);
	if (!view) {
		view = createView(store, id);
		views.set(id, view);
	}
	return view;
}

/** Let go of the views of sessions that are gone. */
export function keepTerminalViews(ids: ReadonlySet<string>): void {
	for (const [id, view] of views) {
		if (ids.has(id)) continue;
		view.dispose();
		views.delete(id);
	}
}
