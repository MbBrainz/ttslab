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

	it("fails a 24k buffer relabelled as 44.1k", () => {
		// The detector for this. A relabel changes no sample, so the DFT
		// magnitudes are bit-identical and only the frequency labels scale --
		// Nyquist-edge detection cannot see it even in principle. A rate error
		// is a time-base error.
		expect(failing(measureDuration(realistic, 44_100, TEXT).log2Ratio)).toBe(
			true,
		);
	});
});

describe("measureDuration — documented limits", () => {
	it("KNOWN GAP: a 24k->16k relabel only WARNS, it does not fail", () => {
		// Measured log2 0.660 against a 0.7 fail threshold. Ratio 1.5 is a real
		// bug that lands just inside the band. A duration WARN must therefore be
		// investigated, never ignored. Lowering the threshold to catch it would
		// false-fail any model speaking 1.5x off the calibrated prior, which is
		// plausible since the prior comes from one model.
		const result = measureDuration(realistic, 16_000, TEXT);
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
