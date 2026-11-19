import type { BundledSound } from "./sound-setting";

/**
 * The sounds that come with the app, made as small WAV files: 16-bit mono
 * PCM at TONE_SAMPLE_RATE. Pure. Each note fades in and out so there is no
 * click, and the loudest sample is TONE_PEAK of full scale, so they stay quiet.
 */
export const TONE_SAMPLE_RATE = 22050;
/** The loudest sample, as a share of full scale. */
export const TONE_PEAK = 0.3;

interface Note {
	/** When it starts, in seconds. */
	at: number;
	/** How long it lasts, in seconds, fade out included. */
	length: number;
	/** Pitch in hertz at the start. */
	frequency: number;
	/** Pitch in hertz at the end; the same as `frequency` when left out. */
	endFrequency?: number;
	/** How loud, before the whole sound is scaled to TONE_PEAK. */
	level: number;
	/** How fast it dies away: larger is shorter. */
	decay: number;
	/** How loud a second partial an octave up is, for a brighter sound. */
	overtone?: number;
}

/** Fade in over this long, so a note starts without a click. */
const ATTACK_SECONDS = 0.006;
/** Fade out over this long at the end of each note. */
const RELEASE_SECONDS = 0.03;

const NOTES: Record<BundledSound, { length: number; notes: Note[] }> = {
	// Two soft notes, a fourth apart, the second over the first.
	chime: {
		length: 0.55,
		notes: [
			{ at: 0, length: 0.4, frequency: 659.25, level: 1, decay: 7 },
			{ at: 0.13, length: 0.42, frequency: 880, level: 0.9, decay: 7 },
		],
	},
	// One short bright note.
	ping: {
		length: 0.3,
		notes: [{ at: 0, length: 0.3, frequency: 1318.5, level: 1, decay: 14, overtone: 0.25 }],
	},
	// Two short low thumps, each falling in pitch.
	knock: {
		length: 0.32,
		notes: [
			{ at: 0, length: 0.1, frequency: 180, endFrequency: 110, level: 1, decay: 30, overtone: 0.3 },
			{ at: 0.16, length: 0.1, frequency: 180, endFrequency: 110, level: 0.9, decay: 30, overtone: 0.3 },
		],
	},
};

/** How loud a note is `time` seconds after it started: a short fade in, a fall, and a fade to zero at its end. */
function envelope(note: Note, time: number): number {
	if (time < 0 || time >= note.length) return 0;
	const attack = time < ATTACK_SECONDS ? 0.5 - 0.5 * Math.cos((Math.PI * time) / ATTACK_SECONDS) : 1;
	const left = note.length - time;
	const release = left < RELEASE_SECONDS ? 0.5 - 0.5 * Math.cos((Math.PI * left) / RELEASE_SECONDS) : 1;
	return attack * release * Math.exp(-note.decay * time);
}

/** The samples of one bundled sound, from -1 to 1, the loudest at TONE_PEAK. */
export function toneSamples(name: BundledSound): Float64Array {
	const { length, notes } = NOTES[name];
	const samples = new Float64Array(Math.round(length * TONE_SAMPLE_RATE));
	for (const note of notes) {
		const end = note.endFrequency ?? note.frequency;
		let phase = 0;
		const first = Math.round(note.at * TONE_SAMPLE_RATE);
		const count = Math.round(note.length * TONE_SAMPLE_RATE);
		for (let index = 0; index < count && first + index < samples.length; index += 1) {
			const time = index / TONE_SAMPLE_RATE;
			// The pitch moves from `frequency` to `end` across the note; the phase follows it so the wave stays smooth.
			const frequency = note.frequency + (end - note.frequency) * (time / note.length);
			phase += (2 * Math.PI * frequency) / TONE_SAMPLE_RATE;
			const wave = Math.sin(phase) + (note.overtone ?? 0) * Math.sin(2 * phase);
			samples[first + index]! += note.level * envelope(note, time) * wave;
		}
	}
	let loudest = 0;
	for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
	if (loudest > 0) for (let index = 0; index < samples.length; index += 1) samples[index] = (samples[index]! / loudest) * TONE_PEAK;
	return samples;
}

/** A WAV file of 16-bit mono PCM from samples between -1 and 1. */
export function wavFile(samples: ArrayLike<number>, sampleRate: number): Uint8Array {
	const dataLength = samples.length * 2;
	const bytes = new Uint8Array(44 + dataLength);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, value: string) => {
		for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + dataLength, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true); // size of the format chunk
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // bytes per second
	view.setUint16(32, 2, true); // bytes per frame
	view.setUint16(34, 16, true); // bits per sample
	text(36, "data");
	view.setUint32(40, dataLength, true);
	for (let index = 0; index < samples.length; index += 1) {
		const clamped = Math.max(-1, Math.min(1, samples[index]!));
		view.setInt16(44 + index * 2, Math.round(clamped * 32767), true);
	}
	return bytes;
}

/** One bundled sound as a WAV file. */
export function toneWav(name: BundledSound): Uint8Array {
	return wavFile(toneSamples(name), TONE_SAMPLE_RATE);
}
