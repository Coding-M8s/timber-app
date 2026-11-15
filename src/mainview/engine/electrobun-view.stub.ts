/**
 * Stands in for `electrobun/view` when the Electrobun devkit has not been
 * prepared (browser-only work and CI). The interface never reaches it there,
 * because it only loads the desktop engine inside an Electrobun webview.
 */
const unavailable = "The desktop bridge is unavailable in a browser build. Run `bun run dev` for the desktop app.";

export class Electroview {
	constructor() {
		throw new Error(unavailable);
	}

	static defineRPC(): never {
		throw new Error(unavailable);
	}
}
