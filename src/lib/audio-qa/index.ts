import { type CepstralPeakResult, cepstralPeakProminence } from "./cepstrum";
import { detectRunClipping, type RunClippingResult } from "./clipping";
import { type DurationResult, measureDuration } from "./duration";
import { checkIntegrity, type IntegrityResult } from "./integrity";
import { type FrameSilenceResult, measureFrameSilence } from "./silence";
import { measureVoicing, type VoicingResult } from "./voicing";

export type {
	VoicingResult,
	CepstralPeakResult,
	DurationResult,
	FrameSilenceResult,
	IntegrityResult,
	RunClippingResult,
};
export { cepstralPeakProminence, realCepstrum } from "./cepstrum";
export { detectRunClipping } from "./clipping";
export { measureDuration } from "./duration";
export { checkIntegrity } from "./integrity";
export { measureFrameSilence } from "./silence";
export { measureVoicing } from "./voicing";

export interface AudioQaMetrics {
	integrity: IntegrityResult;
	cepstral: CepstralPeakResult;
	silence: FrameSilenceResult;
	clipping: RunClippingResult;
	/** Voicing quality. WARN-ONLY — see voicing.ts before touching it. */
	voicing: VoicingResult;
	/** Null when no reference text was supplied. */
	duration: DurationResult | null;
}

const UNMEASURED_CEPSTRAL: CepstralPeakResult = {
	ratio: 0,
	peakLagSec: 0,
	peakValue: 0,
	baselineValue: 0,
};

/**
 * Tier-1 metric stack: pure DSP, no dependencies, no model downloads.
 *
 * Integrity runs FIRST and short-circuits the cepstral transform when the
 * buffer contains NaN or Infinity. Without that gate a single bad sample makes
 * every downstream number NaN, and a NaN silently compares false against every
 * threshold — the buffer would sail through the gate as a pass.
 */
export function analyzeAudioQa(
	pcm: Float32Array,
	sampleRate: number,
	referenceText?: string,
): AudioQaMetrics {
	const integrity = checkIntegrity(pcm);

	return {
		integrity,
		cepstral: integrity.usable
			? cepstralPeakProminence(pcm, sampleRate)
			: UNMEASURED_CEPSTRAL,
		silence: measureFrameSilence(pcm, sampleRate),
		clipping: detectRunClipping(pcm),
		voicing: measureVoicing(pcm),
		duration: referenceText
			? measureDuration(pcm, sampleRate, referenceText)
			: null,
	};
}
