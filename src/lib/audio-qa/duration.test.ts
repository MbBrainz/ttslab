import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../testing/types";
import { measureDuration } from "./duration";
import { silence, speechLike, timeScale } from "./synthetic-signals";

const SR = 24_000;
/** 13 words, the real hero-demo-1 text whose Kokoro render is 6.22s. */
const TEXT =
	"Welcome to TTSLab, where you can test speech models right in your browser.";
/** A buffer matching that real render's duration. */
const realistic = speechLike(SR, 6.22);

const failing = (log2Ratio: number) =>
	Math.abs(log2Ratio) > THRESHOLDS.durationLog2Ratio.fail;
const warning = (log2Ratio: number) =>
	Math.abs(log2Ratio) > THRESHOLDS.durationLog2Ratio.warn;

describe("measureDuration — calibration against real output", () => {
	it("passes a real Kokoro render of known text", () => {
		const result = measureDuration(realistic, SR, TEXT);
		expect(result.wordCount).toBe(13);
		expect(warning(result.log2Ratio)).toBe(false);
	});

	it("passes every real Kokoro render measured so far", () => {
		// Six points: three from the committed hero demos, three produced by an
		// actual scripts/model-qa.mjs run on WebGPU. All must clear the warn
		// threshold, or the harness warns on known-good output.
		const REAL: Array<[string, number]> = [
			[
				"Welcome to TTSLab, where you can test speech models right in your browser.",
				6.22,
			],
			[
				"No downloads, no API keys. Just natural sounding speech, generated on your device.",
				6.33,
			],
			[
				"Compare voices, benchmark performance, and find the perfect model for your project.",
				4.95,
			],
			["The quick brown fox jumps over the lazy dog.", 3.3],
			// This one measured -0.399 against the spec's 0.40 warn -- 0.001 from
			// warning on correct output. It is why the threshold is 0.45.
			["Hello, my name is Alice and I live in New York.", 3.48],
			["She bought five apples and three oranges at the market.", 3.67],
		];
		for (const [text, seconds] of REAL) {
			const result = measureDuration(speechLike(SR, seconds), SR, text);
			expect(warning(result.log2Ratio), `${text} (${seconds}s)`).toBe(false);
		}
	});

	it("KNOWN WEAKNESS: one model alone spans more than the warn budget", () => {
		// 2.05-3.16 w/s across six Kokoro renders is a 1.54x spread, log2 0.62,
		// versus a 0.45 warn. Legitimate phrase-to-phrase variation is the same
		// order as the thing being detected, before a second model is even
		// considered.
		const rates = [2.05, 3.16];
		const spread = Math.log2(rates[1] / rates[0]);
		expect(spread).toBeGreaterThan(THRESHOLDS.durationLog2Ratio.warn);
	});

	it("counts words from the normalized text, not characters", () => {
		// "$1,234,567.89" is 13 characters but ~9 spoken words. A character-rate
		// prior would be wrong by an order of magnitude on numeric text.
		const result = measureDuration(
			realistic,
			SR,
			"The total is $1,234,567.89 exactly.",
		);
		expect(result.wordCount).toBeGreaterThan(10);
	});
});

describe("measureDuration — defects it must catch", () => {
	it("fails a doubled render", () => {
		const result = measureDuration(timeScale(realistic, 2), SR, TEXT);
		expect(result.ratio).toBeGreaterThan(2);
		expect(failing(result.log2Ratio)).toBe(true);
	});

	it("fails a halved render", () => {
		const result = measureDuration(timeScale(realistic, 0.5), SR, TEXT);
		expect(result.ratio).toBeLessThan(0.6);
		expect(failing(result.log2Ratio)).toBe(true);
	});

	it("fails a truncated render", () => {
		const truncated = realistic.slice(0, Math.floor(realistic.length * 0.4));
		expect(failing(measureDuration(truncated, SR, TEXT).log2Ratio)).toBe(true);
	});

	it("fails large rate relabels", () => {
		// Duration is the only possible detector for a relabel. It changes no
		// sample, so the DFT magnitudes are bit-identical and only the frequency
		// labels scale -- Nyquist-edge detection cannot see it even in principle.
		expect(failing(measureDuration(realistic, 48_000, TEXT).log2Ratio)).toBe(
			true,
		);
		expect(failing(measureDuration(realistic, 16_000, TEXT).log2Ratio)).toBe(
			true,
		);
		expect(failing(measureDuration(realistic, 8_000, TEXT).log2Ratio)).toBe(
			true,
		);
	});
});

describe("measureDuration — documented limits", () => {
	it("KNOWN GAP: a 24k->44.1k relabel only WARNS, it does not fail", () => {
		// Measured -0.619 against a 0.65 fail threshold. A duration WARN must
		// therefore be investigated, never ignored.
		//
		// The deeper problem this exposes: detection is ASYMMETRIC, because the
		// clean baseline is not at zero. Which relabels fail therefore depends on
		// the prior, and moving it just trades one for another -- at 2.2 w/s the
		// 44.1k case failed and 16k only warned; at 2.5 it is the other way
		// round.
		//
		// The real conclusion is that duration alone cannot be trusted for rate
		// errors. Assert on sampleRate directly -- PhraseResult carries it.
		const result = measureDuration(realistic, 44_100, TEXT);
		expect(warning(result.log2Ratio)).toBe(true);
		expect(failing(result.log2Ratio)).toBe(false);
	});

	it("KNOWN GAP: 24k vs 22.05k is acoustically undetectable", () => {
		// Ratio 1.088 is 8.8% duration error, inside the +/-10% that standard
		// ASR speed augmentation treats as in-distribution. Assert on
		// AudioBuffer.sampleRate directly instead of trying to hear it.
		const result = measureDuration(realistic, 22_050, TEXT);
		expect(warning(result.log2Ratio)).toBe(false);
	});

	it("returns a neutral result rather than dividing by zero", () => {
		expect(measureDuration(realistic, SR, "").ratio).toBe(0);
		expect(measureDuration(silence(0), SR, TEXT).ratio).toBe(0);
		expect(measureDuration(realistic, 0, TEXT).ratio).toBe(0);
	});

	it("accepts an override for a model with a different speaking rate", () => {
		const slow = measureDuration(realistic, SR, TEXT, 1.5);
		const fast = measureDuration(realistic, SR, TEXT, 3.5);
		expect(slow.ratio).toBeLessThan(fast.ratio);
	});
});
