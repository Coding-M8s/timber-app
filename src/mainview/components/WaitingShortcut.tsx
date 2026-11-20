import { useEffect } from "react";
import { useStore } from "../store/react";
import { isWaitingShortcut } from "../waiting";

type WaitingKey = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey" | "repeat" | "preventDefault">;

/**
 * What the window does with a key: the chord is always the app's, so it
 * never reaches the page's host, even with none waiting. A held chord shows
 * one session, not one per repeat. Answers whether it was the chord.
 */
export function handleWaitingKey(event: WaitingKey, jump: () => boolean): boolean {
	if (!isWaitingShortcut(event)) return false;
	event.preventDefault();
	if (!event.repeat) jump();
	return true;
}

/**
 * Shows the next session that needs the person or is done from the keyboard,
 * as the title bar item does. It draws nothing. It listens on the window in
 * the capture phase, so it hears the keys of a focused terminal too. The
 * store does nothing while a dialog is open or there is none.
 */
export function WaitingShortcut() {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => void handleWaitingKey(event, () => store.jumpToWaiting());
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
	return null;
}
