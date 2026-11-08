/**
 * Training task + dataset for the Finetune Lab: fit one period of a
 * selectable 1D wave (sine, square, triangle) on [0, 1). Pure math — no
 * GPU, fully unit-testable.
 *
 * Inputs are fixed (non-trainable) Fourier features [sin(2πkx), cos(2πkx)]
 * for k = 1..K. The trainable part is the MLP on top (16 -> 64 -> 64 -> 1);
 * the Fourier encoding is a deterministic input transform, disclosed as such
 * on the page.
 */

export const FOURIER_K = 8;
export const INPUT_DIM = 2 * FOURIER_K; // 16
export const BATCH_SIZE = 128;

export type TaskId = "sine" | "square" | "triangle";

export const TASK_IDS: TaskId[] = ["sine", "square", "triangle"];

export const TASK_LABELS: Record<TaskId, string> = {
	sine: "Sine",
	square: "Square",
	triangle: "Triangle",
};

/** One period of the target wave on [0, 1). Range [-1, 1]. */
export function targetValue(task: TaskId, x: number): number {
	const t = x - Math.floor(x); // fold into [0, 1)
	switch (task) {
		case "sine":
			return Math.sin(2 * Math.PI * t);
		case "square":
			// sign of the sine, with the zero crossings assigned to +1
			return Math.sin(2 * Math.PI * t) >= 0 ? 1 : -1;
		case "triangle":
			// -1 at 0, +1 at 0.5, -1 at 1 (corner wave, no jump)
			return 1 - 4 * Math.abs(t - 0.5);
	}
}

/** Fixed Fourier feature map: [sin(2πkx), cos(2πkx)] for k = 1..FOURIER_K. */
export function fourierFeatureRow(
	x: number,
	out: Float32Array,
	offset = 0,
): void {
	for (let k = 1; k <= FOURIER_K; k++) {
		const ang = 2 * Math.PI * k * x;
		out[offset + 2 * (k - 1)] = Math.sin(ang);
		out[offset + 2 * (k - 1) + 1] = Math.cos(ang);
	}
}

export interface Dataset {
	task: TaskId;
	/** Batch-size sample positions, evenly spaced over [0, 1). */
	xs: Float32Array;
	/** (batch, INPUT_DIM) fixed Fourier features. */
	features: Float32Array;
	/** (batch,) target values. */
	targets: Float32Array;
}

export function buildDataset(task: TaskId, batch = BATCH_SIZE): Dataset {
	const xs = new Float32Array(batch);
	const features = new Float32Array(batch * INPUT_DIM);
	const targets = new Float32Array(batch);
	for (let i = 0; i < batch; i++) {
		const x = i / batch;
		xs[i] = x;
		fourierFeatureRow(x, features, i * INPUT_DIM);
		targets[i] = targetValue(task, x);
	}
	return { task, xs, features, targets };
}

/**
 * Seeded PRNG (mulberry32) so weight init is reproducible — the same seed
 * produces bit-identical initial weights, which the tests and the Reset
 * button both rely on.
 */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
