import { Unicode11Addon } from "@xterm/addon-unicode11";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalSample } from "./terminal-sample";

/**
 * A terminal that shows the mock shell's `sample` and takes no input, for
 * the theme maker's preview. Loaded only when the maker shows, as the real
 * terminals are, so xterm stays out of the rest of the app.
 */
export interface SampleTerminal {
	setColors(colors: ITheme): void;
	dispose(): void;
}

export function createSampleTerminal(host: HTMLElement, colors: ITheme): SampleTerminal {
	const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-terminal").trim() || "monospace";
	const terminal = new Terminal({
		cols: 62,
		rows: 14,
		fontFamily,
		fontSize: 12,
		lineHeight: 1.2,
		disableStdin: true,
		cursorBlink: false,
		cursorInactiveStyle: "none",
		allowProposedApi: true,
		theme: { ...colors },
	});
	terminal.loadAddon(new Unicode11Addon());
	terminal.unicode.activeVersion = "11";
	terminal.open(host);
	terminal.write(`${terminalSample()}\r\n\x1b[36mtimber-app\x1b[0m \x1b[3mmain\x1b[0m ❯ `);
	return {
		setColors(next) {
			terminal.options.theme = { ...next };
		},
		dispose() {
			terminal.dispose();
		},
	};
}
