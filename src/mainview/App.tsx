import { Sidebar } from "./components/Sidebar";
import { TimberNotice } from "./components/TimberNotice";
import type { ReactNode } from "react";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { Workspace } from "./components/Workspace";
import { StoreProvider, useAppState, useStore } from "./store/react";
import { isRunning, timberReady } from "./store/state";
import type { AppStore } from "./store/store";

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
	return (
		<div className="body">
			<Sidebar />
			<Workspace />
		</div>
	);
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
				{children}
			</div>
		</StoreProvider>
	);
}
