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
	audioAnalysis: AudioAnalysis;
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

export interface QualityReport {
	slug: string;
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
} as const;
