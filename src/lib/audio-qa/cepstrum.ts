import { fft, ifft, nextPowerOfTwo } from "./fft";

export interface CepstralPeakResult {
	/** peak / median-baseline over the search band. 0 when undefined. */
	ratio: number;
	/** Lag of the peak, in seconds — this names the defect's period. */
	peakLagSec: number;
	peakValue: number;
	baselineValue: number;
}

/**
 * Relative, not absolute. log(a·x) = log(a) + log(x), so scaling the input only
 * shifts the log spectrum by a constant, which lands entirely in cepstral bin 0
 * and leaves every other lag untouched — the ratio is therefore scale-invariant.
 * An ABSOLUTE floor would break that: a quiet signal would have more bins
 * clipped by the floor than a loud one. See the scale-invariance test.
 */
const SPECTRUM_FLOOR_RATIO = 1e-8;

/** Upper bound on the search band, for transform cost on long input only. */
const MAX_LAG_SEC = 10;

function removeDcOffset(pcm: Float32Array): Float64Array {
	let mean = 0;
	for (let i = 0; i < pcm.length; i++) mean += pcm[i];
	mean /= pcm.length || 1;

	const out = new Float64Array(pcm.length);
	for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] - mean;
	return out;
}

/**
 * Real cepstrum: IDFT(log|DFT(x)|).
 *
 * Zero-padded to at least 2x length. Without that pad the transform is circular
 * and the tail wraps onto the head, which manufactures peaks at lags that are
 * artifacts of the buffer length rather than of the audio.
 */
export function realCepstrum(pcm: Float32Array): Float64Array {
	const centered = removeDcOffset(pcm);
	const n = nextPowerOfTwo(Math.max(2, centered.length * 2));

	const re = new Float64Array(n);
	const im = new Float64Array(n);
	re.set(centered);

	fft(re, im);

	const magnitudes = new Float64Array(n);
	let maxMagnitude = 0;
	for (let i = 0; i < n; i++) {
		magnitudes[i] = Math.hypot(re[i], im[i]);
		if (magnitudes[i] > maxMagnitude) maxMagnitude = magnitudes[i];
	}

	const floor = maxMagnitude * SPECTRUM_FLOOR_RATIO;
	const logRe = new Float64Array(n);
	const logIm = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		logRe[i] = Math.log(Math.max(magnitudes[i], floor));
	}

	ifft(logRe, logIm);
	return logRe;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
}

/**
 * Cepstral peak prominence over a long-lag band — the repeat/duplication/
 * additive-overlap detector.
 *
 * Replaces `detectEcho`, whose 50-500ms autocorrelation window cannot see the
 * 1-5s duplication it existed to catch (measured: clean 0.072 vs duplicated
 * 0.070 vs overlap@1.2s 0.073 — no separation at all).
 *
 * The band starts at 0.15s to stay clear of the pitch period (a 65Hz voice has
 * a 15ms period; its harmonics die out well before 150ms).
 *
 * It ends at HALF THE DURATION, not at the spec's fixed 3.0s. That difference
 * decides whether the metric works. A duplicated utterance repeats at a lag
 * equal to its original length, so a duplicated 5.2s clip peaks at 5.2s —
 * outside a 3.0s band. Measured both ways over 6 real clean samples and 8
 * defects:
 *
 *   band 0.15-3.0s (spec):  clean max 118.9, defect min  33.3  -> margin 0.28x
 *   band 0.15-dur/2:        clean max 122.2, defect min 446.6  -> margin 3.66x
 *
 * With the fixed cap the ordering INVERTS — defects score below clean — so any
 * threshold at all produces garbage. Half-duration also guarantees every
 * reported lag has at least half the signal supporting it.
 *
 * KNOWN BLIND SPOT, inherited and unavoidable here: a copy running at a
 * DIFFERENT speed has no single lag, so this metric cannot see it either
 * (measured 7.9 vs clean 8.7 — no separation). Pause fraction partially covers
 * that case — see frame-RMS silence.
 *
 * KNOWN FALSE-POSITIVE SOURCE: clean speech with a regular rhythm scores high.
 * The committed kokoro sample peaks at exactly 2.000s with ratio 68, and
 * hero-demo-2 at 0.500s with ratio 122. Both are genuinely clean — raw
 * waveform cross-correlation at those lags is 0.02 and -0.003, i.e. no repeat
 * at all — but their syllable envelopes correlate 0.60 and 0.53. The metric is
 * seeing prosodic cadence. This is why the fail threshold is 300 and not the
 * spec's 50: at 50, three of six clean real samples would FAIL.
 *
 * Callers must gate on `checkIntegrity` first: a NaN sample propagates through
 * the transform and makes every output NaN.
 */
export function cepstralPeakProminence(
	pcm: Float32Array,
	sampleRate: number,
	band: { minLagSec?: number; maxLagSec?: number } = {},
): CepstralPeakResult {
	const empty = { ratio: 0, peakLagSec: 0, peakValue: 0, baselineValue: 0 };
	if (pcm.length === 0 || sampleRate <= 0) return empty;

	const durationSec = pcm.length / sampleRate;
	// Half-duration by default — see the note above on why a fixed cap inverts
	// the metric. MAX_LAG_SEC only bounds transform cost on very long input.
	const defaultMaxLag = Math.min(durationSec / 2, MAX_LAG_SEC);

	const minLag = Math.max(1, Math.round((band.minLagSec ?? 0.15) * sampleRate));
	const maxLag = Math.min(
		Math.round((band.maxLagSec ?? defaultMaxLag) * sampleRate),
		pcm.length - 1,
	);
	if (maxLag <= minLag) return empty;

	const cepstrum = realCepstrum(pcm);

	let peakValue = Number.NEGATIVE_INFINITY;
	let peakLag = minLag;
	const magnitudes: number[] = [];

	for (let lag = minLag; lag <= maxLag; lag++) {
		const value = cepstrum[lag];
		if (!Number.isFinite(value)) return empty;
		magnitudes.push(Math.abs(value));
		if (value > peakValue) {
			peakValue = value;
			peakLag = lag;
		}
	}

	const baseline = median(magnitudes);
	// A negative peak means no structure at all in the band, not a defect.
	const ratio = baseline > 0 ? Math.max(0, peakValue / baseline) : 0;

	return {
		ratio,
		peakLagSec: peakLag / sampleRate,
		peakValue,
		baselineValue: baseline,
	};
}
