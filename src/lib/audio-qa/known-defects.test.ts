import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../testing/types";
import { computeWER } from "../testing/wer";
import { analyzeAudioQa } from ".";
import { decodeWav } from "./wav";

/**
 * Real SpeechT5 cloned-voice defects, captured by scripts/model-qa.mjs against
 * the real model under the spec's repro conditions: a >10s prompt and a
 * MIC-CAPTURED speaker embedding (Chrome's fake device fed a real WAV, so the
 * getUserMedia AGC/noise-suppression chain runs).
 *
 * These tests exist to pin down a DETECTOR GAP, not to celebrate a pass. Read
 * the "stutter" block below before trusting an acoustic PASS on cloned audio.
 */

const PROMPT =
	"The committee reviewed the sophisticated proposal at length, and after " +
	"considerable discussion about the department budget, the union representatives " +
	"agreed that the computer systems would need replacing before the end of the " +
	"financial year.";

/** What Whisper actually returned for each, recorded from the run. */
const TRANSCRIPTS = {
	good: PROMPT,
	stutter:
		"The committee reviewed the sophisticated proposal at length, and after consciously " +
		"sophisticated sophisticated sophisticated sophisticated sophisticated sophisticated " +
		"sophisticated sophisticated sophisticated sophisticated sophisticated",
	truncated:
		"The committee reviewed the sophisticated proposal at length, and it submitted a " +
		"review the sophisticated subsidiarist agree.",
};

function load(name: string) {
	const bytes = readFileSync(`test-fixtures/${name}`);
	const { pcm, sampleRate } = decodeWav(new Uint8Array(bytes));
	return {
		...analyzeAudioQa(pcm, sampleRate, PROMPT),
		durationSec: pcm.length / sampleRate,
	};
}

const good = load("speecht5-stock-known-good.wav");
const stutter = load("speecht5-cloned-STUTTER-known-bad.wav");
const truncated = load("speecht5-cloned-TRUNCATED-known-bad.wav");

describe("known-good: stock SpeechT5, same prompt", () => {
	it("passes every acoustic check", () => {
		expect(good.cepstral.ratio).toBeLessThan(THRESHOLDS.cepstralRatio.warn);
		expect(Math.abs(good.duration?.log2Ratio ?? 0)).toBeLessThan(
			THRESHOLDS.durationLog2Ratio.warn,
		);
		expect(good.silence.silenceFraction).toBeLessThan(
			THRESHOLDS.frameSilence.warn,
		);
		expect(good.integrity.usable).toBe(true);
	});

	it("transcribes perfectly", () => {
		expect(computeWER(PROMPT, TRANSCRIPTS.good).wer).toBe(0);
	});
});

describe("known-bad: cloned voice truncates", () => {
	// This one the harness catches properly.
	it("is caught by the duration check", () => {
		expect(truncated.durationSec).toBeLessThan(7);
		expect(Math.abs(truncated.duration?.log2Ratio ?? 0)).toBeGreaterThan(
			THRESHOLDS.durationLog2Ratio.fail,
		);
	});

	it("is caught by WER, and the S/D/I shape names it as truncation", () => {
		const wer = computeWER(PROMPT, TRANSCRIPTS.truncated);
		expect(wer.wer).toBeGreaterThan(THRESHOLDS.wer.fail);
		// D >> S,I is the truncation signature.
		expect(wer.deletions).toBeGreaterThan(wer.insertions);
	});
});

describe("known-bad: cloned voice STUTTERS — the live defect, and the detector gap", () => {
	// The audio audibly loops the word "sophisticated" about seven times.
	// Every acoustic check below MISSES it. These assertions encode the current
	// broken state on purpose: they are the target a future repetition detector
	// has to beat. If you add one and these start failing, that is the win —
	// update them, do not weaken the new detector.

	it("GAP: the cepstral repeat detector is silent on real word-level repetition", () => {
		// Measured 19.3 against a 200 warn — an order of magnitude below, and
		// silent in every 4s window (11.2-19.6).
		//
		// WHY: the cepstrum finds constant-lag periodicity. Per the spec's own
		// analysis, these repeats are RE-SYNTHESIZED each pass rather than
		// spliced, so no two utterances of the word are acoustically identical
		// and there is no fixed lag to find. The detector catches splices and
		// overlaps; it does not catch a decoder saying a word again.
		expect(stutter.cepstral.ratio).toBeLessThan(THRESHOLDS.cepstralRatio.warn);
		expect(stutter.cepstral.ratio).toBeLessThan(20);
	});

	it("GAP: insertion rate is 0.000 because the loop REPLACES rather than extends", () => {
		// I/N was adopted as "the primary non-termination signal" on the premise
		// that a loop adds words. This loop substitutes them: the decoder still
		// stops near the right length, emitting repeated words INSTEAD of the
		// remaining text. S=12 D=12 I=0.
		const wer = computeWER(PROMPT, TRANSCRIPTS.stutter);
		expect(wer.insertions).toBe(0);
		expect(wer.insertionRate).toBeLessThan(THRESHOLDS.insertionRate.warn);
	});

	it("GAP: duration passes — the stutter does not lengthen the output", () => {
		// 10.98s against ~13.6s expected, log2 -0.309 versus a 0.45 warn.
		expect(Math.abs(stutter.duration?.log2Ratio ?? 0)).toBeLessThan(
			THRESHOLDS.durationLog2Ratio.warn,
		);
	});

	it("GAP: silence, clipping and integrity all pass", () => {
		expect(stutter.silence.silenceFraction).toBeLessThan(
			THRESHOLDS.frameSilence.warn,
		);
		expect(stutter.clipping.clippedFraction).toBeLessThan(
			THRESHOLDS.clippedFraction.fail,
		);
		expect(stutter.integrity.usable).toBe(true);
	});

	it("ONLY the ASR round-trip catches it", () => {
		// So the harness's verdict on this defect rests entirely on the STT
		// judge. Lose the judge, mis-transcribe, or shorten the prompt enough to
		// dilute WER, and audibly broken audio returns PASS.
		const wer = computeWER(PROMPT, TRANSCRIPTS.stutter);
		expect(wer.wer).toBeGreaterThan(THRESHOLDS.wer.fail);
	});

	it("the stutter is NOT distinguishable from clean by envelope periodicity either", () => {
		// Ruling out the obvious cheaper fix: the defective envelope
		// autocorrelation peaks at 0.214, the clean control at 0.182. No
		// separation, so an envelope-based detector would not rescue this.
		expect(stutter.cepstral.ratio).toBeLessThan(good.cepstral.ratio * 3);
	});
});
