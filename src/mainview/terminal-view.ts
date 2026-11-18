import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { AppStore } from "./store/store";
import { terminalColors, watchTerminalColors } from "./terminal-colors";
import { clipboardKey, leftInAlternateScreen, opensLink, sessionChipId, sessionKey } from "./terminal-format";

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

const FONT_SIZE = 13;
/** How long the first terminal waits for its font before it opens with whatever is there. */
const FONT_WAIT_MILLISECONDS = 1500;

const fontFamily = () => token("--font-terminal", "ui-monospace, monospace");

/**
 * Resolves once the terminal's font is loaded, or after a short wait. xterm
 * measures a cell when it opens: measured with a stand-in font, every cell is
 * the wrong width and the text looks cut. Never rejects.
 */
export function terminalFontReady(): Promise<void> {
	const fonts = typeof document === "undefined" ? undefined : document.fonts;
	if (!fonts) return Promise.resolve();
	const family = fontFamily();
	const loaded = Promise.all([fonts.load(`${FONT_SIZE}px ${family}`), fonts.load(`600 ${FONT_SIZE}px ${family}`)]).then(() => {}, () => {});
	return Promise.race([loaded, new Promise<void>(resolve => setTimeout(resolve, FONT_WAIT_MILLISECONDS))]);
}

/** Off once the window showed it cannot draw with WebGL, so no later terminal tries again. */
let webglWorks = true;

function createView(store: AppStore, id: string): TerminalView {
	const host = document.createElement("div");
	host.className = "terminal-host";
	const terminal = new Terminal({
		fontFamily: fontFamily(),
		fontSize: FONT_SIZE,
		fontWeight: "400",
		fontWeightBold: "600",
		lineHeight: 1.2,
		cursorBlink: true,
		cursorInactiveStyle: "outline",
		scrollback: 10000,
		// A glyph from a stand-in font, such as a prompt's icon, is scaled into its cell instead of being cut at the edge.
		rescaleOverlappingGlyphs: true,
		// The width table below is a proposed part of xterm's API.
		allowProposedApi: true,
		// The theme's, and they follow it: xterm redraws at once, keeping the screen and the scrollback.
		theme: { ...terminalColors() },
		// Links that programs mark (OSC 8) open as plain ones do, never inside the app's own window.
		linkHandler: {
			activate: (event, uri) => {
				if (opensLink(event, isMac())) void store.openLink(uri);
			},
		},
	});
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	// Emoji and other wide characters take the two cells that today's programs count for them, so a full-screen program's columns line up.
	terminal.loadAddon(new Unicode11Addon());
	terminal.unicode.activeVersion = "11";
	terminal.loadAddon(new WebLinksAddon((event, uri) => {
		event.preventDefault();
		if (opensLink(event, isMac())) void store.openLink(uri);
	}));
	terminal.onData(data => store.writeTerminal(id, data));
	terminal.onResize(({ cols, rows }) => store.resizeTerminal(id, cols, rows));
	const mac = isMac();
	terminal.attachCustomKeyEventHandler(event => {
		// Switching sessions and going to the chips are the app's keys, never the program's.
		const move = sessionKey(event, mac);
		if (move !== null) {
			event.preventDefault();
			if (move === "chips") document.getElementById(sessionChipId(id))?.focus();
			else store.stepSession(id, move === "next" ? 1 : -1);
			return false;
		}
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
	/**
	 * The WebGL drawing, held only while the terminal is on screen, because a
	 * window gets a limited number of WebGL contexts. It draws faster than the
	 * elements xterm falls back to, lands every cell on whole device pixels at
	 * any display scale, and draws lines and blocks itself so boxes join with
	 * no gaps between rows.
	 */
	let webgl: WebglAddon | null = null;
	const drawWithWebgl = () => {
		if (webgl !== null || !webglWorks) return;
		try {
			const addon = new WebglAddon();
			// The system took the context away. Elements draw until the terminal shows again.
			addon.onContextLoss(() => {
				addon.dispose();
				if (webgl === addon) webgl = null;
			});
			terminal.loadAddon(addon);
			webgl = addon;
		} catch {
			webglWorks = false;
		}
	};
	const drawWithElements = () => {
		webgl?.dispose();
		webgl = null;
	};
	const stopColors = watchTerminalColors(colors => {
		terminal.options.theme = { ...colors };
	});
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
			drawWithWebgl();
			this.fit();
		},
		detach() {
			drawWithElements();
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
			stopColors();
			drawWithElements();
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
