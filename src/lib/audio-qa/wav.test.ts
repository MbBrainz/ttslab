import { describe, expect, it } from "vitest";
import { silence, sine, speechLike, withNaNAt } from "./synthetic-signals";
import { decodeWav, encodeWav } from "./wav";

const SR = 16_000;

describe("encodeWav / decodeWav", () => {
	it("round-trips audio within 16-bit quantization error", () => {
		const original = sine(200, SR, 0.5, 0.5);
		const decoded = decodeWav(encodeWav(original, SR));

		expect(decoded.sampleRate).toBe(SR);
		expect(decoded.channels).toBe(1);
		expect(decoded.pcm.length).toBe(original.length);
		for (let i = 0; i < original.length; i++) {
			expect(decoded.pcm[i]).toBeCloseTo(original[i], 3);
		}
	});

	it("preserves the metrics a re-score depends on", () => {
		// The whole reason artifacts are written: a saved WAV must score the
		// same as the buffer it came from, or offline re-scoring is worthless.
		const original = speechLike(SR, 3);
		const decoded = decodeWav(encodeWav(original, SR)).pcm;

		const rms = (pcm: Float32Array) => {
			let sum = 0;
			for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
			return Math.sqrt(sum / pcm.length);
		};
		expect(rms(decoded)).toBeCloseTo(rms(original), 4);
	});

	it("writes a 44-byte header and two bytes per sample", () => {
		expect(encodeWav(silence(100), SR).length).toBe(44 + 200);
	});

	it("clamps out-of-range samples rather than wrapping them", () => {
		const hot = Float32Array.from([2.0, -2.0, 0]);
		const decoded = decodeWav(encodeWav(hot, SR)).pcm;
		expect(decoded[0]).toBeCloseTo(1, 2);
		expect(decoded[1]).toBeCloseTo(-1, 2);
	});

	it("writes NaN as silence instead of a wrapped integer", () => {
		// setInt16 of NaN writes 0 anyway, but relying on that is a trap: the
		// integrity check must run on the ORIGINAL buffer, because a NaN does
		// not survive into the artifact to be found later.
		const decoded = decodeWav(
			encodeWav(withNaNAt(sine(200, SR, 0.1, 0.5), 10), SR),
		).pcm;
		expect(decoded[10]).toBe(0);
		expect(Number.isNaN(decoded[10])).toBe(false);
	});

	it("decodes a data-before-fmt file correctly", () => {
		// RIFF does not require fmt to precede data. Decoding inline as the
		// chunk loop walks the file reads such a file with sampleRate 0 and the
		// default bit depth — silently wrong duration and rate rather than a
		// failure.
		const original = sine(200, SR, 0.2, 0.5);
		const normal = encodeWav(original, SR);

		// Rebuild the same file with the two chunks swapped.
		const fmtChunk = normal.slice(12, 36); // "fmt " header + 16-byte body
		const dataChunk = normal.slice(36); // "data" header + payload
		const swapped = new Uint8Array(normal.length);
		swapped.set(normal.slice(0, 12), 0);
		swapped.set(dataChunk, 12);
		swapped.set(fmtChunk, 12 + dataChunk.length);

		const decoded = decodeWav(swapped);
		expect(decoded.sampleRate).toBe(SR);
		expect(decoded.pcm.length).toBe(original.length);
		expect(decoded.pcm[50]).toBeCloseTo(original[50], 3);
	});

	it("returns an empty buffer rather than throwing when there is no data chunk", () => {
		const headerOnly = encodeWav(new Float32Array(0), SR).slice(0, 36);
		expect(decodeWav(headerOnly).pcm.length).toBe(0);
	});

	it("clamps a data chunk that declares more bytes than the file holds", () => {
		// A truncated download should decode what is there, not read past the end.
		const full = encodeWav(sine(200, SR, 0.2, 0.5), SR);
		const truncated = full.slice(0, full.length - 200);
		expect(() => decodeWav(truncated)).not.toThrow();
		expect(decodeWav(truncated).pcm.length).toBeGreaterThan(0);
	});

	it("handles an empty buffer", () => {
		const decoded = decodeWav(encodeWav(new Float32Array(0), SR));
		expect(decoded.pcm.length).toBe(0);
		expect(decoded.sampleRate).toBe(SR);
	});

	it("round-trips every sample rate the models emit", () => {
		for (const rate of [16_000, 22_050, 24_000, 44_100, 48_000]) {
			expect(decodeWav(encodeWav(sine(200, rate, 0.05), rate)).sampleRate).toBe(
				rate,
			);
		}
	});
});

describe("decodeWav — real committed artifacts", () => {
	it("decodes the committed 16-bit sample the same way the ad-hoc readers did", async () => {
		const { readFileSync } = await import("node:fs");
		const bytes = readFileSync("public/audio-samples/speecht5.wav");
		const decoded = decodeWav(new Uint8Array(bytes));

		expect(decoded.sampleRate).toBe(16_000);
		expect(decoded.pcm.length / decoded.sampleRate).toBeCloseTo(5.18, 1);
	});
});
