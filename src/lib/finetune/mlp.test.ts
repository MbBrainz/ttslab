import { describe, expect, it } from "vitest";
import {
	adamStep,
	backward,
	cpuTrainStep,
	createParams,
	forward,
	gradNorm2,
	MLP_SHAPE,
	type MlpShape,
	makeTrainBuffers,
	PARAM_COUNT,
	paramSegments,
	tanh1,
} from "./mlp";
import { buildDataset } from "./tasks";

const TINY: MlpShape = { in: 3, hidden: 5, out: 1 };

describe("mlp param layout", () => {
	it("totals 5313 parameters for the 16-64-64-1 shape", () => {
		expect(PARAM_COUNT).toBe(5313);
		const seg = paramSegments();
		expect(seg.w1).toEqual({ offset: 0, size: 64 * 16 });
		expect(seg.b1).toEqual({ offset: 1024, size: 64 });
		expect(seg.w2).toEqual({ offset: 1088, size: 64 * 64 });
		expect(seg.b2).toEqual({ offset: 5184, size: 64 });
		expect(seg.w3).toEqual({ offset: 5248, size: 64 });
		expect(seg.b3).toEqual({ offset: 5312, size: 1 });
		expect(seg.total).toBe(5313);
	});

	it("is deterministic per seed and Glorot-bounded", () => {
		const a = createParams(MLP_SHAPE, 7);
		const b = createParams(MLP_SHAPE, 7);
		expect(a.params).toEqual(b.params);
		const c = createParams(MLP_SHAPE, 8);
		expect(Array.from(a.params)).not.toEqual(Array.from(c.params));
		// W2 limit = sqrt(6/128) ~ 0.2165 — nothing exceeds it at init
		for (const v of a.params) expect(Math.abs(v)).toBeLessThanOrEqual(0.31);
		// biases start at exactly zero
		const seg = paramSegments();
		for (const s of [seg.b1, seg.b2, seg.b3]) {
			for (let i = 0; i < s.size; i++) {
				expect(a.params[s.offset + i]).toBe(0);
			}
		}
	});
});

describe("mlp tanh reference", () => {
	it("matches Math.tanh closely (stable exp form)", () => {
		for (const x of [-8, -1.5, -0.1, 0, 0.1, 1.5, 8]) {
			expect(tanh1(x)).toBeCloseTo(Math.tanh(x), 8);
		}
	});
});

describe("mlp backward: finite-difference gradient check", () => {
	// The core honesty proof for this demo: the analytic backprop gradients
	// match numerical differentiation of the loss. If backprop is wrong,
	// nothing the page shows is real training.
	const shape = TINY;
	const batch = 4;
	const features = new Float32Array(batch * shape.in);
	const targets = new Float32Array(batch);
	for (let i = 0; i < batch; i++) {
		for (let j = 0; j < shape.in; j++) {
			features[i * shape.in + j] = Math.sin(i + j * 1.7);
		}
		targets[i] = i % 2 === 0 ? 0.5 : -0.5;
	}
	const { params } = createParams(shape, 3);
	const act = {
		a1: new Float32Array(batch * shape.hidden),
		a2: new Float32Array(batch * shape.hidden),
	};
	const pred = new Float32Array(batch);
	const g = new Float32Array(paramSegments(shape).total);
	const grads = {
		g,
		d3: new Float32Array(batch),
		deltaA: new Float32Array(batch * shape.hidden),
		deltaB: new Float32Array(batch * shape.hidden),
		err2: new Float32Array(batch),
	};

	function lossOf(p: Float32Array): number {
		forward(p, features, batch, shape, act, pred);
		let loss = 0;
		for (let t = 0; t < batch; t++) {
			const e = pred[t] - targets[t];
			loss += e * e;
		}
		return loss / batch;
	}

	it("analytic grads match central finite differences at sampled points", () => {
		const act2 = {
			a1: new Float32Array(batch * shape.hidden),
			a2: new Float32Array(batch * shape.hidden),
		};
		forward(params, features, batch, shape, act2, pred);
		backward(params, features, targets, batch, shape, act2, pred, grads);
		const eps = 1e-3;
		const n = params.length;
		const step = Math.max(1, Math.floor(n / 12));
		let checked = 0;
		for (let idx = 0; idx < n; idx += step) {
			const bumped = params.slice();
			bumped[idx] += eps;
			const lossPlus = lossOf(bumped);
			bumped[idx] = params[idx] - eps;
			const lossMinus = lossOf(bumped);
			const fd = (lossPlus - lossMinus) / (2 * eps);
			const an = grads.g[idx];
			const tol = 1e-2 * Math.max(Math.abs(fd), Math.abs(an), 1e-3);
			expect(Math.abs(fd - an)).toBeLessThan(tol);
			checked++;
		}
		expect(checked).toBeGreaterThanOrEqual(10);
	});
});

describe("adam reference", () => {
	it("first step moves each parameter by ~lr*sign(g) (bias correction)", () => {
		const params = new Float32Array([1, -2, 0.5]);
		const g = new Float32Array([1, -1, 3]);
		const state = {
			m: new Float32Array(3),
			v: new Float32Array(3),
			beta1: 0.9,
			beta2: 0.999,
			eps: 1e-8,
		};
		adamStep(params, g, state, 1, 0.1);
		// t=1: mhat = g, vhat = g^2 -> update = lr*g/(|g|+eps)
		expect(params[0]).toBeCloseTo(1 - 0.1, 6);
		expect(params[1]).toBeCloseTo(-2 + 0.1, 6);
		expect(params[2]).toBeCloseTo(0.5 - 0.1, 6);
	});

	it("zero gradients leave parameters unchanged", () => {
		const params = new Float32Array([1, 2]);
		const state = {
			m: new Float32Array(2),
			v: new Float32Array(2),
			beta1: 0.9,
			beta2: 0.999,
			eps: 1e-8,
		};
		adamStep(params, new Float32Array(2), state, 4, 0.1);
		expect(params[0]).toBe(1);
		expect(params[1]).toBe(2);
	});

	it("moments accumulate as exponential averages", () => {
		const params = new Float32Array([0]);
		const state = {
			m: new Float32Array(1),
			v: new Float32Array(1),
			beta1: 0.9,
			beta2: 0.999,
			eps: 0,
		};
		adamStep(params, new Float32Array([2]), state, 1, 0.01);
		expect(state.m[0]).toBeCloseTo(0.1 * 2, 6); // f32 storage precision
		expect(state.v[0]).toBeCloseTo(0.001 * 4, 6);
		adamStep(params, new Float32Array([2]), state, 2, 0.01);
		expect(state.m[0]).toBeCloseTo(0.9 * 0.2 + 0.1 * 2, 6);
		expect(state.v[0]).toBeCloseTo(0.999 * 0.004 + 0.001 * 4, 6);
	});
});

describe("gradNorm2", () => {
	it("sums squares (CPU reference of the sqnorm kernel)", () => {
		expect(gradNorm2(new Float32Array([3, 4]))).toBe(25);
		expect(gradNorm2(new Float32Array([]))).toBe(0);
	});
});

describe("cpu training loop (the math the GPU replays)", () => {
	it("genuinely learns: sine loss falls by >75% within 200 Adam steps", () => {
		const batch = 128;
		const ds = buildDataset("sine");
		const buf = makeTrainBuffers(batch, MLP_SHAPE, 0);
		const first = cpuTrainStep(
			buf,
			ds.features,
			ds.targets,
			batch,
			MLP_SHAPE,
			1,
			0.02,
		);
		let loss = first;
		for (let t = 2; t <= 200; t++) {
			loss = cpuTrainStep(
				buf,
				ds.features,
				ds.targets,
				batch,
				MLP_SHAPE,
				t,
				0.02,
			);
		}
		expect(first).toBeGreaterThan(0.1);
		expect(loss).toBeLessThan(first * 0.25);
		// and the weights actually moved
		const fresh = makeTrainBuffers(batch, MLP_SHAPE, 0);
		expect(Array.from(fresh.params)).not.toEqual(Array.from(buf.params));
	});

	it("training with a square wave lands at a higher loss floor than sine", () => {
		const batch = 128;
		const run = (task: "sine" | "square"): number => {
			const ds = buildDataset(task);
			const buf = makeTrainBuffers(batch, MLP_SHAPE, 0);
			let loss = 0;
			for (let t = 1; t <= 150; t++) {
				loss = cpuTrainStep(
					buf,
					ds.features,
					ds.targets,
					batch,
					MLP_SHAPE,
					t,
					0.02,
				);
			}
			return loss;
		};
		expect(run("square")).toBeGreaterThan(run("sine"));
	});
});
