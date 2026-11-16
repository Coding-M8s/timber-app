import { useEffect, useId, useRef } from "react";
import { useAppState, useStore } from "../store/react";
import { describeQuitRequest } from "../terminal-format";

/**
 * Asked when the app is about to quit, or its window to close, while
 * terminals run. Nothing quits until Quit is pressed. Focus starts on the
 * button that keeps the app open, and Escape keeps it open too.
 */
export function QuitDialog() {
	const store = useStore();
	const { quitRequest } = useAppState();
	if (quitRequest === null) return null;
	return <QuitQuestion live={quitRequest} onQuit={() => void store.confirmQuit()} onStay={() => store.cancelQuit()} />;
}

function QuitQuestion({ live, onQuit, onStay }: { live: number; onQuit: () => void; onStay: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const textId = useId();
	const { title, text } = describeQuitRequest(live);

	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);

	return (
		<dialog
			ref={dialog}
			className="dialog quit-dialog"
			role="alertdialog"
			aria-labelledby={titleId}
			aria-describedby={textId}
			onCancel={event => {
				event.preventDefault();
				onStay();
			}}
		>
			<div className="dialog-form">
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">{title}</h2>
				</header>
				<p id={textId} className="dialog-note">{text}</p>
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button type="button" className="button quiet" autoFocus onClick={onStay}>Keep running</button>
						<button type="button" className="button danger" onClick={onQuit}>Quit</button>
					</div>
				</footer>
			</div>
		</dialog>
	);
}
