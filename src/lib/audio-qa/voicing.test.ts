import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../testing/types";
import { silence, sine, speechLike } from "./synthetic-signals";
import { measureVoicing } from "./voicing";
import { decodeWav } from "./wav";

const SR = 16_000;
const flatnessOf = (path: string) => {
	const { pcm } = decodeWav(new Uint8Array(readFileSync(path)));
	return measureVoicing(pcm).medianFlatness;
};

/** Every negative used to set the threshold: clean renders AND working clones. */
const NEGATIVES = [
	"public/audio-samples/kokoro-82m.wav",
	"public/audio-samples/speecht5.wav",
	"public/audio-samples/piper-lessac.wav",
	"public/audio-samples/hero-demo-1.wav",
	"public/audio-samples/hero-demo-2.wav",
	"public/audio-samples/hero-demo-3.wav",
	"test-fixtures/speecht5-stock-known-good.wav",
	"qa-artifacts/voice-clone/1-stock-before-clone.wav",
	"qa-artifacts/voice-clone/0-control-stock-0.wav",
	"qa-artifacts/voice-clone/2-cloned.wav",
	"qa-artifacts/voice-clone-run2/2-cloned.wav",
];

describe("measureVoicing — basic behaviour", () => {
	it("reports a tone as strongly tonal and noise as flat", () => {
		expect(measureVoicing(sine(220, SR, 2)).medianFlatness).toBeLessThan(0.01);
		const noise = new Float32Array(SR * 2);
		let seed = 1;
		for (let i = 0; i < noise.length; i++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			noise[i] = (seed / 0x7fffffff) * 2 - 1;
		}
		expect(measureVoicing(noise).medianFlatness).toBeGreaterThan(0.3);
	});

	it("is level-invariant, because the floor and gate are peak-relative", () => {
		const speech = speechLike(SR, 3);
		const loud = measureVoicing(speech).medianFlatness;
		const quiet = measureVoicing(
			Float32Array.from(speech, (v) => v * 0.01),
		).medianFlatness;
		expect(quiet).toBeCloseTo(loud, 6);
	});

	it("returns 0 rather than NaN for silence or empty input", () => {
		expect(measureVoicing(silence(SR)).medianFlatness).toBe(0);
		expect(measureVoicing(new Float32Array(0))).toEqual({
			medianFlatness: 0,
			measuredFrames: 0,
		});
	});
});

describe("the WARN-ONLY threshold, against the populations that set it", () => {
	it("stays under the warn threshold for every negative, including working clones", () => {
		// If any of these crossed, the check would warn on healthy output — which
		// is the whole risk with a 112x-spread negative population.
		for (const p of NEGATIVES) {
			expect(flatnessOf(p), p).toBeLessThan(THRESHOLDS.spectralFlatness.warn);
		}
	});

	it("warns on both real defect fixtures", () => {
		expect(
			flatnessOf("test-fixtures/speecht5-cloned-STUTTER-known-bad.wav"),
		).toBeGreaterThan(THRESHOLDS.spectralFlatness.warn);
		expect(
			flatnessOf("test-fixtures/speecht5-cloned-TRUNCATED-known-bad.wav"),
		).toBeGreaterThan(THRESHOLDS.spectralFlatness.warn);
	});

	it("keeps the stated headroom above negatives and margin below the weaker positive", () => {
		const negMax = Math.max(...NEGATIVES.map(flatnessOf));
		const weaker = flatnessOf(
			"test-fixtures/speecht5-cloned-TRUNCATED-known-bad.wav",
		);
		const warn = THRESHOLDS.spectralFlatness.warn;
		// Documented as 1.89x above the negatives and 1.81x below the weaker
		// positive. Assert both directions clear 1.5x so a silent drift in either
		// population is caught rather than absorbed.
		expect(warn / negMax).toBeGreaterThan(1.5);
		expect(weaker / warn).toBeGreaterThan(1.5);
	});

	it("HAS NO FAIL TIER — a run must never fail on this evidence base", () => {
		// Structural, not stylistic: THRESHOLDS.spectralFlatness must not grow a
		// `fail` key, and CheckRule.fail is optional so that adding one is a
		// deliberate edit rather than a tweaked number.
		expect("fail" in THRESHOLDS.spectralFlatness).toBe(false);
	});
});
