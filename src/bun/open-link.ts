import { webLink } from "../shared/terminal";

/**
 * The command that hands a web link to the browser on this system, as an
 * executable name plus its arguments, the link last and whole: `xdg-open` on
 * Linux, `open` on macOS, and on Windows `rundll32.exe` with the
 * `url.dll,FileProtocolHandler` entry, which opens the link with the default
 * browser and reads no shell syntax. `cmd /c start` is not used, because cmd
 * reads `&`, `^`, and `%` in the link. Null elsewhere.
 */
export function openerCommand(platform: NodeJS.Platform, link: string): string[] | null {
	if (platform === "linux") return ["xdg-open", link];
	if (platform === "darwin") return ["open", link];
	if (platform === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler", link];
	return null;
}

/**
 * Open a web link from a terminal in the person's browser.
 *
 * The opener runs as an executable plus its arguments, never through a shell,
 * with the link as the URL parser writes it out (see `openerCommand`). What a
 * terminal shows comes from whatever a program printed, so it must never be
 * read by a shell. Answers whether the opener started.
 */
export function openWebLink(url: string, platform: NodeJS.Platform = process.platform, path = process.env.PATH ?? ""): boolean {
	const link = webLink(url);
	if (link === null) return false;
	const command = openerCommand(platform, link);
	if (command === null) return false;
	const [opener, ...rest] = command;
	const executable = Bun.which(opener!, { PATH: path });
	if (executable === null) return false;
	try {
		const child = Bun.spawn([executable, ...rest], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true, windowsHide: true });
		child.unref();
		return true;
	} catch {
		return false;
	}
}
