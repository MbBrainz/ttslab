import { describe, expect, it } from "vitest";
import { fft, ifft, nextPowerOfTwo } from "./fft";

describe("nextPowerOfTwo", () => {
	it("rounds up to a power of two", () => {
		expect(nextPowerOfTwo(1)).toBe(1);
		expect(nextPowerOfTwo(2)).toBe(2);
		expect(nextPowerOfTwo(3)).toBe(4);
		expect(nextPowerOfTwo(1000)).toBe(1024);
		expect(nextPowerOfTwo(1024)).toBe(1024);
	});
});

describe("fft", () => {
	it("rejects non-power-of-two lengths instead of returning garbage", () => {
		expect(() => fft(new Float64Array(3), new Float64Array(3))).toThrow(
			/power of two/,
		);
	});

	it("rejects mismatched re/im lengths", () => {
		expect(() => fft(new Float64Array(4), new Float64Array(8))).toThrow(
			/mismatch/,
		);
	});

	it("puts a DC signal entirely in bin 0", () => {
		const n = 16;
		const re = new Float64Array(n).fill(1);
		const im = new Float64Array(n);
		fft(re, im);

		expect(re[0]).toBeCloseTo(n, 10);
		for (let k = 1; k < n; k++) {
			expect(Math.hypot(re[k], im[k])).toBeCloseTo(0, 10);
		}
	});

	it("puts a pure sinusoid in its own bin pair", () => {
		const n = 64;
		const bin = 5;
		const re = new Float64Array(n);
		const im = new Float64Array(n);
		for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n);

		fft(re, im);

		const magnitudes = Array.from({ length: n }, (_, k) =>
			Math.hypot(re[k], im[k]),
		);
		expect(magnitudes[bin]).toBeCloseTo(n / 2, 8);
		expect(magnitudes[n - bin]).toBeCloseTo(n / 2, 8);
		for (let k = 0; k < n; k++) {
			if (k !== bin && k !== n - bin) expect(magnitudes[k]).toBeCloseTo(0, 8);
		}
	});
});

describe("ifft", () => {
	it("round-trips a signal back to itself", () => {
		const n = 128;
		const original = Array.from(
			{ length: n },
			(_, i) => Math.sin(i / 3) + 0.5 * Math.cos(i / 7),
		);
		const re = Float64Array.from(original);
		const im = new Float64Array(n);

		fft(re, im);
		ifft(re, im);

		for (let i = 0; i < n; i++) {
			expect(re[i]).toBeCloseTo(original[i], 10);
			expect(im[i]).toBeCloseTo(0, 10);
		}
	});
});
