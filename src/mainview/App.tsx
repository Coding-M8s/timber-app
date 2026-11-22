import { ChopsPanel, ChopsShortcut } from "./components/ChopsPanel";
import { FilesPanel, FilesShortcut } from "./components/FilesPanel";
import { SidePanelResizer } from "./components/SidePanel";
import { Dialogs } from "./components/Dialogs";
import { PaletteShortcut } from "./components/PaletteShortcut";
import { RunChopShortcut } from "./components/RunChopDialog";
import { WaitingShortcut } from "./components/WaitingShortcut";
import { QuitDialog } from "./components/QuitDialog";
import { Sidebar } from "./components/Sidebar";
import { SidebarResizer } from "./components/SidebarResizer";
import { TimberNotice } from "./components/TimberNotice";
import { TimberUpdateBanner } from "./components/TimberUpdateBanner";
import { AppUpdateBanner } from "./components/AppUpdate";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { sameCustomThemes } from "../shared/custom-themes";
import { sameThemeChoice } from "../shared/theme";
import { TitleBar } from "./components/TitleBar";
import { TerminalPathDrops, TerminalViewKeeper } from "./components/TerminalPanel";
import { ChopsKeeper } from "./components/settings/ChopsSection";
import { Toasts } from "./components/Toasts";
import { Workspace } from "./components/Workspace";
import { StoreProvider, useAppState, useStore } from "./store/react";
import { isRunning, sidePanelShown, sidePanelView, timberReady } from "./store/state";
import type { AppStore } from "./store/store";
import { setTerminalAppearance } from "./terminal-look";
import { applySavedTheme } from "./theme-apply";
import { zoomKey } from "./zoom-keys";

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
				onChoose={() => store.openDialog({ kind: "settings", section: "executable" })}
			/>
		);
	}
	// The sidebar takes its width from here, so a narrow window can still overrule it in the stylesheet.
	const shown = sidePanelShown(state);
	const widths = { "--sidebar-width": `${state.layout.sidebarWidth}px`, ...(shown ? { "--chops-width": `${state.layout.chopsWidth}px` } : {}) } as CSSProperties;
	// The parts are put in the order they are seen, so the keyboard reaches them in that order too.
	// Keys keep each part mounted when the side changes, with whatever it holds, such as the filter.
	// The side panel, with the chops or the files, is always on the workspace's right, wherever the sidebar is.
	const panel = sidePanelView(state) === "files" ? <FilesPanel key="files" /> : <ChopsPanel key="chops" />;
	const chops = shown ? [<SidePanelResizer key="chops-resizer" />, panel] : [];
	const sidebar = [<Sidebar key="sidebar" />, <SidebarResizer key="resizer" />];
	const main = [<Workspace key="workspace" />, ...chops];
	const right = state.preferences.sidebarSide === "right";
	return (
		<>
			<AppUpdateBanner />
			<TimberUpdateBanner />
			<div className={right ? "body sidebar-right" : "body"} style={widths}>
				{right ? [...main, ...sidebar.reverse()] : [...sidebar, ...main]}
			</div>
		</>
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

/** Keeps every terminal in the saved font, size, and cursor. Open terminals follow a save at once. */
function TerminalLookKeeper() {
	const { terminal } = useAppState().preferences;
	useEffect(() => setTerminalAppearance(terminal), [terminal]);
	return null;
}

/**
 * The zoom keys, anywhere in the window. The window hears them first, before
 * a terminal or a field, so they always zoom and never reach the program in
 * a terminal. See docs/architecture.md, "Interface zoom".
 */
function ZoomKeys() {
	const store = useStore();
	useEffect(() => {
		const mac = /Mac/.test(navigator.platform);
		const onKey = (event: KeyboardEvent) => {
			const step = zoomKey(event, mac);
			if (step === null) return;
			event.preventDefault();
			event.stopPropagation();
			void store.changeZoom(step);
		};
		window.addEventListener("keydown", onKey, { capture: true });
		return () => window.removeEventListener("keydown", onKey, { capture: true });
	}, [store]);
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
				<PaletteShortcut />
				<WaitingShortcut />
				<ChopsShortcut />
				<RunChopShortcut />
				<FilesShortcut />
				{children}
				{/* Over any other dialog: the app is about to quit. */}
				<QuitDialog />
				<TerminalViewKeeper />
				<TerminalPathDrops />
				<ChopsKeeper />
				<ThemeKeeper />
				<TerminalLookKeeper />
				<ZoomKeys />
			</div>
		</StoreProvider>
	);
}
