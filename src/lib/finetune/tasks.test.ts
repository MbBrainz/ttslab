import { describe, expect, it } from "vitest";
import {
	BATCH_SIZE,
	buildDataset,
	fourierFeatureRow,
	INPUT_DIM,
	mulberry32,
	TASK_IDS,
	targetValue,
} from "./tasks";

describe("finetune target waves", () => {
	it("sine: one period, known values", () => {
		expect(targetValue("sine", 0)).toBeCloseTo(0, 10);
		expect(targetValue("sine", 0.25)).toBeCloseTo(1, 10);
		expect(targetValue("sine", 0.75)).toBeCloseTo(-1, 10);
	});

	it("square: ±1 with zero crossings assigned to +1", () => {
		expect(targetValue("square", 0.1)).toBe(1);
		expect(targetValue("square", 0.6)).toBe(-1);
		expect(targetValue("square", 0.25)).toBe(1);
		expect(Math.abs(targetValue("square", 0))).toBe(1);
	});

	it("triangle: corners at ±1, peak at 0.5", () => {
		expect(targetValue("triangle", 0)).toBeCloseTo(-1, 10);
		expect(targetValue("triangle", 0.5)).toBeCloseTo(1, 10);
		expect(targetValue("triangle", 1)).toBeCloseTo(-1, 10);
		expect(targetValue("triangle", 0.25)).toBeCloseTo(0, 10);
	});

	it("folds any x into [0, 1) — periodic by construction", () => {
		for (const task of TASK_IDS) {
			for (const x of [-2.75, -1, 0.25, 1.25, 7.5]) {
				expect(targetValue(task, x)).toBeCloseTo(
					targetValue(task, x - Math.floor(x)),
					12,
				);
			}
		}
	});
});

describe("finetune fourier features", () => {
	it("produces 2K features per row: sin at even, cos at odd indices", () => {
		const row = new Float32Array(INPUT_DIM);
		fourierFeatureRow(0, row);
		expect(row.length).toBe(16);
		for (let k = 0; k < 8; k++) {
			expect(row[2 * k]).toBeCloseTo(0, 12); // sin(0) = 0
			expect(row[2 * k + 1]).toBeCloseTo(1, 12); // cos(0) = 1
		}
	});

	it("matches sin/cos at x = 0.25 for k = 1", () => {
		const row = new Float32Array(INPUT_DIM);
		fourierFeatureRow(0.25, row);
		expect(row[0]).toBeCloseTo(Math.sin(Math.PI / 2), 12);
		expect(row[1]).toBeCloseTo(Math.cos(Math.PI / 2), 12);
		expect(row[2]).toBeCloseTo(Math.sin(Math.PI), 12); // k = 2
	});

	it("all features stay within [-1, 1]", () => {
		const { features } = buildDataset("square");
		for (const v of features) {
			expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-12);
		}
	});
});

describe("finetune dataset", () => {
	it("builds a full-batch dataset: evenly spaced xs, matching targets", () => {
		const ds = buildDataset("triangle");
		expect(ds.xs.length).toBe(BATCH_SIZE);
		expect(ds.features.length).toBe(BATCH_SIZE * INPUT_DIM);
		expect(ds.targets.length).toBe(BATCH_SIZE);
		expect(ds.xs[0]).toBe(0);
		expect(ds.xs[1]).toBeCloseTo(1 / BATCH_SIZE, 12);
		for (let i = 0; i < BATCH_SIZE; i++) {
			expect(ds.targets[i]).toBeCloseTo(targetValue("triangle", ds.xs[i]), 12);
		}
	});

	it("supports custom batch sizes", () => {
		const ds = buildDataset("sine", 8);
		expect(ds.xs.length).toBe(8);
		expect(ds.features.length).toBe(8 * INPUT_DIM);
	});
});

describe("finetune seeded rng", () => {
	it("is deterministic per seed and within [0, 1)", () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		for (let i = 0; i < 100; i++) {
			const va = a();
			const vb = b();
			expect(va).toBe(vb);
			expect(va).toBeGreaterThanOrEqual(0);
			expect(va).toBeLessThan(1);
		}
		const c = mulberry32(43);
		expect(c()).not.toBe(mulberry32(42)());
	});
});
