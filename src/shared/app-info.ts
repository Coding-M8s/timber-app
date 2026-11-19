// A default import on purpose. Electrobun 2.0.6 reads its configuration without
// running it as Bun would, and a named import from JSON comes out empty there:
// the build then stamps its own default version, 0.1.0, without a word.
import manifest from "../../package.json";
import type { RenderingStatus } from "./rendering";

/** The name in the window title, the taskbar, the menu entry, and the installer. */
export const APP_NAME = "Timber";

/**
 * The application identifier. It is final: it names the folder the app
 * installs to and where updates look, so changing it after a release would
 * strand every install. See docs/architecture.md, "App identity".
 */
export const APP_IDENTIFIER = "com.codingm8s.timber-app";

/** One line on what the app is, shown by menus beside the name. */
export const APP_DESCRIPTION = "Every worktree, agent, and terminal in one window";

/** The app's version. package.json is the one place it is written. */
export const APP_VERSION: string = manifest.version;

/** What the app says about itself, for About. */
export interface AppInfo {
	version: string;
	/** What was decided about WebKitGTK's renderer when the app started. */
	rendering: RenderingStatus;
}
