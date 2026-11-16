import { type ReactNode, createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppState } from "./state";
import type { AppStore } from "./store";
import { type Submission, type SubmissionState, createSubmission } from "./submission";

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

/**
 * The submission of one dialog (see ./submission.ts). When its operation
 * works, the toast is shown and `onDone` is called, which is where the dialog
 * closes itself. A failure changes `state` and leaves the dialog open.
 */
export function useSubmission(onDone: () => void): { submission: Submission; state: SubmissionState } {
	const store = useStore();
	const done = useRef(onDone);
	useEffect(() => {
		done.current = onDone;
	});
	const [submission] = useState(() => createSubmission(toast => {
		store.showToast(toast);
		done.current();
	}));
	const state = useSyncExternalStore(submission.subscribe, submission.getState, submission.getState);
	return { submission, state };
}
