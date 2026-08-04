/**
 * Deterministic synthetic signals for calibrating audio metrics.
 *
 * Every generator here is seeded or closed-form — no Math.random — because a
 * detector threshold proven against a signal you cannot reproduce is not
 * proven at all. The spec's position is that this calibration IS the harness's
 * acceptance test: a detector nobody has tested cannot be trusted to gate.
 *
 * Not app code. Imported only by tests and by ad-hoc measurement scripts.
 */

/** mulberry32 — small, fast, deterministic. */
function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function silence(lengthSamples: number): Float32Array {
	return new Float32Array(lengthSamples);
}

export function sine(
	freqHz: number,
	sampleRate: number,
	durationSec: number,
	amplitude = 0.5,
): Float32Array {
	const out = new Float32Array(Math.round(sampleRate * durationSec));
	for (let i = 0; i < out.length; i++) {
		out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
	}
	return out;
}

export function whiteNoise(
	lengthSamples: number,
	amplitude = 0.1,
	seed = 1,
): Float32Array {
	const rand = seededRandom(seed);
	const out = new Float32Array(lengthSamples);
	for (let i = 0; i < out.length; i++) out[i] = (rand() * 2 - 1) * amplitude;
	return out;
}

/**
 * A voiced-speech stand-in that is deliberately NON-STATIONARY.
 *
 * This matters more than it looks. A fixed-f0 harmonic stack is periodic, so
 * its autocorrelation is ~1.0 at every multiple of the pitch period — measured
 * 0.9999 through `detectEcho`, i.e. indistinguishable from a duplicated
 * recording. Any repetition test built on such a signal is meaningless.
 *
 * So each ~250ms syllable gets its own f0 (with a glide), its own harmonic
 * amplitude profile, a raised-cosine envelope and a trailing pause, and ~20%
 * are unvoiced fricative noise. That drives clean-signal autocorrelation down
 * near what real TTS output measures (0.023-0.072 on the committed samples)
 * while staying perfectly reproducible from `seed`.
 */
export function speechLike(
	sampleRate: number,
	durationSec: number,
	f0 = 120,
	seed = 7,
): Float32Array {
	const rand = seededRandom(seed);
	const out = new Float32Array(Math.round(sampleRate * durationSec));
	const syllableLen = Math.round(sampleRate * 0.25);
	let phase = 0;

	for (let start = 0; start < out.length; start += syllableLen) {
		const end = Math.min(start + syllableLen, out.length);
		const voiced = rand() > 0.2;
		const f0Start = f0 * (0.85 + rand() * 0.35);
		const f0End = f0 * (0.85 + rand() * 0.35);
		const harmonics = [1, rand(), rand(), rand(), rand()];
		// Trailing pause per syllable. 0.18 puts the overall silence fraction
		// inside the 0.19-0.27 the committed real samples measure; at 0.25 the
		// fixture itself tripped the 0.3 silence warn.
		const bodyEnd = end - Math.round((end - start) * 0.18);

		for (let i = start; i < bodyEnd; i++) {
			const u = (i - start) / Math.max(1, bodyEnd - start);
			const env = Math.sin(Math.PI * u) ** 2;
			phase += (2 * Math.PI * (f0Start + (f0End - f0Start) * u)) / sampleRate;

			let sample = 0;
			if (voiced) {
				for (let h = 1; h <= 5; h++) {
					sample += (harmonics[h - 1] / h) * Math.sin(h * phase);
				}
			} else {
				sample = (rand() * 2 - 1) * 2; // fricative
			}
			out[i] = 0.25 * env * sample;
		}
	}
	return out;
}

/** Word-length pauses every `periodSec`, each `pauseSec` long. */
export function withPauses(
	pcm: Float32Array,
	sampleRate: number,
	periodSec: number,
	pauseSec: number,
): Float32Array {
	const out = Float32Array.from(pcm);
	const period = Math.round(sampleRate * periodSec);
	const pause = Math.round(sampleRate * pauseSec);
	for (let start = period; start < out.length; start += period) {
		out.fill(0, start, Math.min(start + pause, out.length));
	}
	return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Float32Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

/**
 * Additive overlap at a constant lag — the "two voices at once" defect. This is
 * the case a fixed-lag detector can see.
 */
export function overlapAdd(
	pcm: Float32Array,
	sampleRate: number,
	delaySec: number,
	gain = 0.6,
): Float32Array {
	const delay = Math.round(sampleRate * delaySec);
	const out = new Float32Array(pcm.length + delay);
	for (let i = 0; i < pcm.length; i++) {
		out[i] += pcm[i] * gain;
		out[i + delay] += pcm[i] * gain;
	}
	return out;
}

/** Nearest-neighbour time scale. `factor` > 1 makes it longer/slower. */
export function timeScale(pcm: Float32Array, factor: number): Float32Array {
	const out = new Float32Array(Math.round(pcm.length * factor));
	for (let i = 0; i < out.length; i++) {
		out[i] = pcm[Math.min(pcm.length - 1, Math.floor(i / factor))];
	}
	return out;
}

/**
 * Overlap where the copy runs at a different speed. The spec's documented
 * blind spot: a time-warped copy has no single lag, so fixed-lag metrics see
 * nothing.
 */
export function variableSpeedOverlap(
	pcm: Float32Array,
	speedFactor = 1.35,
	gain = 0.6,
): Float32Array {
	const stretched = timeScale(pcm, 1 / speedFactor);
	const out = new Float32Array(Math.max(pcm.length, stretched.length));
	for (let i = 0; i < pcm.length; i++) out[i] += pcm[i] * gain;
	for (let i = 0; i < stretched.length; i++) out[i] += stretched[i] * gain;
	return out;
}

export function scale(pcm: Float32Array, factor: number): Float32Array {
	const out = new Float32Array(pcm.length);
	for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * factor;
	return out;
}

/** Hard-clip after applying `gain` — the overdrive defect. */
export function clip(pcm: Float32Array, gain = 10): Float32Array {
	const out = new Float32Array(pcm.length);
	for (let i = 0; i < pcm.length; i++) {
		out[i] = Math.max(-1, Math.min(1, pcm[i] * gain));
	}
	return out;
}

export function withDcOffset(pcm: Float32Array, offset: number): Float32Array {
	const out = new Float32Array(pcm.length);
	for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] + offset;
	return out;
}

export function withNaNAt(pcm: Float32Array, index: number): Float32Array {
	const out = Float32Array.from(pcm);
	out[index] = Number.NaN;
	return out;
}

export function withInfinityAt(pcm: Float32Array, index: number): Float32Array {
	const out = Float32Array.from(pcm);
	out[index] = Number.POSITIVE_INFINITY;
	return out;
}
