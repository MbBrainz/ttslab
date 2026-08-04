import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../testing/types";
import { cepstralPeakProminence } from "./cepstrum";
import {
	concat,
	overlapAdd,
	scale,
	silence,
	speechLike,
	variableSpeedOverlap,
	withNaNAt,
} from "./synthetic-signals";

const SR = 16_000;
const clean = speechLike(SR, 5);

describe("cepstralPeakProminence — clean audio", () => {
	it("stays well under the warn threshold on clean speech", () => {
		expect(cepstralPeakProminence(clean, SR).ratio).toBeLessThan(
			THRESHOLDS.cepstralRatio.warn,
		);
	});

	it("is scale-invariant — the whole point of a relative spectral floor", () => {
		// log(a·x) = log(a) + log(x), so a gain change lands entirely in
		// cepstral bin 0 and must not move any lag in the search band. An
		// absolute floor would break this.
		// Compared relatively: the fixtures are Float32Array, so a gain change
		// perturbs the stored samples at float32 precision. Invariance holds to
		// ~1e-6 relative, which is that rounding and not the metric.
		const base = cepstralPeakProminence(clean, SR).ratio;
		for (const factor of [0.01, 50]) {
			const scaled = cepstralPeakProminence(scale(clean, factor), SR).ratio;
			expect(Math.abs(scaled - base) / base, `gain x${factor}`).toBeLessThan(
				1e-5,
			);
		}
	});

	it("returns zero rather than NaN for degenerate input", () => {
		expect(cepstralPeakProminence(new Float32Array(0), SR).ratio).toBe(0);
		expect(cepstralPeakProminence(clean, 0).ratio).toBe(0);
		expect(cepstralPeakProminence(silence(SR * 2), SR).ratio).toBe(0);
		// Too short for the 0.15s minimum lag.
		expect(cepstralPeakProminence(speechLike(SR, 0.1), SR).ratio).toBe(0);
	});

	it("returns zero for a NaN-poisoned buffer instead of NaN", () => {
		// A NaN ratio would compare false against every threshold and pass the
		// gate. Callers still must run checkIntegrity first, but this must not
		// be the thing that lets a broken tensor through.
		const result = cepstralPeakProminence(withNaNAt(clean, 1000), SR);
		expect(result.ratio).toBe(0);
		expect(Number.isNaN(result.ratio)).toBe(false);
	});
});

describe("cepstralPeakProminence — defects it must catch", () => {
	it("fires on additive overlap and names the lag", () => {
		for (const delaySec of [0.4, 1.2, 2.0]) {
			const result = cepstralPeakProminence(
				overlapAdd(clean, SR, delaySec),
				SR,
			);
			expect(result.ratio, `overlap @${delaySec}s`).toBeGreaterThan(
				THRESHOLDS.cepstralRatio.fail,
			);
			expect(result.peakLagSec, `lag @${delaySec}s`).toBeCloseTo(delaySec, 2);
		}
	});

	it("fires on a duplicated utterance and reports the original length as the lag", () => {
		const half = speechLike(SR, 3);
		const result = cepstralPeakProminence(concat(half, half), SR);
		expect(result.ratio).toBeGreaterThan(THRESHOLDS.cepstralRatio.fail);
		// The repeat lag equals the original clip length. This is exactly the
		// case a fixed 3.0s band cannot see, and why the band is half-duration.
		expect(result.peakLagSec).toBeCloseTo(3.0, 1);
	});

	it("catches what detectEcho's 50-500ms window structurally cannot", () => {
		// detectEcho measures 0.070-0.095 on all three of these — no separation
		// from its 0.066 clean baseline.
		const cases = [
			overlapAdd(clean, SR, 1.2),
			overlapAdd(clean, SR, 2.0),
			concat(speechLike(SR, 3), speechLike(SR, 3)),
		];
		for (const pcm of cases) {
			expect(cepstralPeakProminence(pcm, SR).ratio).toBeGreaterThan(
				THRESHOLDS.cepstralRatio.fail,
			);
		}
	});
});

describe("cepstralPeakProminence — documented blind spot", () => {
	it("KNOWN BLIND SPOT: variable-speed overlap is invisible", () => {
		// A time-warped copy has no single lag, so no fixed-lag metric can see
		// it. Asserted so a PASS here is never mistaken for proof of no overlap.
		// Pause fraction is the partial cover — see silence.test.ts.
		const warped = variableSpeedOverlap(clean, 1.35);
		expect(cepstralPeakProminence(warped, SR).ratio).toBeLessThan(
			THRESHOLDS.cepstralRatio.warn,
		);
	});

	it("ignores pitch periodicity — a pure tone does NOT trip it", () => {
		// Measured 4.87. The 0.15s band floor is what buys this: a 200Hz tone
		// repeats every 5ms, three orders of magnitude below the band, so its
		// periodicity is excluded by construction. Worth locking in — the old
		// detectEcho scores a full 1.0000 on the same signal, since its
		// 50-500ms window sits right on top of the pitch harmonics.
		const tone = new Float32Array(SR * 2);
		for (let i = 0; i < tone.length; i++) {
			tone[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / SR);
		}
		expect(cepstralPeakProminence(tone, SR).ratio).toBeLessThan(
			THRESHOLDS.cepstralRatio.warn,
		);
	});
});
