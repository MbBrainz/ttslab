import { describe, expect, it } from "vitest";
import {
	clip,
	concat,
	overlapAdd,
	scale,
	silence,
	sine,
	speechLike,
	variableSpeedOverlap,
} from "../audio-qa/synthetic-signals";
import {
	detectClipping,
	detectEcho,
	measureEnergy,
	measureSilence,
} from "./audio-analysis";
import { THRESHOLDS } from "./types";

const SR = 16_000;

describe("detectEcho", () => {
	it("does not fire on clean speech-like audio", () => {
		const clean = speechLike(SR, 5);
		expect(detectEcho(clean, SR).confidence).toBeLessThan(THRESHOLDS.echo.warn);
	});

	it("does not fire on silence", () => {
		expect(detectEcho(silence(SR * 2), SR).confidence).toBe(0);
	});

	it("catches additive overlap inside its 50-500ms search window", () => {
		const overlapped = overlapAdd(speechLike(SR, 5), SR, 0.4);
		expect(detectEcho(overlapped, SR).confidence).toBeGreaterThan(
			THRESHOLDS.echo.warn,
		);
	});

	// ── Characterization of the KNOWN blind spot, per docs/model-qa-harness.md.
	// These assert the CURRENT broken behaviour on purpose, so that the step-5
	// cepstral replacement has a documented before-state to beat. They are not
	// statements that this behaviour is correct.
	it("KNOWN BLIND SPOT: cannot see duplication beyond 500ms", () => {
		const clean = speechLike(SR, 3);
		const duplicated = concat(clean, clean);
		// Autoregressive looping happens at 1-5s offsets, outside the window.
		expect(detectEcho(duplicated, SR).confidence).toBeLessThan(
			THRESHOLDS.echo.warn,
		);
	});

	it("KNOWN BLIND SPOT: cannot see overlap at a 1.2s lag", () => {
		const overlapped = overlapAdd(speechLike(SR, 5), SR, 1.2);
		expect(detectEcho(overlapped, SR).confidence).toBeLessThan(
			THRESHOLDS.echo.warn,
		);
	});

	it("KNOWN BLIND SPOT: cannot see variable-speed overlap", () => {
		// A time-warped copy has no single lag, so every fixed-lag metric --
		// including the step-5 cepstral one -- is blind to this.
		const warped = variableSpeedOverlap(speechLike(SR, 5), 1.35);
		expect(detectEcho(warped, SR).confidence).toBeLessThan(
			THRESHOLDS.echo.warn,
		);
	});
});

describe("measureSilence", () => {
	it("reports all-silence as ratio 1", () => {
		expect(measureSilence(silence(SR), SR).ratio).toBe(1);
	});

	it("reports leading and trailing silence in ms", () => {
		const padded = concat(silence(SR / 2), sine(200, SR, 1), silence(SR / 4));
		const result = measureSilence(padded, SR);
		expect(result.leadingMs).toBeCloseTo(500, 0);
		expect(result.trailingMs).toBeCloseTo(250, 0);
	});

	it("counts a tone's zero crossings as silence", () => {
		// Not a bug being asserted as correct — a measured property of a
		// per-sample |x| < 0.001 test. A 200 Hz sine at 16 kHz spends ~2.5% of
		// its samples inside that band purely crossing zero, with no silence
		// present at all. On a real utterance this inflates the ratio by a few
		// points; frame-RMS (step 5) does not have this failure mode.
		expect(measureSilence(sine(200, SR, 2), SR).ratio).toBeCloseTo(0.025, 2);
	});

	// ── The level-dependence the spec calls out. Asserted so the frame-RMS
	// replacement in step 5 has a concrete before-state.
	it("KNOWN WEAKNESS: the same speech scores differently at different levels", () => {
		const loud = speechLike(SR, 4);
		const quiet = scale(loud, 0.02);

		const loudRatio = measureSilence(loud, SR).ratio;
		const quietRatio = measureSilence(quiet, SR).ratio;

		// Identical waveform shape, zero additional silence — yet the reported
		// ratio moves, because the test is a fixed 0.001 absolute threshold.
		expect(quietRatio).toBeGreaterThan(loudRatio);
	});
});

describe("detectClipping", () => {
	it("reports no clipping on a half-scale sine", () => {
		expect(detectClipping(sine(200, SR, 1, 0.5)).count).toBe(0);
	});

	it("detects hard-clipped overdrive", () => {
		const clipped = clip(sine(200, SR, 1, 0.5), 12);
		const result = detectClipping(clipped);
		expect(result.count).toBeGreaterThan(0);
		expect(result.ratio).toBeGreaterThan(THRESHOLDS.clipping.fail);
	});

	it("returns zero for empty input rather than NaN", () => {
		expect(detectClipping(new Float32Array(0))).toEqual({ ratio: 0, count: 0 });
	});

	// A single sample at full scale is a legitimate peak, not overdrive. The
	// spec's fix is consecutive-run detection (step 5); today any sample counts.
	it("KNOWN WEAKNESS: counts isolated full-scale samples as clipping", () => {
		const pcm = sine(200, SR, 1, 0.5);
		pcm[100] = 1.0;
		expect(detectClipping(pcm).count).toBe(1);
	});
});

describe("measureEnergy", () => {
	it("computes RMS of a half-scale sine at the expected level", () => {
		// RMS of a sine at amplitude a is a/sqrt(2) -> 0.3536 -> -9.03 dBFS.
		expect(measureEnergy(sine(200, SR, 1, 0.5)).rmsDb).toBeCloseTo(-9.03, 1);
	});

	it("reports -Infinity for digital silence", () => {
		const result = measureEnergy(silence(SR));
		expect(result.rmsDb).toBe(Number.NEGATIVE_INFINITY);
		expect(result.peakDb).toBe(Number.NEGATIVE_INFINITY);
	});

	it("tracks a level change one-for-one in dB", () => {
		const loud = measureEnergy(sine(200, SR, 1, 0.5)).rmsDb;
		const quiet = measureEnergy(sine(200, SR, 1, 0.05)).rmsDb;
		expect(loud - quiet).toBeCloseTo(20, 1);
	});

	it("returns -Infinity, not NaN, for empty input", () => {
		expect(measureEnergy(new Float32Array(0)).rmsDb).toBe(
			Number.NEGATIVE_INFINITY,
		);
	});

	// NaN propagates silently through every sum in this file. Step 5 adds an
	// explicit NaN/Inf gate ahead of the other metrics.
	it("KNOWN WEAKNESS: a single NaN sample poisons the result silently", () => {
		const pcm = sine(200, SR, 1, 0.5);
		pcm[500] = Number.NaN;
		expect(Number.isNaN(measureEnergy(pcm).rmsDb)).toBe(true);
	});
});
