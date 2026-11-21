import { opensLink } from "./terminal-format";

type Press = Pick<MouseEvent, "ctrlKey" | "metaKey"> & Partial<Pick<MouseEvent, "button">>;

/** What is under the pointer: a web link, which leaves the app, or a file path, which opens in the app's own viewer. */
export type LinkKind = "web" | "file";

/**
 * How one terminal answers clicks on its links.
 *
 * xterm finds two kinds: links that programs mark (OSC 8) and plain URLs in
 * the text. For one click it activates only the link under the pointer, so
 * each opens once here. A program that tracks the mouse, such as Claude Code
 * in fullscreen, also hears the press and may open the same link itself. So
 * a click that opens a link here is kept from the program.
 *
 * A web link opens in the browser, outside the app, so it takes Ctrl (Cmd on
 * macOS). A file path opens in the app's file viewer, so a plain left click
 * opens it.
 */
export interface TerminalLinks {
	/** A link was clicked. It opens only with Ctrl held, or Cmd on macOS. */
	activate(event: Press, uri: string): void;
	/** A file path was clicked. It opens with a plain left click. */
	activateFile(event: Press, open: () => void): void;
	/** The pointer is over a link, a web link unless it says otherwise. */
	hover(kind?: LinkKind): void;
	/** The pointer left the link. */
	leave(): void;
	/** Whether a press opens a link here, so a program that tracks the mouse must not be told of it. */
	keepsFromProgram(event: Press, mouseTracking: boolean): boolean;
}

export function terminalLinks(open: (url: string) => void, mac: boolean): TerminalLinks {
	let over: LinkKind | null = null;
	const opensFile = (event: Press) => (event.button ?? 0) === 0;
	return {
		activate(event, uri) {
			if (opensLink(event, mac)) open(uri);
		},
		activateFile(event, openFile) {
			if (opensFile(event)) openFile();
		},
		hover(kind = "web") {
			over = kind;
		},
		leave() {
			over = null;
		},
		keepsFromProgram(event, mouseTracking) {
			if (!mouseTracking || over === null) return false;
			return over === "file" ? opensFile(event) : opensLink(event, mac);
		},
	};
}
