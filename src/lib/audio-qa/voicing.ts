import { fft } from "./fft";

export interface VoicingResult {
	/**
	 * Median spectral flatness over energy-gated frames.
	 * 1 = noise-like, ~0 = tonal/voiced. 0 when there is nothing above the gate.
	 */
	medianFlatness: number;
	/** Frames that passed the energy gate and were measured. */
	measuredFrames: number;
}

const WINDOW = 1024;
const HOP = WINDOW / 2;
/** Frames quieter than peak-40dB are pauses, not evidence about voicing. */
const GATE_BELOW_PEAK_DB = 40;
/**
 * Spectral floor, RELATIVE to the frame's own peak bin.
 *
 * This is the spec's landmine: a single empty bin makes the geometric mean zero,
 * so noisy output would report as perfectly tonal — the metric inverts rather
 * than degrades. Flooring relative to the peak also keeps it level-invariant.
 */
const FLOOR_RATIO = 1e-10;

/**
 * Voicing quality via spectral flatness — a WARN-ONLY diagnostic.
 *
 * Speech is tonal: voiced phonation concentrates energy in harmonics, so the
 * geometric/arithmetic mean ratio of the power spectrum stays small. Output that
 * collapses into noise-like, poorly-voiced audio flattens out.
 *
 * WHY THIS EXISTS. The SpeechT5 cloned-voice defect in
 * `test-fixtures/speecht5-cloned-STUTTER-known-bad.wav` transcribes as a looping
 * word, which led three separate detectors to hunt for acoustic repetition —
 * cepstral peak prominence, MFCC fixed-lag stripes, and MFCC template matching.
 * All three came up empty because THE REPETITION IS NOT THERE. The audio is
 * degenerating into noise; Whisper's looping transcript is its decoding of that
 * degradation. Flatness measures the property that is actually present.
 *
 * MEASURED POPULATIONS (2026-08-04). Every file below is COMMITTED, so the
 * calibration is reproducible from a clean checkout — `voicing.test.ts` re-derives
 * it. An earlier version of that test read part of the population from gitignored
 * qa-artifacts/, which made the number verifiable only on the machine that
 * generated it.
 *
 *   negatives  0.00008 - 0.00900  9 files: 6 clean real renders, the stock
 *                                 fixture, and 2 WORKING file-upload clones.
 *                                 Spread 110x. Both bounds are committed files:
 *                                 floor piper-lessac, ceiling WORKING-run2.
 *   TRUNCATED  0.03081            weaker positive
 *   STUTTER    0.05579            stronger positive
 *
 * EVIDENCE BASE AND ITS WEAKNESS, in the same breath as the number:
 * there is exactly ONE strong positive example, and the 11 negatives span
 * 0.00008-0.00900 — a 110x internal spread. The false-positive tail is therefore
 * UNBOUNDED: a differently-voiced model (breathier, noisier, or simply a
 * different vocoder) could plausibly sit above the threshold while being
 * perfectly fine.
 *
 * ==> THIS MUST NOT BE PROMOTED TO A FAIL GATE without substantially more
 *     positive examples. It is deliberately registered with no fail tier at
 *     all — not a high one, none — so that promoting it requires adding a field
 *     rather than editing a number. A run must never fail on this evidence base.
 *
 * The reason that warning lives here rather than only in a commit message:
 * `detectEcho` shipped a blind spot for months because its limitation was
 * recorded in git history instead of next to the code.
 */
export function measureVoicing(pcm: Float32Array): VoicingResult {
	let peak = 0;
	for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
	if (peak === 0) return { medianFlatness: 0, measuredFrames: 0 };

	const gate = peak * 10 ** (-GATE_BELOW_PEAK_DB / 20);
	const values: number[] = [];
	const re = new Float64Array(WINDOW);
	const im = new Float64Array(WINDOW);

	for (let offset = 0; offset + WINDOW <= pcm.length; offset += HOP) {
		let sumSquares = 0;
		for (let i = 0; i < WINDOW; i++)
			sumSquares += pcm[offset + i] * pcm[offset + i];
		if (Math.sqrt(sumSquares / WINDOW) < gate) continue;

		re.fill(0);
		im.fill(0);
		for (let i = 0; i < WINDOW; i++) {
			re[i] =
				pcm[offset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));
		}
		fft(re, im);

		// Skip bin 0 — DC is not part of the spectral shape.
		let maxPower = 0;
		const power = new Float64Array(WINDOW / 2 - 1);
		for (let k = 1; k < WINDOW / 2; k++) {
			const p = re[k] * re[k] + im[k] * im[k];
			power[k - 1] = p;
			if (p > maxPower) maxPower = p;
		}
		if (maxPower === 0) continue;

		const floor = maxPower * FLOOR_RATIO;
		let logSum = 0;
		let linearSum = 0;
		for (let i = 0; i < power.length; i++) {
			const q = Math.max(power[i], floor);
			logSum += Math.log(q);
			linearSum += q;
		}
		values.push(Math.exp(logSum / power.length) / (linearSum / power.length));
	}

	if (values.length === 0) return { medianFlatness: 0, measuredFrames: 0 };
	values.sort((a, b) => a - b);
	return {
		medianFlatness: values[Math.floor(values.length / 2)],
		measuredFrames: values.length,
	};
}
