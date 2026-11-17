/**
 * Makes the app icons in icons/ from the Timber logo. Run it with
 * `bun run icons` after the logo changes, and commit what it writes.
 *
 * It needs ImageMagick 7 (`magick`) on the PATH. The logo is 256 pixels
 * square, so every larger size is scaled up from it and looks soft. Replace
 * the logo with a larger one and run this again to sharpen them.
 */
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const logo = join(root, "src/mainview/assets/logo.png");
const icons = join(root, "icons");
const iconset = join(icons, "icon.iconset");

/** The size of the Linux icon, used for the menu entry, the window, and the taskbar. */
const LINUX_SIZE = 512;
/** The sizes inside the Windows icon. 256 is the largest an ICO file holds. */
const WINDOWS_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** The sizes macOS asks for in an iconset. Each also comes at twice the pixels. */
const MAC_SIZES = [16, 32, 128, 256, 512];

async function magick(...parameters: string[]): Promise<void> {
	const child = Bun.spawn(["magick", ...parameters], { stdout: "inherit", stderr: "inherit" });
	if (await child.exited !== 0) throw new Error(`magick ${parameters.join(" ")} failed`);
}

function scaled(size: number, target: string): Promise<void> {
	return magick(logo, "-filter", "Lanczos", "-resize", `${size}x${size}`, "-strip", target);
}

await rm(icons, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });

await scaled(LINUX_SIZE, join(icons, "icon.png"));
await magick(logo, "-define", `icon:auto-resize=${WINDOWS_SIZES.toReversed().join(",")}`, join(icons, "icon.ico"));
for (const size of MAC_SIZES) {
	await scaled(size, join(iconset, `icon_${size}x${size}.png`));
	await scaled(size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
}
console.log(`Wrote the icons to ${icons}`);
