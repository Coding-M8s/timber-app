import type { SidebarIcon } from "../shared/sidebar-icons";

/**
 * Words for the icon dialog, pure so they can be tested without a window
 * (see components/SidebarIconDialog.tsx).
 */

/** The title of the dialog for a repository or a group, by the name shown in the sidebar. */
export function describeIconDialogTitle(kind: "repository" | "group", name: string): string {
	return kind === "repository" ? `Icon for ${name}` : `Icon for group ${name}`;
}

/** What the current icon is, in a few words. */
export function describeCurrentIcon(icon: SidebarIcon | null, glyphName: (icon: Extract<SidebarIcon, { kind: "bundled" }>) => string): string {
	if (!icon) return "No icon";
	if (icon.kind === "bundled") return glyphName(icon);
	if (icon.source === "file") return "An image file";
	return icon.source === "github" ? "The GitHub avatar" : "The Bitbucket icon";
}

export const ICON_FILE_LABEL = "Choose image file...";
export const ICON_FILE_HINT = "A PNG, JPEG, or WebP image of at most 32 KB and 512 pixels on a side. A copy is kept in the app's settings.";
export const ICON_REMOTE_HINT = "Fetched once now, with no login, and kept in the app's settings. Fetch it again to refresh it.";
export const NO_REMOTE_ICON = "No icon can be taken from a remote: origin is not one GitHub or Bitbucket repository, or it could not be read.";
export const REMOVE_ICON_LABEL = "Remove icon";
export const ICON_SETTINGS_NOTE = "Kept in the app's settings, never in the repository.";
