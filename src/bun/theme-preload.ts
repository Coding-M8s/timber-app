/**
 * The script the window runs at the start of every page load, before the
 * page's own stylesheet and script: it puts the saved theme's stylesheet on
 * the page, so the first thing drawn is already in the saved colors. The
 * interface takes the same style element over by its id
 * (src/mainview/theme-apply.ts). See docs/architecture.md, "Themes".
 */
import { THEME_STYLE_ID } from "../shared/theme";

/** The preload script for a stylesheet. It is plain script with the stylesheet as a string, and never throws. */
export function themePreload(styleSheet: string): string {
	return `(() => {
	try {
		const put = () => {
			const root = document.documentElement;
			if (!root) return false;
			if (document.getElementById(${JSON.stringify(THEME_STYLE_ID)})) return true;
			const style = document.createElement("style");
			style.id = ${JSON.stringify(THEME_STYLE_ID)};
			style.textContent = ${JSON.stringify(styleSheet)};
			(document.head || root).appendChild(style);
			return true;
		};
		if (!put()) {
			const watcher = new MutationObserver(() => {
				if (put()) watcher.disconnect();
			});
			watcher.observe(document, { childList: true, subtree: true });
		}
	} catch {}
})();`;
}
