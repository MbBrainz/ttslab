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
	wer: number;
	substitutions: number;
	deletions: number;
	insertions: number;
	refWords: number;
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
		wer: number;
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
	silence: { warn: 0.3, fail: 0.5 },
	clipping: { warn: 0.001, fail: 0.01 },
	energyDb: { warn: -40, fail: -50 },
} as const;
