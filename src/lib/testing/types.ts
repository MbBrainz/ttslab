import type { AudioQaMetrics } from "../audio-qa";

export type Verdict = "pass" | "warn" | "fail";

export interface EchoResult {
	detected: boolean;
	peakDelayMs: number;
	confidence: number;
}

export interface SilenceResult {
	ratio: number;
	leadingMs: number;
	trailingMs: number;
}

export interface ClippingResult {
	ratio: number;
	count: number;
}

export interface EnergyResult {
	rmsDb: number;
	peakDb: number;
	dynamicRange: number;
}

export interface AudioAnalysis {
	echo: EchoResult;
	silence: SilenceResult;
	clipping: ClippingResult;
	energy: EnergyResult;
}

export interface WERResult {
	/** UNCAPPED: can exceed 1.0. A 3x-looped output scores 2.0, not 1.0. */
	wer: number;
	substitutions: number;
	deletions: number;
	insertions: number;
	refWords: number;
	/**
	 * `insertions / refWords`. Unbounded, so it separates severities that WER
	 * saturates over, and names the failure mode: I >> S,D = non-termination
	 * (loop/stutter); D >> = truncation; S >> = mispronunciation.
	 */
	insertionRate: number;
}

/**
 * A single check that did not pass, with the value and threshold that decided
 * it. This is what makes a verdict actionable: an agent can branch on
 * `check`, and a human can see how far out the value was.
 */
export interface CheckFailure {
	check: string;
	value: number;
	threshold: number;
	severity: "warn" | "fail";
}

export interface PhraseResult {
	phrase: string;
	category: string;
	generationMs: number;
	/** Asserted directly — 48k vs 44.1k is undetectable acoustically. */
	sampleRate: number;
	/** Tier-1 DSP metrics. These are what gate. */
	qa: AudioQaMetrics;
	energy: EnergyResult;
	/** Present only for streaming variants. */
	streaming?: {
		chunkCount: number;
		firstChunkMs: number;
	};
	/** Combined acoustic + STT verdict for this phrase. */
	verdict: Verdict;
	/** Every check that warned or failed. Empty when `verdict` is "pass". */
	failures: CheckFailure[];
	sttRoundTrip: {
		transcription: string;
		/** UNCAPPED — see WERResult.wer. */
		wer: number;
		substitutions: number;
		deletions: number;
		insertions: number;
		refWords: number;
		insertionRate: number;
		verdict: Verdict;
	};
}

/**
 * One cell of the coverage matrix: model x {stock, cloned} x {non-streaming,
 * streaming}. The cloned and streaming axes were structurally untestable before
 * -- `testPhrase` called `synthesize(slug, text, voice)` and nothing else -- so
 * the known-broken cloned path could not be exercised at all.
 */
export interface TestVariant {
	/** Appears in the report and in artifact filenames, e.g. "cloned/streaming". */
	id: string;
	/** Absent = stock voice. Present = clone from this speaker embedding. */
	speakerEmbeddingUrl?: string;
	streaming?: boolean;
}

export const DEFAULT_VARIANT: TestVariant = { id: "stock/non-streaming" };

export interface QualityReport {
	slug: string;
	/** Which coverage-matrix cell this report is for. */
	variant: string;
	timestamp: string;
	overall: Verdict;
	loadTimeMs: number;
	backend: "webgpu" | "wasm";
	tests: PhraseResult[];
	errors: string[];
}

export interface TestConfig {
	models?: string[];
	phrases?: TestPhrase[];
	sttModel?: string;
	backend?: "webgpu" | "wasm" | "auto";
	/** Defaults to [DEFAULT_VARIANT] — stock voice, non-streaming. */
	variants?: TestVariant[];
	/** Cap the phrase list — for quick smoke runs, not for a real gate. */
	phraseLimit?: number;
}

export interface TestPhrase {
	text: string;
	category: string;
	language?: string;
}

export const DEFAULT_PHRASES: TestPhrase[] = [
	{ text: "The quick brown fox jumps over the lazy dog.", category: "pangram" },
	{
		text: "Hello, my name is Alice and I live in New York.",
		category: "natural",
	},
	{
		text: "She bought five apples and three oranges at the market.",
		category: "embedded-numbers",
	},
];

/** Thresholds for pass/warn/fail */
export const THRESHOLDS = {
	echo: { warn: 0.3, fail: 0.5 },
	wer: { warn: 0.15, fail: 0.3 },
	/**
	 * Insertion rate `I/N`. Provisional, pending calibration against real ASR
	 * output. Rationale: on the 8-10 word DEFAULT_PHRASES a benign ASR filler
	 * word costs 0.10-0.125 and two cost 0.20-0.25, while a decoder that
	 * repeats the utterance once scores 1.0. warn 0.3 / fail 0.5 sits ~2x above
	 * two benign insertions and ~2x below a single repeat.
	 */
	insertionRate: { warn: 0.3, fail: 0.5 },
	silence: { warn: 0.3, fail: 0.5 },
	clipping: { warn: 0.001, fail: 0.01 },
	energyDb: { warn: -40, fail: -50 },

	// ── Tier-1 DSP thresholds. Every number below was measured, not assumed;
	// the measurements are in the metric's own source file.

	/**
	 * Cepstral peak prominence. NOT the spec's 50 — at 50, three of the six
	 * committed clean samples FAIL (kokoro 68.7, hero-demo-1 68.7,
	 * hero-demo-2 122.2), because clean speech with regular prosodic rhythm
	 * scores high. Measured clean max 122.2, additive-overlap min 446.6.
	 * Caveat for review: only 6 clean samples, all from 3 models. Re-check as
	 * models are added.
	 */
	cepstralRatio: { warn: 200, fail: 300 },
	/**
	 * |log2(actual/expected duration)|. NOT the spec's 0.4/0.7.
	 *
	 * Measured over six real Kokoro renders (three committed, three from an
	 * actual harness run), legitimate output reaches 0.338 — one phrase hit
	 * 0.399 against the spec's 0.40 warn, i.e. it came within 0.001 of warning
	 * on correct output. Widened to 0.45/0.65, which puts clean output 1.33x
	 * clear of warn while every gross defect still fails:
	 *
	 *   doubled 1.258 | halved -0.742 | truncated -1.064
	 *   relabel ->48k -0.742 | ->16k 0.843 | ->8k 1.843
	 *
	 * A 24k->44.1k relabel measures -0.619 and only WARNS; 24k->22.05k measures
	 * 0.381 and is invisible, as the spec says. A duration warn must be
	 * investigated, never ignored — and for rate errors assert on
	 * PhraseResult.sampleRate directly rather than relying on this at all.
	 */
	durationLog2Ratio: { warn: 0.45, fail: 0.65 },
	/** Peak-relative frame silence. Clean real 0.174-0.283; dead audio 1.0. */
	frameSilence: { warn: 0.45, fail: 0.65 },
	/**
	 * Fraction of samples inside a clipping run. Clean real is exactly 0 across
	 * all six samples; 12x overdrive measures 0.875. A single short run warns
	 * via runCount instead.
	 */
	clippedFraction: { warn: 0, fail: 0.001 },
	/** DC offset relative to RMS, in dB. Clean real max -43.4; DC+0.2 = -6.2. */
	dcOffsetDb: { warn: -30, fail: -20 },
	/**
	 * Median spectral flatness — WARN ONLY, and deliberately has NO `fail` key.
	 *
	 * 0.017 sits 1.89x above the measured negatives max (0.00900, from 9 clean
	 * real renders plus 2 WORKING file-upload clones) and 1.81x below the weaker
	 * positive (TRUNCATED 0.03081); the stronger positive (STUTTER 0.05579) is
	 * 3.28x clear. It is the geometric midpoint of the negative ceiling and the
	 * weaker positive, so the two error directions are balanced.
	 *
	 * ONE strong positive example, and the 11 negatives span 0.00008-0.00900 —
	 * a 112x internal spread — so the false-positive tail is UNBOUNDED and a
	 * differently-voiced model could exceed this while being perfectly fine.
	 * DO NOT add a `fail` key without substantially more positives. See
	 * src/lib/audio-qa/voicing.ts.
	 */
	spectralFlatness: { warn: 0.017 },
} as const;
