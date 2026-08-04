import { describe, expect, it } from "vitest";
import { detectClipping } from "../testing/audio-analysis";
import { THRESHOLDS } from "../testing/types";
import { detectRunClipping } from "./clipping";
import { clip, sine, speechLike } from "./synthetic-signals";

const SR = 16_000;

describe("detectRunClipping", () => {
	it("reports nothing on clean audio", () => {
		const result = detectRunClipping(speechLike(SR, 3));
		expect(result.runCount).toBe(0);
		expect(result.clippedFraction).toBe(0);
	});

	it("ignores an isolated full-scale sample", () => {
		// A single sample at full scale is a legitimate waveform peak. The
		// per-sample metric reports count 1 for it — noise, not a defect.
		const pcm = sine(200, SR, 1, 0.5);
		pcm[100] = 1.0;

		expect(detectRunClipping(pcm).runCount).toBe(0);
		expect(detectClipping(pcm).count).toBe(1);
	});

	it("still records the sample at the ceiling for diagnosis", () => {
		const pcm = sine(200, SR, 1, 0.5);
		pcm[100] = 1.0;
		expect(detectRunClipping(pcm).ceilingSampleCount).toBe(1);
	});

	it("requires three consecutive samples before counting a run", () => {
		const pcm = sine(200, SR, 1, 0.5);
		pcm[200] = 1.0;
		pcm[201] = 1.0;
		expect(detectRunClipping(pcm).runCount).toBe(0);

		pcm[202] = 1.0;
		const result = detectRunClipping(pcm);
		expect(result.runCount).toBe(1);
		expect(result.longestRunSamples).toBe(3);
	});

	it("detects overdrive and exceeds the fail threshold", () => {
		const result = detectRunClipping(clip(sine(200, SR, 1, 0.5), 12));
		expect(result.runCount).toBeGreaterThan(100);
		expect(result.clippedFraction).toBeGreaterThan(
			THRESHOLDS.clippedFraction.fail,
		);
	});

	it("counts a run that ends at the final sample", () => {
		// Off-by-one guard: the loop must close an open run after it exits.
		const pcm = new Float32Array(10);
		pcm[7] = 1.0;
		pcm[8] = 1.0;
		pcm[9] = 1.0;
		expect(detectRunClipping(pcm).runCount).toBe(1);
	});

	it("returns zeros for an empty buffer rather than NaN", () => {
		const result = detectRunClipping(new Float32Array(0));
		expect(result.clippedFraction).toBe(0);
		expect(result.runCount).toBe(0);
	});

	it("treats negative excursions as clipping too", () => {
		const pcm = new Float32Array(10);
		pcm[2] = -1.0;
		pcm[3] = -1.0;
		pcm[4] = -1.0;
		expect(detectRunClipping(pcm).runCount).toBe(1);
	});
});
