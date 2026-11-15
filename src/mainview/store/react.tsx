import { type ReactNode, createContext, useContext, useSyncExternalStore } from "react";
import type { AppState } from "./state";
import type { AppStore } from "./store";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
	return <StoreContext value={store}>{children}</StoreContext>;
}

/** The store, for calling its actions. */
export function useStore(): AppStore {
	const store = useContext(StoreContext);
	if (!store) throw new Error("No StoreProvider above this component.");
	return store;
}

/** The current state. The component renders again whenever it changes. */
export function useAppState(): AppState {
	const store = useStore();
	return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
