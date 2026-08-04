/**
 * Minimal radix-2 FFT. No dependencies — this stack is deliberately model-free
 * and dependency-free so it can run in Node, in the browser, and in a test.
 */

export function nextPowerOfTwo(n: number): number {
	let p = 1;
	while (p < n) p *= 2;
	return p;
}

function bitReverseInPlace(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
}

/**
 * In-place forward DFT. Length must be a power of two.
 *
 * Twiddle factors are evaluated directly per butterfly rather than carried in a
 * running product: the running-product form drifts on long transforms, and a
 * cepstrum takes the log of this output, where drift in small magnitudes is
 * amplified rather than averaged away.
 */
export function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	if (im.length !== n) throw new Error("fft: re/im length mismatch");
	if (n === 0 || (n & (n - 1)) !== 0) {
		throw new Error(`fft: length must be a power of two, got ${n}`);
	}

	bitReverseInPlace(re, im);

	for (let len = 2; len <= n; len <<= 1) {
		const half = len >> 1;
		const step = (-2 * Math.PI) / len;
		for (let start = 0; start < n; start += len) {
			for (let k = 0; k < half; k++) {
				const angle = step * k;
				const wRe = Math.cos(angle);
				const wIm = Math.sin(angle);
				const i = start + k;
				const j = i + half;

				const vRe = re[j] * wRe - im[j] * wIm;
				const vIm = re[j] * wIm + im[j] * wRe;

				re[j] = re[i] - vRe;
				im[j] = im[i] - vIm;
				re[i] += vRe;
				im[i] += vIm;
			}
		}
	}
}

/** In-place inverse DFT, normalized by 1/n. */
export function ifft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 0; i < n; i++) im[i] = -im[i];
	fft(re, im);
	for (let i = 0; i < n; i++) {
		re[i] /= n;
		im[i] = -im[i] / n;
	}
}
