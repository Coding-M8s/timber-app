import { describe, expect, test } from "bun:test";
import { BUNDLED_SOUNDS } from "../src/shared/sound-setting";
import { TONE_PEAK, TONE_SAMPLE_RATE, toneWav, wavFile } from "../src/shared/tones";

function text(bytes: Uint8Array, at: number, length: number): string {
	return String.fromCharCode(...bytes.slice(at, at + length));
}

describe("bundled tones", () => {
	test("a WAV file has a RIFF header for 16-bit mono PCM", () => {
		const bytes = wavFile([0, 0.5, -0.5, 1, -1, 2], 8000);
		const view = new DataView(bytes.buffer);
		expect(text(bytes, 0, 4)).toBe("RIFF");
		expect(view.getUint32(4, true)).toBe(bytes.length - 8);
		expect(text(bytes, 8, 4)).toBe("WAVE");
		expect(text(bytes, 12, 4)).toBe("fmt ");
		expect(view.getUint32(16, true)).toBe(16);
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(8000);
		expect(view.getUint32(28, true)).toBe(16000);
		expect(view.getUint16(32, true)).toBe(2);
		expect(view.getUint16(34, true)).toBe(16);
		expect(text(bytes, 36, 4)).toBe("data");
		expect(view.getUint32(40, true)).toBe(12);
		expect(bytes.length).toBe(44 + 12);
		// Samples outside -1..1 are clamped.
		expect([0, 1, 2, 3, 4, 5].map(index => view.getInt16(44 + index * 2, true))).toEqual([0, 16384, -16383, 32767, -32767, 32767]);
	});

	for (const name of BUNDLED_SOUNDS) {
		test(`${name} is short, quiet, and starts and ends near silence`, () => {
			const bytes = toneWav(name);
			const view = new DataView(bytes.buffer);
			expect(text(bytes, 0, 4)).toBe("RIFF");
			expect(view.getUint32(24, true)).toBe(TONE_SAMPLE_RATE);
			const count = view.getUint32(40, true) / 2;
			expect(bytes.length).toBe(44 + count * 2);
			expect(count / TONE_SAMPLE_RATE).toBeGreaterThan(0.1);
			expect(count / TONE_SAMPLE_RATE).toBeLessThan(0.6);
			const samples = Array.from({ length: count }, (_, index) => view.getInt16(44 + index * 2, true) / 32767);
			const loudest = Math.max(...samples.map(Math.abs));
			expect(loudest).toBeGreaterThan(TONE_PEAK * 0.9);
			expect(loudest).toBeLessThanOrEqual(TONE_PEAK + 1e-4);
			expect(Math.abs(samples[0]!)).toBeLessThan(0.01);
			expect(Math.abs(samples[count - 1]!)).toBeLessThan(0.01);
		});
	}

	test("the sounds differ from each other", () => {
		const [chime, ping, knock] = BUNDLED_SOUNDS.map(toneWav);
		expect(Bun.hash(chime!)).not.toBe(Bun.hash(ping!));
		expect(Bun.hash(ping!)).not.toBe(Bun.hash(knock!));
	});
});
