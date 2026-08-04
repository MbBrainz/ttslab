import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../testing/types";
import { computeWER } from "../testing/wer";
import { analyzeAudioQa } from ".";
import { fft } from "./fft";
import { measureRepeatSimilarity } from "./repeat-similarity";
import { decodeWav } from "./wav";

/**
 * Median spectral flatness over energy-gated frames. 1 = noise-like, 0 = voiced.
 * The spectrum is floored RELATIVE to its peak: one empty bin would zero the
 * geometric mean and report noisy output as perfectly tonal, so the metric would
 * invert rather than degrade.
 */
function medianFlatness(pcm: Float32Array): number {
	const WIN = 1024;
	let peak = 0;
	for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
	const gate = peak * 10 ** (-40 / 20);

	const values: number[] = [];
	const re = new Float64Array(WIN);
	const im = new Float64Array(WIN);
	for (let o = 0; o + WIN <= pcm.length; o += WIN / 2) {
		let sumSq = 0;
		for (let i = 0; i < WIN; i++) sumSq += pcm[o + i] * pcm[o + i];
		if (Math.sqrt(sumSq / WIN) < gate) continue;

		re.fill(0);
		im.fill(0);
		for (let i = 0; i < WIN; i++) {
			re[i] = pcm[o + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
		}
		fft(re, im);

		const power: number[] = [];
		let maxPower = 0;
		for (let k = 1; k < WIN / 2; k++) {
			const p = re[k] * re[k] + im[k] * im[k];
			power.push(p);
			if (p > maxPower) maxPower = p;
		}
		const floor = maxPower * 1e-10;
		let logSum = 0;
		let linSum = 0;
		for (const p of power) {
			const q = Math.max(p, floor);
			logSum += Math.log(q);
			linSum += q;
		}
		values.push(Math.exp(logSum / power.length) / (linSum / power.length));
	}
	values.sort((a, b) => a - b);
	return values[Math.floor(values.length / 2)] ?? 0;
}

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
		pcm,
		sampleRate,
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

	it("GAP CONFIRMED, NOT CLOSED: MFCC repeat-similarity does not separate it either", () => {
		// An MFCC self-similarity detector was built specifically to close this
		// gap — the reasoning being that MFCCs compare phonetic content and so
		// tolerate re-synthesized repeats that the waveform-domain cepstral
		// detector cannot see. It was measured against this fixture plus 9 clean
		// real renders and 2 working clones. It FAILS, and inverts:
		//
		//   fixed-lag stripe:  clean max 0.37-0.54s | STUTTER 0.18-0.28s
		//   template frac>=.85 clean max 0.072      | STUTTER 0.009
		//   template run >=.85 clean max 0.720s     | STUTTER 0.060s
		//
		// Clean speech has MORE repeat-similarity than the defect. The detector
		// is not mistuned; it is looking for a property this audio lacks.
		const stutterResult = measureRepeatSimilarity(
			stutter.pcm,
			stutter.sampleRate,
		);
		const goodResult = measureRepeatSimilarity(good.pcm, good.sampleRate);

		expect(stutterResult.matchedFraction).toBeLessThan(
			goodResult.matchedFraction,
		);
		expect(stutterResult.longestStripeSec).toBeLessThan(
			goodResult.longestStripeSec,
		);
	});

	it("WHY: the audio is noise-like degradation, not word repetition", () => {
		// The reason five independent methods all report "no repetition": the
		// output degenerates into poorly-voiced, noise-like audio. Whisper's
		// looping "sophisticated sophisticated ..." is its decoding of that
		// degradation, not a transcript of clean acoustic repeats.
		//
		// Median spectral flatness (1 = noise, 0 = voiced), energy-gated:
		//   negatives (9 clean + 2 working clones) max  0.00900
		//   STUTTER                                     0.05579   = 6.2x
		//   TRUNCATED                                   0.03081   = 3.4x
		//
		// This is the most promising lead for an acoustic detector here, and it
		// is deliberately NOT a gate: one positive example, and the 11 negatives
		// span 0.00008-0.00900, a 112x internal spread, so the false-positive
		// tail is unbounded. Do not ship a threshold off this without more
		// positives.
		expect(medianFlatness(stutter.pcm)).toBeGreaterThan(
			medianFlatness(good.pcm) * 3,
		);
	});

	it("the stutter is NOT distinguishable from clean by envelope periodicity either", () => {
		// Ruling out the obvious cheaper fix: the defective envelope
		// autocorrelation peaks at 0.214, the clean control at 0.182. No
		// separation, so an envelope-based detector would not rescue this.
		expect(stutter.cepstral.ratio).toBeLessThan(good.cepstral.ratio * 3);
	});
});
