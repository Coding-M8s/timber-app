/**
 * Text as win32-input-mode key events, for writing to a Windows pseudo
 * console (ConPTY).
 *
 * ConPTY reads what is written to it as keyboard input and drops the escape
 * sequences it does not know, such as an OSC reply. ConPTY turns on
 * win32-input-mode (`ESC [ ? 9001 h`) when it starts, and then takes each key
 * as `ESC [ Vk ; Sc ; Uc ; Kd ; Cs ; Rc _`: virtual key code, scan code,
 * UTF-16 code unit, 1 for a key press or 0 for a release, control key state,
 * and repeat count. Sent this way, every character, ESC included, reaches the
 * program as typed.
 *
 * Each UTF-16 code unit becomes a press and a release with no virtual key or
 * scan code. A program in raw mode on ConPTY (Windows 11 build 26200, Bun
 * 1.4.4) read exactly the original text, once.
 */
export function asWin32KeyEvents(text: string): string {
	let keys = "";
	for (let index = 0; index < text.length; index++) {
		const unit = text.charCodeAt(index);
		keys += `\x1b[0;0;${unit};1;0;1_\x1b[0;0;${unit};0;0;1_`;
	}
	return keys;
}
