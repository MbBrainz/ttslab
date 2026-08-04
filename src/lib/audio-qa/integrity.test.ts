import { describe, expect, it } from "vitest";
import { measureEnergy } from "../testing/audio-analysis";
import { THRESHOLDS } from "../testing/types";
import { checkIntegrity } from "./integrity";
import {
	silence,
	sine,
	withDcOffset,
	withInfinityAt,
	withNaNAt,
} from "./synthetic-signals";

const SR = 16_000;
const clean = sine(200, SR, 1, 0.5);

describe("checkIntegrity — NaN and Infinity", () => {
	it("passes clean audio", () => {
		const result = checkIntegrity(clean);
		expect(result).toMatchObject({
			nanCount: 0,
			infiniteCount: 0,
			usable: true,
		});
	});

	it("catches a single NaN that would otherwise poison every metric", () => {
		// measureEnergy returns NaN for this input, and NaN compares false
		// against every threshold — so without this gate a broken tensor passes.
		const poisoned = withNaNAt(clean, 500);
		expect(checkIntegrity(poisoned).nanCount).toBe(1);
		expect(checkIntegrity(poisoned).usable).toBe(false);
		expect(Number.isNaN(measureEnergy(poisoned).rmsDb)).toBe(true);
	});

	it("catches Infinity", () => {
		const result = checkIntegrity(withInfinityAt(clean, 500));
		expect(result.infiniteCount).toBe(1);
		expect(result.usable).toBe(false);
	});

	it("does not let NaN leak into the DC or dB figures", () => {
		const result = checkIntegrity(withNaNAt(clean, 500));
		expect(Number.isNaN(result.dcOffset)).toBe(false);
		expect(Number.isNaN(result.dcOffsetDb)).toBe(false);
	});

	it("treats an empty buffer as unusable", () => {
		expect(checkIntegrity(new Float32Array(0)).usable).toBe(false);
	});
});

describe("checkIntegrity — DC offset", () => {
	it("reports no DC on a symmetric signal", () => {
		expect(checkIntegrity(clean).dcOffset).toBeCloseTo(0, 4);
		expect(checkIntegrity(clean).dcOffsetDb).toBeLessThan(
			THRESHOLDS.dcOffsetDb.warn,
		);
	});

	it("measures an injected offset and fails on it", () => {
		const offset = checkIntegrity(withDcOffset(clean, 0.2));
		expect(offset.dcOffset).toBeCloseTo(0.2, 3);
		// Relative to RMS, so it is a ratio rather than an absolute level.
		expect(offset.dcOffsetDb).toBeGreaterThan(THRESHOLDS.dcOffsetDb.fail);
	});

	it("scales the reported dB with the offset size", () => {
		const small = checkIntegrity(withDcOffset(clean, 0.01)).dcOffsetDb;
		const large = checkIntegrity(withDcOffset(clean, 0.2)).dcOffsetDb;
		expect(large).toBeGreaterThan(small);
	});

	it("reports -Infinity rather than NaN for digital silence", () => {
		const result = checkIntegrity(silence(SR));
		expect(result.dcOffsetDb).toBe(Number.NEGATIVE_INFINITY);
		expect(result.usable).toBe(true);
	});
});
