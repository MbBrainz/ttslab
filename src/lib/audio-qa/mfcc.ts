import { fft } from "./fft";

/**
 * MFCC frames — a phonetic-content representation, tolerant of the exact
 * acoustic realization differing between two utterances of the same word.
 *
 * Used by `repeat-similarity.ts`. Kept as its own module because MFCCs are a
 * general primitive, not specific to that one (currently non-gating) detector.
 */

const FRAME_SAMPLES = 400; // 25ms @ 16k
const HOP_SAMPLES = 160; // 10ms
const NFFT = 512;
const MEL_BINS = 26;
/** c0 is loudness, so it is dropped: c1..c12 survive. */
const N_COEFFS = 13;
export const MFCC_HOP_SEC = HOP_SAMPLES / 16_000;
export const MFCC_DIM = N_COEFFS - 1;

const hzToMel = (hz: number) => 1127 * Math.log(1 + hz / 700);

const MEL_BANK = (() => {
	const bins = NFFT / 2;
	const low = hzToMel(20);
	const high = hzToMel(7600);
	const step = (high - low) / (MEL_BINS + 1);
	return Array.from({ length: MEL_BINS }, (_, m) => {
		const left = low + m * step;
		const center = left + step;
		const right = left + 2 * step;
		const row = new Float32Array(bins);
		for (let k = 0; k < bins; k++) {
			const mel = hzToMel((k * 16_000) / NFFT);
			if (mel > left && mel < right) {
				row[k] =
					mel <= center
						? (mel - left) / (center - left)
						: (right - mel) / (right - center);
			}
		}
		return row;
	});
})();

const HAMMING = Float32Array.from(
	{ length: FRAME_SAMPLES },
	(_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_SAMPLES - 1)),
);

const DCT = Array.from({ length: N_COEFFS }, (_, k) =>
	Float32Array.from({ length: MEL_BINS }, (_, m) =>
		Math.cos((Math.PI * k * (m + 0.5)) / MEL_BINS),
	),
);

function resampleTo16k(pcm: Float32Array, sampleRate: number): Float32Array {
	if (sampleRate === 16_000) return pcm;
	const ratio = sampleRate / 16_000;
	const out = new Float32Array(Math.round(pcm.length / ratio));
	for (let i = 0; i < out.length; i++) {
		const src = i * ratio;
		const lo = Math.floor(src);
		const hi = Math.min(lo + 1, pcm.length - 1);
		out[i] = pcm[lo] * (1 - (src - lo)) + pcm[hi] * (src - lo);
	}
	return out;
}

/**
 * Returns CMN'd, L2-normalised MFCC frames, ready for cosine comparison.
 *
 * Mean normalisation and L2 scaling are deliberate: without them a cosine
 * between frames is dominated by overall level and channel shape rather than by
 * phonetic content, which is the thing a repeat detector needs to compare.
 */
export function mfccFrames(
	pcm: Float32Array,
	sampleRate: number,
): Float32Array[] {
	const audio = resampleTo16k(pcm, sampleRate);
	const frameCount =
		1 + Math.floor((audio.length - FRAME_SAMPLES) / HOP_SAMPLES);
	if (frameCount < 1) return [];

	const raw: Float32Array[] = [];
	const re = new Float64Array(NFFT);
	const im = new Float64Array(NFFT);

	for (let f = 0; f < frameCount; f++) {
		const offset = f * HOP_SAMPLES;
		const frame = new Float64Array(FRAME_SAMPLES);
		for (let i = 0; i < FRAME_SAMPLES; i++) frame[i] = audio[offset + i];
		for (let i = FRAME_SAMPLES - 1; i > 0; i--) frame[i] -= 0.97 * frame[i - 1];

		re.fill(0);
		im.fill(0);
		for (let i = 0; i < FRAME_SAMPLES; i++) re[i] = frame[i] * HAMMING[i];
		fft(re, im);

		const logMel = new Float32Array(MEL_BINS);
		for (let m = 0; m < MEL_BINS; m++) {
			let energy = 0;
			const weights = MEL_BANK[m];
			for (let k = 0; k < NFFT / 2; k++) {
				if (weights[k]) energy += weights[k] * (re[k] * re[k] + im[k] * im[k]);
			}
			logMel[m] = Math.log(Math.max(energy, 1e-10));
		}

		const coeffs = new Float32Array(MFCC_DIM);
		for (let k = 1; k < N_COEFFS; k++) {
			let sum = 0;
			for (let m = 0; m < MEL_BINS; m++) sum += logMel[m] * DCT[k][m];
			coeffs[k - 1] = sum;
		}
		raw.push(coeffs);
	}

	const mean = new Float64Array(MFCC_DIM);
	for (const r of raw) for (let k = 0; k < MFCC_DIM; k++) mean[k] += r[k];
	for (let k = 0; k < MFCC_DIM; k++) mean[k] /= raw.length;

	return raw.map((r) => {
		const v = new Float32Array(MFCC_DIM);
		let norm = 0;
		for (let k = 0; k < MFCC_DIM; k++) {
			v[k] = r[k] - mean[k];
			norm += v[k] * v[k];
		}
		norm = Math.sqrt(norm) || 1;
		for (let k = 0; k < MFCC_DIM; k++) v[k] /= norm;
		return v;
	});
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
}
