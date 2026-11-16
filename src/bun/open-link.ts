import { webLink } from "../shared/terminal";

/**
 * Open a web link from a terminal in the person's browser.
 *
 * The opener runs as an executable plus one argument, never through a shell,
 * with the link as the URL parser writes it out: `xdg-open` on Linux, `open`
 * on macOS. What a terminal shows comes from whatever a program printed, so
 * it must never be read by a shell. Elsewhere nothing is opened yet. Answers
 * whether the opener started.
 */
export function openWebLink(url: string, platform: NodeJS.Platform = process.platform, path = process.env.PATH ?? ""): boolean {
	const link = webLink(url);
	if (link === null) return false;
	const opener = platform === "linux" ? "xdg-open" : platform === "darwin" ? "open" : null;
	const executable = opener === null ? null : Bun.which(opener, { PATH: path });
	if (executable === null) return false;
	try {
		const child = Bun.spawn([executable, link], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true });
		child.unref();
		return true;
	} catch {
		return false;
	}
}
