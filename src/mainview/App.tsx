import { Dialogs } from "./components/Dialogs";
import { QuitDialog } from "./components/QuitDialog";
import { Sidebar } from "./components/Sidebar";
import { SidebarResizer } from "./components/SidebarResizer";
import { TimberNotice } from "./components/TimberNotice";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { sameCustomThemes } from "../shared/custom-themes";
import { sameThemeChoice } from "../shared/theme";
import { TitleBar } from "./components/TitleBar";
import { TerminalViewKeeper } from "./components/TerminalPanel";
import { Toasts } from "./components/Toasts";
import { Workspace } from "./components/Workspace";
import { StoreProvider, useAppState, useStore } from "./store/react";
import { isRunning, timberReady } from "./store/state";
import type { AppStore } from "./store/store";
import { applySavedTheme } from "./theme-apply";

function Body() {
	const store = useStore();
	const state = useAppState();
	const { timber } = state;

	if (timber === null) {
		return (
			<main className="notice">
				<p className="notice-hint">Looking for Timber</p>
			</main>
		);
	}
	// Nothing that depends on Timber is offered until a usable one is found.
	if (!timberReady(state)) {
		return (
			<TimberNotice
				status={timber.known ? timber.status : null}
				failure={timber.known ? null : timber.message}
				checking={isRunning(state, "find-timber")}
				onRetry={() => void store.retryTimber()}
			/>
		);
	}
	// The sidebar takes its width from here, so a narrow window can still overrule it in the stylesheet.
	const widths = { "--sidebar-width": `${state.layout.sidebarWidth}px` } as CSSProperties;
	// The parts are put in the order they are seen, so the keyboard reaches them in that order too.
	// Keys keep each part mounted when the side changes, with whatever it holds, such as the filter.
	const parts = [<Sidebar key="sidebar" />, <SidebarResizer key="resizer" />, <Workspace key="workspace" />];
	const right = state.preferences.sidebarSide === "right";
	return (
		<div className={right ? "body sidebar-right" : "body"} style={widths}>
			{right ? parts.reverse() : parts}
		</div>
	);
}

/**
 * Keeps the page and its terminals in the saved theme as it changes: once the
 * store has read it, and after a save, of the choice or of a custom theme.
 * The first value is the store's default from before it read anything, and
 * is never applied, because the saved theme is on the page already
 * (main.tsx) and the default would flash.
 */
function ThemeKeeper() {
	const { theme: choice, customThemes } = useAppState().preferences;
	const shown = useRef({ choice, customThemes });
	useEffect(() => {
		if (sameThemeChoice(shown.current.choice, choice) && sameCustomThemes(shown.current.customThemes, customThemes)) return;
		shown.current = { choice, customThemes };
		applySavedTheme(choice, customThemes);
	}, [choice, customThemes]);
	return null;
}

/**
 * Every part below reads the one store it is given. See docs/architecture.md.
 * `children` sit over the window, inside the store: the browser build uses
 * that for its sample dialog.
 */
export function App({ store, children }: { store: AppStore; children?: ReactNode }) {
	return (
		<StoreProvider store={store}>
			<div className="app">
				<TitleBar />
				<Body />
				<Toasts />
				<Dialogs />
				{children}
				{/* Over any other dialog: the app is about to quit. */}
				<QuitDialog />
				<TerminalViewKeeper />
				<ThemeKeeper />
			</div>
		</StoreProvider>
	);
}
