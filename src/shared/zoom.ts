/**
 * How large the interface is drawn: 1 is the size the window system gives.
 * Everything here is pure. The main process applies it to the window (see
 * docs/architecture.md, "Interface zoom").
 */
export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

/** The zooms Settings offers. They include the fractional scales that displays are commonly set to. */
export const ZOOM_CHOICES: readonly number[] = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.6, 1.75, 2, 2.5, 3];

/** A zoom from outside, to two decimals, or undefined when it is not a number within the limits. */
export function readZoom(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const zoom = Math.round(value * 100) / 100;
	return zoom >= MIN_ZOOM && zoom <= MAX_ZOOM ? zoom : undefined;
}

/** A zoom as a percentage, such as "160%". */
export function zoomLabel(zoom: number): string {
	return `${Math.round(zoom * 100)}%`;
}

/** The zooms to offer, in order. A saved zoom that is not one of them, as after editing the file by hand, is offered too. */
export function zoomChoices(saved: number): number[] {
	const choices = ZOOM_CHOICES.includes(saved) ? [...ZOOM_CHOICES] : [...ZOOM_CHOICES, saved];
	return choices.sort((one, other) => one - other);
}

/** A change of zoom from the keyboard: one step larger, one step smaller, or back to 100%. */
export type ZoomStep = "in" | "out" | "reset";

/**
 * The zoom one step from `zoom`: the next of the zooms Settings offers, in
 * either direction, so the keyboard and the list always agree. A zoom
 * between two of them, as after editing the file by hand, goes to the
 * nearest one that way. At either end it stays.
 */
export function stepZoom(zoom: number, step: ZoomStep): number {
	if (step === "reset") return DEFAULT_ZOOM;
	if (step === "in") return ZOOM_CHOICES.find(choice => choice > zoom) ?? Math.max(zoom, ZOOM_CHOICES.at(-1)!);
	return ZOOM_CHOICES.findLast(choice => choice < zoom) ?? Math.min(zoom, ZOOM_CHOICES[0]!);
}
