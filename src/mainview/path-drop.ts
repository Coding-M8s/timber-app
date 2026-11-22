import { carriesDroppedPaths, droppedPaths, pathsPasteText } from "./terminal-drop";

/** The attribute that makes an element a place to drop paths, naming the session they paste into. */
export const DROP_SESSION_ATTRIBUTE = "data-drop-session";
/** The class of the place to drop while paths are dragged over it. */
export const DROP_TARGET_CLASS = "drop-target";

/**
 * How long after the last drag event over a place it stops looking like one.
 * A drag over it fires every few dozen milliseconds, and leaves and enters
 * again as it crosses the terminal's layers, so its leaving alone says little.
 */
const LEAVE_MILLISECONDS = 150;

/**
 * Files and paths dragged anywhere in the window. Over a running session's
 * terminal they show it as a place to drop, and dropped there their paths
 * paste at its prompt. Anywhere else a drop does nothing: not the webview
 * opening the file, and not a field or the editor taking it. Text drags are
 * left alone. Answers how to stop watching.
 *
 * A drop of several files can still make WebKitGTK open one of them whatever
 * the page does, so the main process also keeps the window from going to a
 * `file:` address (src/bun/index.ts).
 */
export function watchPathDrops(target: Window, paste: (session: string, text: string) => void): () => void {
	let shown: Element | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const show = (place: Element | null) => {
		clearTimeout(timer);
		if (shown === place) return;
		shown?.classList.remove(DROP_TARGET_CLASS);
		shown = place;
		place?.classList.add(DROP_TARGET_CLASS);
	};
	const placeOf = (event: Event) => (event.target instanceof Element ? event.target.closest(`[${DROP_SESSION_ATTRIBUTE}]`) : null);
	const ours = (event: DragEvent) => {
		const data = event.dataTransfer;
		if (!data || !carriesDroppedPaths([...data.types])) return null;
		event.preventDefault();
		event.stopPropagation();
		return data;
	};

	const over = (event: DragEvent) => {
		const data = ours(event);
		if (!data) return;
		const place = placeOf(event);
		data.dropEffect = place ? "copy" : "none";
		show(place);
	};
	const leave = (event: DragEvent) => {
		if (!event.dataTransfer || !carriesDroppedPaths([...event.dataTransfer.types])) return;
		clearTimeout(timer);
		timer = setTimeout(() => show(null), LEAVE_MILLISECONDS);
	};
	const drop = (event: DragEvent) => {
		const data = ours(event);
		if (!data) return;
		const place = placeOf(event);
		show(null);
		const session = place?.getAttribute(DROP_SESSION_ATTRIBUTE);
		if (!session) return;
		const text = pathsPasteText(droppedPaths(type => data.getData(type)));
		if (text !== "") paste(session, text);
	};
	const end = () => show(null);

	target.addEventListener("dragenter", over, true);
	target.addEventListener("dragover", over, true);
	target.addEventListener("dragleave", leave, true);
	target.addEventListener("drop", drop, true);
	target.addEventListener("dragend", end, true);
	return () => {
		target.removeEventListener("dragenter", over, true);
		target.removeEventListener("dragover", over, true);
		target.removeEventListener("dragleave", leave, true);
		target.removeEventListener("drop", drop, true);
		target.removeEventListener("dragend", end, true);
		show(null);
	};
}
