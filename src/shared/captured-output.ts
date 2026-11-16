import type { CapturedOutput } from "./model";

/** How much of a command's output is kept. Setup scripts can print without end. */
export const OUTPUT_LIMIT_BYTES = 64 * 1024;

export interface OutputCapture {
	/** Take the next piece a process printed. */
	add(chunk: Uint8Array): void;
	/** Everything kept so far, as text. */
	finish(): CapturedOutput;
}

/**
 * Collects what a process prints while holding on to no more than `limit`
 * bytes. The end is what is kept, because that is where a failing command
 * says why it failed.
 */
export function createOutputCapture(limit: number = OUTPUT_LIMIT_BYTES): OutputCapture {
	let kept = new Uint8Array(0);
	let truncated = false;
	return {
		add(chunk) {
			if (chunk.length === 0) return;
			const total = kept.length + chunk.length;
			if (total <= limit) {
				const joined = new Uint8Array(total);
				joined.set(kept);
				joined.set(chunk, kept.length);
				kept = joined;
				return;
			}
			truncated = true;
			const joined = new Uint8Array(limit);
			const fromChunk = Math.min(chunk.length, limit);
			const fromKept = limit - fromChunk;
			joined.set(kept.subarray(kept.length - fromKept));
			joined.set(chunk.subarray(chunk.length - fromChunk), fromKept);
			kept = joined;
		},
		finish() {
			let start = 0;
			// A cut can land inside a character. Skip what is left of it (bytes of the form 10xxxxxx).
			if (truncated) while (start < kept.length && start < 3 && (kept[start]! & 0xc0) === 0x80) start++;
			return { text: plainText(new TextDecoder().decode(kept.subarray(start))), truncated };
		},
	};
}

// Colour and cursor sequences (CSI), and title sequences (OSC), that a terminal would have swallowed.
const ESCAPE_SEQUENCES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const OTHER_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Output as plain text for a details area: no terminal escape sequences, and line ends as "\n". */
export function plainText(output: string): string {
	return output.replace(ESCAPE_SEQUENCES, "").replace(/\r\n?/g, "\n").replace(OTHER_CONTROLS, "");
}
