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
