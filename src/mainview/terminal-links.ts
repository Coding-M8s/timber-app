import { opensLink } from "./terminal-format";

type Press = Pick<MouseEvent, "ctrlKey" | "metaKey">;

/**
 * How one terminal answers clicks on its links.
 *
 * xterm finds two kinds: links that programs mark (OSC 8) and plain URLs in
 * the text. For one click it activates only the link under the pointer, so
 * each opens once here. A program that tracks the mouse, such as Claude Code
 * in fullscreen, also hears the press and may open the same link itself. So
 * a click that opens a link here is kept from the program.
 */
export interface TerminalLinks {
	/** A link was clicked. It opens only with Ctrl held, or Cmd on macOS. */
	activate(event: Press, uri: string): void;
	/** The pointer is over a link. */
	hover(): void;
	/** The pointer left the link. */
	leave(): void;
	/** Whether a press opens a link here, so a program that tracks the mouse must not be told of it. */
	keepsFromProgram(event: Press, mouseTracking: boolean): boolean;
}

export function terminalLinks(open: (url: string) => void, mac: boolean): TerminalLinks {
	let overLink = false;
	return {
		activate(event, uri) {
			if (opensLink(event, mac)) open(uri);
		},
		hover() {
			overLink = true;
		},
		leave() {
			overLink = false;
		},
		keepsFromProgram(event, mouseTracking) {
			return mouseTracking && overLink && opensLink(event, mac);
		},
	};
}
