import { useAppState, useStore } from "../store/react";

/**
 * Short notes that an operation worked, in a corner of the window. Each goes
 * away on its own (the store times it) or when it is dismissed. The region is
 * always there, so a screen reader announces a toast when it arrives.
 */
export function Toasts() {
	const store = useStore();
	const { toasts } = useAppState();
	return (
		<div className="toasts" aria-live="polite">
			{toasts.map(toast => (
				<div key={toast.id} className="toast">
					<svg className="toast-mark" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
						<path d="M2.5 6.5 5 9l4.5-6" />
					</svg>
					<span className="toast-text">{toast.text}</span>
					<button type="button" className="icon-button toast-dismiss" aria-label={`Dismiss: ${toast.text}`} onClick={() => store.dismissToast(toast.id)}>
						<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
							<path d="M2.5 2.5l6 6M8.5 2.5l-6 6" />
						</svg>
					</button>
				</div>
			))}
		</div>
	);
}
