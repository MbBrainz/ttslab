import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cosineSimilarity, MFCC_DIM, mfccFrames } from "./mfcc";
import { measureRepeatSimilarity } from "./repeat-similarity";
import { concat, silence, sine, speechLike } from "./synthetic-signals";
import { decodeWav } from "./wav";

const SR = 16_000;
const load = (p: string) => decodeWav(new Uint8Array(readFileSync(p)));

describe("mfccFrames", () => {
	it("produces 12 CMN'd, unit-norm coefficients per 10ms frame", () => {
		const frames = mfccFrames(speechLike(SR, 1), SR);
		expect(frames.length).toBeGreaterThan(90);
		expect(frames[0].length).toBe(MFCC_DIM);
		for (const f of frames.slice(0, 5)) {
			let norm = 0;
			for (const v of f) norm += v * v;
			expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
		}
	});

	it("is level-invariant, because CMN plus L2 removes gain", () => {
		const quiet = speechLike(SR, 1);
		const loud = Float32Array.from(quiet, (v) => v * 8);
		const a = mfccFrames(quiet, SR);
		const b = mfccFrames(loud, SR);
		// Same phonetic content at a different level must compare as identical.
		for (let i = 10; i < 20; i++)
			expect(cosineSimilarity(a[i], b[i])).toBeGreaterThan(0.999);
	});

	it("returns an empty array for audio shorter than one frame", () => {
		expect(mfccFrames(silence(100), SR)).toEqual([]);
	});
});

describe("measureRepeatSimilarity — sanity on synthetic signals", () => {
	it("scores a literally duplicated clip as highly repetitive", () => {
		// Spliced duplication IS constant-lag, so this must fire. It is the case
		// the detector handles; the real defect is not this case.
		const half = speechLike(SR, 2);
		const result = measureRepeatSimilarity(concat(half, half), SR);
		expect(result.peakMatch).toBeGreaterThan(0.9);
		expect(result.matchedFraction).toBeGreaterThan(0.2);
	});

	it("returns a defined empty result for input too short to analyse", () => {
		const result = measureRepeatSimilarity(silence(SR / 10), SR);
		expect(result.longestStripeSec).toBe(0);
		expect(result.matchedFraction).toBe(0);
	});

	it("is immune to a perfectly steady tone, because CMN annihilates it", () => {
		// Worth recording, since the intuition points the other way: a sustained
		// tone is self-similar at every lag and looks like an obvious false
		// positive. It is not. Every frame is identical, so subtracting the
		// per-file mean leaves the zero vector, and cosine against zero is 0.
		//
		// So stationary content cannot trip this detector. That removes one
		// suspected false-positive source — and makes the real-speech failure
		// measured below more notable, not less, since it is not steady vowels
		// doing the damage.
		expect(measureRepeatSimilarity(sine(200, SR, 3), SR).peakMatch).toBe(0);
	});
});

describe("measureRepeatSimilarity — the negative result, on real audio", () => {
	// Locked in so the failure cannot be quietly forgotten and re-proposed.
	const CLEAN = [
		"public/audio-samples/kokoro-82m.wav",
		"public/audio-samples/speecht5.wav",
		"public/audio-samples/piper-lessac.wav",
		"public/audio-samples/hero-demo-2.wav",
		"public/audio-samples/hero-demo-3.wav",
		"test-fixtures/speecht5-stock-known-good.wav",
	];

	it("does NOT separate the STUTTER defect from clean real speech", () => {
		const { pcm, sampleRate } = load(
			"test-fixtures/speecht5-cloned-STUTTER-known-bad.wav",
		);
		const defect = measureRepeatSimilarity(pcm, sampleRate);

		const cleanMatched = CLEAN.map((p) => {
			const c = load(p);
			return measureRepeatSimilarity(c.pcm, c.sampleRate).matchedFraction;
		});

		// At least one clean file scores HIGHER than the defect — no threshold
		// exists that fires on the defect without also firing on clean speech.
		expect(Math.max(...cleanMatched)).toBeGreaterThan(defect.matchedFraction);
	});

	it("stays quiet on every clean real sample, which is the one thing it does right", () => {
		for (const p of CLEAN) {
			const { pcm, sampleRate } = load(p);
			// Nothing clean reaches the spec's suggested 0.85-sustained gate for
			// any meaningful duration.
			expect(
				measureRepeatSimilarity(pcm, sampleRate).longestStripeSec,
				p,
			).toBeLessThan(1.0);
		}
	});
});
