import { cosineSimilarity, MFCC_HOP_SEC, mfccFrames } from "./mfcc";

/**
 * MFCC repeat-similarity — MEASURED AND REJECTED AS A GATE. Read this before
 * wiring it into CHECK_RULES; it is here so the negative result is reproducible,
 * not because it works.
 *
 * The idea was sound: the cepstral detector misses the SpeechT5 stutter because
 * it looks for constant-lag periodicity in the waveform, and re-synthesized
 * repeats never line up sample-wise. MFCCs compare phonetic content instead, so
 * a repeated word should stay recognizably itself. Two formulations were built
 * and measured against `speecht5-cloned-STUTTER-known-bad.wav` plus 9 clean real
 * renders and 2 working clones.
 *
 * BOTH FAIL, and several statistics are INVERTED — clean speech scores HIGHER
 * than the defect:
 *
 *   fixed-lag stripes (longest sustained run, best of a 9-point threshold sweep)
 *     clean max 0.37-0.54s | STUTTER 0.18-0.28s | margin 0.35-0.65x
 *
 *   drift-tolerant template match (300ms template, best offset per position)
 *     median      clean max 0.574 | STUTTER 0.625 | margin 1.09x
 *     p90         clean max 0.781 | STUTTER 0.793 | margin 1.02x
 *     max         clean max 0.963 | STUTTER 0.912 | margin 0.95x
 *     frac >=0.85 clean max 0.072 | STUTTER 0.009 | margin 0.12x
 *     run  >=0.85 clean max 0.720s| STUTTER 0.060s| margin 0.08x
 *
 * WHY, and this is the useful part: the artifact contains no acoustic repetition
 * to detect. Five independent methods agree — cepstral (19.3 vs a 200
 * threshold), envelope autocorrelation (0.214 vs clean 0.182), both formulations
 * here, and speaker similarity (0.071 against its own reference). Per-second
 * analysis shows why: spectral flatness runs 0.010-0.236 against 0.0004-0.068
 * for clean speech, and ZCR is ~2x higher. The output degenerates into
 * NOISE-LIKE, poorly-voiced audio. Whisper's looping "sophisticated
 * sophisticated ..." transcript is its decoding of that degraded audio, not a
 * transcript of clean word repetition.
 *
 * So this is not a detector that needs better tuning — it is looking for a
 * property the audio does not have. The spec's canonical artifact
 * (`speecht5-1784627372628.wav`, not in this repo) may genuinely contain the
 * word-level repeats the spec describes; if it is ever recovered, re-run this.
 *
 * The promising lead is instead VOICING QUALITY: median spectral flatness
 * separates at 6.2x (negatives max 0.00900, STUTTER 0.05579). Not shipped as a
 * gate because there is exactly ONE positive example, and the 11 negatives span
 * 0.00008-0.00900 — a 110x internal spread, so the false-positive tail is
 * unknown. See CLAUDE.md.
 */

export interface RepeatSimilarityResult {
	/** Longest sustained fixed-lag stripe, in seconds. */
	longestStripeSec: number;
	/** Lag of that stripe. */
	stripeLagSec: number;
	/** Mean cosine along the stripe. */
	stripeMeanSimilarity: number;
	/** Fraction of template positions whose best off-diagonal match >= simThreshold. */
	matchedFraction: number;
	/** Best match score over the whole clip. */
	peakMatch: number;
}

const MIN_LAG_SEC = 0.15;
const MAX_LAG_SEC = 2.0;
const TEMPLATE_SEC = 0.3;

const EMPTY: RepeatSimilarityResult = {
	longestStripeSec: 0,
	stripeLagSec: 0,
	stripeMeanSimilarity: 0,
	matchedFraction: 0,
	peakMatch: 0,
};

/**
 * Both formulations in one pass. `simThreshold` defaults to 0.85, the spec's
 * suggested stutter gate.
 *
 * NOT wired into CHECK_RULES — see the module docstring for the measurements
 * showing it does not discriminate.
 */
export function measureRepeatSimilarity(
	pcm: Float32Array,
	sampleRate: number,
	simThreshold = 0.85,
): RepeatSimilarityResult {
	const frames = mfccFrames(pcm, sampleRate);
	const minLag = Math.round(MIN_LAG_SEC / MFCC_HOP_SEC);
	const maxLag = Math.round(MAX_LAG_SEC / MFCC_HOP_SEC);
	const template = Math.round(TEMPLATE_SEC / MFCC_HOP_SEC);
	if (frames.length <= minLag + template) return EMPTY;

	// ── fixed-lag stripes ──
	let bestRun = 0;
	let bestLag = 0;
	let bestMean = 0;
	for (let lag = minLag; lag <= Math.min(maxLag, frames.length - 1); lag++) {
		let runStart = -1;
		let sum = 0;
		for (let i = 0; i + lag < frames.length; i++) {
			const s = cosineSimilarity(frames[i], frames[i + lag]);
			if (s >= simThreshold) {
				if (runStart < 0) {
					runStart = i;
					sum = 0;
				}
				sum += s;
			} else if (runStart >= 0) {
				const len = i - runStart;
				if (len > bestRun) {
					bestRun = len;
					bestLag = lag;
					bestMean = sum / len;
				}
				runStart = -1;
			}
		}
		if (runStart >= 0) {
			const len = frames.length - lag - runStart;
			if (len > bestRun) {
				bestRun = len;
				bestLag = lag;
				bestMean = sum / Math.max(1, len);
			}
		}
	}

	// ── drift-tolerant template match ──
	let matched = 0;
	let positions = 0;
	let peak = 0;
	for (let t = 0; t + template < frames.length; t += 3) {
		let best = -1;
		for (let lag = minLag; lag <= maxLag; lag++) {
			if (t + template + lag >= frames.length) break;
			let s = 0;
			for (let k = 0; k < template; k++) {
				s += cosineSimilarity(frames[t + k], frames[t + k + lag]);
			}
			s /= template;
			if (s > best) best = s;
		}
		if (best < 0) continue;
		positions++;
		if (best > peak) peak = best;
		if (best >= simThreshold) matched++;
	}

	return {
		longestStripeSec: bestRun * MFCC_HOP_SEC,
		stripeLagSec: bestLag * MFCC_HOP_SEC,
		stripeMeanSimilarity: bestMean,
		matchedFraction: positions > 0 ? matched / positions : 0,
		peakMatch: peak,
	};
}
