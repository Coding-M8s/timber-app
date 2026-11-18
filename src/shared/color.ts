/**
 * Colors as themes hold them: CSS hex or rgb() text. Reading them and
 * measuring their contrast is pure, so it is tested without a window.
 */

/** A color with channels from 0 to 255 and an alpha from 0 to 1. */
export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

/** A color from text, or undefined when it is not one of the forms a theme takes. */
export function parseColor(text: string): Rgba | undefined {
	const value = text.trim();
	const hex = HEX.exec(value);
	if (hex) {
		let digits = hex[1]!.toLowerCase();
		if (digits.length <= 4) digits = [...digits].map(digit => digit + digit).join("");
		const channel = (at: number) => Number.parseInt(digits.slice(at, at + 2), 16);
		return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? Math.round(channel(6) / 255 * 1000) / 1000 : 1 };
	}
	const rgb = RGB.exec(value);
	if (rgb) {
		const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number];
		const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
		if (r > 255 || g > 255 || b > 255 || a > 1) return undefined;
		return { r, g, b, a };
	}
	return undefined;
}

/**
 * A color from outside, written the way themes keep it: lowercase hex, or
 * rgba() when it is see-through. Undefined when it cannot be read.
 */
export function readColor(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const color = parseColor(value);
	return color === undefined ? undefined : formatColor(color);
}

export function formatColor({ r, g, b, a }: Rgba): string {
	if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
	return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The color with this alpha, such as a meaning color made faint for a diff line's background. */
export function withAlpha(color: string, alpha: number): string {
	const parsed = parseColor(color);
	if (parsed === undefined) throw new Error(`Not a color: ${color}`);
	return formatColor({ ...parsed, a: alpha });
}

/** A see-through color as it shows over an opaque one. */
export function over(top: Rgba, below: Rgba): Rgba {
	const mix = (upper: number, lower: number) => Math.round(upper * top.a + lower * (1 - top.a));
	return { r: mix(top.r, below.r), g: mix(top.g, below.g), b: mix(top.b, below.b), a: 1 };
}

/** Relative luminance, as WCAG 2 defines it. */
function luminance({ r, g, b }: Rgba): number {
	const linear = (channel: number) => {
		const value = channel / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * The WCAG 2 contrast ratio of a color drawn on a background, from 1 to 21.
 * A see-through background is laid over `base` first, and the color over that.
 */
export function contrastRatio(color: string, background: string, base = "#000000"): number {
	const foreground = parseColor(color);
	const back = parseColor(background);
	const ground = parseColor(base);
	if (foreground === undefined || back === undefined || ground === undefined) return 1;
	const solidBack = over(back, { ...ground, a: 1 });
	const solidFore = over(foreground, solidBack);
	const [light, dark] = [luminance(solidFore), luminance(solidBack)].sort((one, other) => other - one) as [number, number];
	return (light + 0.05) / (dark + 0.05);
}
