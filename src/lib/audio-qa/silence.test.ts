import { describe, expect, it } from "vitest";
import { measureSilence } from "../testing/audio-analysis";
import { THRESHOLDS } from "../testing/types";
import { measureFrameSilence } from "./silence";
import {
	concat,
	overlapAdd,
	scale,
	silence,
	sine,
	speechLike,
} from "./synthetic-signals";

const SR = 16_000;
const speech = speechLike(SR, 4);

describe("measureFrameSilence — level independence", () => {
	// This is the reason the metric exists. The old per-sample test reports the
	// same speech as 0.230 at full level and 0.900 at -46dB, crossing its warn
	// threshold on a gain change alone.
	it("reports the identical fraction across a 46dB level range", () => {
		const reference = measureFrameSilence(speech, SR).silenceFraction;
		for (const factor of [1, 0.1, 0.02, 0.005]) {
			expect(
				measureFrameSilence(scale(speech, factor), SR).silenceFraction,
				`gain x${factor}`,
			).toBeCloseTo(reference, 10);
		}
	});

	it("beats the per-sample metric it replaces on that same sweep", () => {
		const oldSpread = [1, 0.1, 0.02, 0.005].map(
			(f) => measureSilence(scale(speech, f), SR).ratio,
		);
		const newSpread = [1, 0.1, 0.02, 0.005].map(
			(f) => measureFrameSilence(scale(speech, f), SR).silenceFraction,
		);
		const spread = (values: number[]) =>
			Math.max(...values) - Math.min(...values);

		expect(spread(oldSpread)).toBeGreaterThan(0.5);
		expect(spread(newSpread)).toBe(0);
	});

	it("does not count a tone's zero crossings as silence", () => {
		// The per-sample test reports 0.025 here on a signal with no silence.
		expect(measureFrameSilence(sine(200, SR, 2), SR).silenceFraction).toBe(0);
		expect(measureSilence(sine(200, SR, 2), SR).ratio).toBeGreaterThan(0.02);
	});
});

describe("measureFrameSilence — dead audio", () => {
	it("reports digital silence as fully silent with no segments", () => {
		const result = measureFrameSilence(silence(SR * 3), SR);
		expect(result.silenceFraction).toBe(1);
		expect(result.segmentCount).toBe(0);
		expect(result.silenceFraction).toBeGreaterThan(
			THRESHOLDS.frameSilence.fail,
		);
	});

	it("treats audio below the dead-audio floor as silent rather than amplifying noise", () => {
		// Peak-relative gating alone would rescale a -80dB noise floor into
		// "speech". The absolute floor is what stops that.
		const nearlyDead = scale(speech, 0.00005);
		expect(measureFrameSilence(nearlyDead, SR).silenceFraction).toBe(1);
	});

	it("returns a defined result for an empty buffer", () => {
		const result = measureFrameSilence(new Float32Array(0), SR);
		expect(result.silenceFraction).toBe(1);
		expect(result.frameCount).toBe(0);
	});
});

describe("measureFrameSilence — structure", () => {
	it("measures leading and trailing silence", () => {
		// The fixture's own first/last syllable pauses count toward the edges, so
		// this asserts the ADDED padding rather than an absolute figure.
		const bare = measureFrameSilence(speech, SR);
		const padded = measureFrameSilence(
			concat(silence(SR / 2), speech, silence(SR / 4)),
			SR,
		);

		// Tolerance is one 20ms frame — the measurement is frame-quantized.
		expect(
			Math.abs(padded.leadingMs - bare.leadingMs - 500),
		).toBeLessThanOrEqual(20);
		expect(
			Math.abs(padded.trailingMs - bare.trailingMs - 250),
		).toBeLessThanOrEqual(20);
	});

	it("counts speech segments — the fragmentation signal", () => {
		expect(measureFrameSilence(speech, SR).segmentCount).toBeGreaterThan(1);
		expect(measureFrameSilence(sine(200, SR, 2), SR).segmentCount).toBe(1);
	});
});

describe("pauseFraction — the variable-speed overlap partial cover", () => {
	it("drops when a second voice fills the gaps", () => {
		// Superimposed speech fills each other's pauses. This is the only Tier-1
		// signal with any sensitivity to overlap the cepstral metric misses.
		const clean = measureFrameSilence(speech, SR).pauseFraction;
		const overlapped = measureFrameSilence(
			overlapAdd(speech, SR, 1.2),
			SR,
		).pauseFraction;
		expect(overlapped).toBeLessThan(clean);
	});

	it("KNOWN WEAKNESS: the separation is small, so this cannot gate alone", () => {
		// Measured 0.315 clean vs 0.242 overlapped — a 23% relative drop, well
		// short of the 2x the spec reports. Reported for diagnosis; deliberately
		// NOT wired into CHECK_RULES, because a threshold between these two
		// numbers would false-fail any model that simply pauses less.
		const clean = measureFrameSilence(speech, SR).pauseFraction;
		const overlapped = measureFrameSilence(
			overlapAdd(speech, SR, 1.2),
			SR,
		).pauseFraction;
		expect(clean - overlapped).toBeLessThan(0.2);
	});
});
