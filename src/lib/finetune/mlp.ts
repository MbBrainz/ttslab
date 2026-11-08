/**
 * CPU reference implementation of the Finetune Lab model — a 2-hidden-layer
 * tanh MLP trained with real backprop + Adam. This is the ground truth the
 * GPU kernels are written against: every function here mirrors one WGSL
 * kernel's math exactly (see kernels.ts), and the tests verify it with a
 * finite-difference gradient check plus a real CPU training run.
 *
 * Layout mirrors plan.ts:
 *   W1 (hidden, in) | b1 (hidden) | W2 (hidden, hidden) | b2 (hidden)
 *   | W3 (out, hidden) | b3 (out)  — concatenated into one flat array.
 */
import { INPUT_DIM, mulberry32 } from "./tasks";

export const HIDDEN = 64;
export const OUTPUT_DIM = 1;

export interface MlpShape {
	in: number;
	hidden: number;
	out: number;
}

export const MLP_SHAPE: MlpShape = {
	in: INPUT_DIM,
	hidden: HIDDEN,
	out: OUTPUT_DIM,
};

export interface ParamSegments {
	w1: { offset: number; size: number };
	b1: { offset: number; size: number };
	w2: { offset: number; size: number };
	b2: { offset: number; size: number };
	w3: { offset: number; size: number };
	b3: { offset: number; size: number };
	total: number;
}

/** Segment layout of the flat parameter array (shared with plan.ts). */
export function paramSegments(shape: MlpShape = MLP_SHAPE): ParamSegments {
	const w1 = shape.hidden * shape.in;
	const b1 = shape.hidden;
	const w2 = shape.hidden * shape.hidden;
	const b2 = shape.hidden;
	const w3 = shape.out * shape.hidden;
	const b3 = shape.out;
	const seg = (offset: number, size: number) => ({ offset, size });
	return {
		w1: seg(0, w1),
		b1: seg(w1, b1),
		w2: seg(w1 + b1, w2),
		b2: seg(w1 + b1 + w2, b2),
		w3: seg(w1 + b1 + w2 + b2, w3),
		b3: seg(w1 + b1 + w2 + b2 + w3, b3),
		total: w1 + b1 + w2 + b2 + w3 + b3,
	};
}

export const PARAM_COUNT = paramSegments().total; // 5313

/**
 * Glorot-uniform weight init, zero biases. Deterministic under `seed`.
 */
export function createParams(
	shape: MlpShape = MLP_SHAPE,
	seed = 0,
): { params: Float32Array; paramMin: number; paramMax: number } {
	const rng = mulberry32(seed);
	const seg = paramSegments(shape);
	const params = new Float32Array(seg.total);
	const glorot = (fanIn: number, fanOut: number): number =>
		Math.sqrt(6 / (fanIn + fanOut));
	const fill = (s: { offset: number; size: number }, limit: number): void => {
		if (limit === 0) return; // biases stay exactly +0 (never -0)
		for (let i = 0; i < s.size; i++) {
			params[s.offset + i] = (rng() * 2 - 1) * limit;
		}
	};
	fill(seg.w1, glorot(shape.in, shape.hidden));
	fill(seg.b1, 0);
	fill(seg.w2, glorot(shape.hidden, shape.hidden));
	fill(seg.b2, 0);
	fill(seg.w3, glorot(shape.hidden, shape.out));
	fill(seg.b3, 0);
	let min = Infinity;
	let max = -Infinity;
	for (const v of params) {
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return { params, paramMin: min, paramMax: max };
}

/** tanh activation — same stable exp form as the WGSL kernel. */
export function tanh1(x: number): number {
	const e = Math.exp(-2 * Math.abs(x));
	return (x >= 0 ? 1 : -1) * ((1 - e) / (1 + e));
}

export interface Activations {
	a1: Float32Array; // (batch, hidden)
	a2: Float32Array; // (batch, hidden)
}

/**
 * Forward pass. `pred` gets (batch,) predictions; activations are kept for
 * the backward pass. Mirrors the mm.l1/tanh/mm.l2/tanh/mm.l3 kernel chain.
 */
export function forward(
	params: Float32Array,
	features: Float32Array,
	batch: number,
	shape: MlpShape,
	act: Activations,
	pred: Float32Array,
): void {
	const seg = paramSegments(shape);
	const { in: din, hidden: h, out: dout } = shape;
	for (let t = 0; t < batch; t++) {
		for (let o = 0; o < h; o++) {
			let s = params[seg.b1.offset + o];
			for (let j = 0; j < din; j++) {
				s += params[seg.w1.offset + o * din + j] * features[t * din + j];
			}
			act.a1[t * h + o] = tanh1(s);
		}
		for (let o = 0; o < h; o++) {
			let s = params[seg.b2.offset + o];
			for (let j = 0; j < h; j++) {
				s += params[seg.w2.offset + o * h + j] * act.a1[t * h + j];
			}
			act.a2[t * h + o] = tanh1(s);
		}
		for (let o = 0; o < dout; o++) {
			let s = params[seg.b3.offset + o];
			for (let j = 0; j < h; j++) {
				s += params[seg.w3.offset + o * h + j] * act.a2[t * h + j];
			}
			pred[t * dout + o] = s;
		}
	}
}

export interface Grads {
	g: Float32Array; // same layout as params
	d3: Float32Array; // (batch * dout) output deltas
	deltaA: Float32Array; // (batch * hidden) scratch
	deltaB: Float32Array; // (batch * hidden) scratch
	err2: Float32Array; // (batch) per-sample squared errors
}

/**
 * Backward pass — real backprop. Fills `grads.g` and returns MSE loss.
 * Mirrors the mse_delta / wgrad / dgrad / tanh_bwd kernel chain.
 */
export function backward(
	params: Float32Array,
	features: Float32Array,
	targets: Float32Array,
	batch: number,
	shape: MlpShape,
	act: Activations,
	pred: Float32Array,
	grads: Grads,
): number {
	const seg = paramSegments(shape);
	const { in: din, hidden: h, out: dout } = shape;
	grads.g.fill(0);
	// dMSE/dpred = 2·e/n — the factor the WGSL mse_delta kernel also carries
	const invN = 2 / batch;
	let loss = 0;
	// output deltas + squared errors (mse_delta)
	for (let t = 0; t < batch; t++) {
		const e = pred[t] - targets[t];
		grads.d3[t] = e * invN;
		grads.err2[t] = e * e;
		loss += e * e;
	}
	// gW3 / gb3 (wgrad, rows = dout, cols = hidden, a = act2)
	for (let o = 0; o < dout; o++) {
		for (let c = 0; c < h; c++) {
			let acc = 0;
			for (let t = 0; t < batch; t++) {
				acc += grads.d3[t * dout + o] * act.a2[t * h + c];
			}
			grads.g[seg.w3.offset + o * h + c] = acc;
		}
		for (let t = 0; t < batch; t++) {
			grads.g[seg.b3.offset + o] += grads.d3[t * dout + o];
		}
	}
	// delta into layer 2 pre-activation (dgrad), then tanh_bwd
	for (let t = 0; t < batch; t++) {
		for (let i = 0; i < h; i++) {
			let acc = 0;
			for (let o = 0; o < dout; o++) {
				acc += grads.d3[t * dout + o] * params[seg.w3.offset + o * h + i];
			}
			grads.deltaA[t * h + i] =
				acc * (1 - act.a2[t * h + i] * act.a2[t * h + i]);
		}
	}
	// gW2 / gb2 (a = act1)
	for (let o = 0; o < h; o++) {
		for (let c = 0; c < h; c++) {
			let acc = 0;
			for (let t = 0; t < batch; t++) {
				acc += grads.deltaA[t * h + o] * act.a1[t * h + c];
			}
			grads.g[seg.w2.offset + o * h + c] = acc;
		}
		let accB = 0;
		for (let t = 0; t < batch; t++) {
			accB += grads.deltaA[t * h + o];
		}
		grads.g[seg.b2.offset + o] = accB;
	}
	// delta into layer 1 pre-activation (dgrad), then tanh_bwd
	for (let t = 0; t < batch; t++) {
		for (let i = 0; i < h; i++) {
			let acc = 0;
			for (let o = 0; o < h; o++) {
				acc += grads.deltaA[t * h + o] * params[seg.w2.offset + o * h + i];
			}
			grads.deltaB[t * h + i] =
				acc * (1 - act.a1[t * h + i] * act.a1[t * h + i]);
		}
	}
	// gW1 / gb1 (a = features)
	for (let o = 0; o < h; o++) {
		for (let c = 0; c < din; c++) {
			let acc = 0;
			for (let t = 0; t < batch; t++) {
				acc += grads.deltaB[t * h + o] * features[t * din + c];
			}
			grads.g[seg.w1.offset + o * din + c] = acc;
		}
		let accB = 0;
		for (let t = 0; t < batch; t++) {
			accB += grads.deltaB[t * h + o];
		}
		grads.g[seg.b1.offset + o] = accB;
	}
	return loss / batch;
}

export interface AdamState {
	m: Float32Array;
	v: Float32Array;
	beta1: number;
	beta2: number;
	eps: number;
}

/** One Adam step (CPU reference of the adam kernel). t is 1-indexed. */
export function adamStep(
	params: Float32Array,
	g: Float32Array,
	state: AdamState,
	t: number,
	lr: number,
): void {
	const bc1 = 1 - state.beta1 ** t;
	const bc2 = 1 - state.beta2 ** t;
	for (let i = 0; i < params.length; i++) {
		const gi = g[i];
		state.m[i] = state.beta1 * state.m[i] + (1 - state.beta1) * gi;
		state.v[i] = state.beta2 * state.v[i] + (1 - state.beta2) * gi * gi;
		const mHat = state.m[i] / bc1;
		const vHat = state.v[i] / bc2;
		params[i] -= (lr * mHat) / (Math.sqrt(vHat) + state.eps);
	}
}

/** Sum of squares over a grad array — the CPU reference of the sqnorm kernel. */
export function gradNorm2(g: Float32Array): number {
	let s = 0;
	for (const v of g) s += v * v;
	return s;
}

export interface TrainBuffers {
	params: Float32Array;
	g: Float32Array;
	act: Activations;
	pred: Float32Array;
	grads: Grads;
	adam: AdamState;
}

export function makeTrainBuffers(
	batch: number,
	shape: MlpShape = MLP_SHAPE,
	seed = 0,
): TrainBuffers {
	const seg = paramSegments(shape);
	const { params } = createParams(shape, seed);
	const g = new Float32Array(seg.total);
	return {
		params,
		g,
		act: {
			a1: new Float32Array(batch * shape.hidden),
			a2: new Float32Array(batch * shape.hidden),
		},
		pred: new Float32Array(batch * shape.out),
		grads: {
			g,
			d3: new Float32Array(batch * shape.out),
			deltaA: new Float32Array(batch * shape.hidden),
			deltaB: new Float32Array(batch * shape.hidden),
			err2: new Float32Array(batch),
		},
		adam: {
			m: new Float32Array(seg.total),
			v: new Float32Array(seg.total),
			beta1: 0.9,
			beta2: 0.999,
			eps: 1e-8,
		},
	};
}

/**
 * One full training step on the CPU — the exact sequence the GPU executes
 * per frame (forward -> backward -> Adam). Returns the MSE loss.
 */
export function cpuTrainStep(
	buf: TrainBuffers,
	features: Float32Array,
	targets: Float32Array,
	batch: number,
	shape: MlpShape,
	t: number,
	lr: number,
): number {
	forward(buf.params, features, batch, shape, buf.act, buf.pred);
	const loss = backward(
		buf.params,
		features,
		targets,
		batch,
		shape,
		buf.act,
		buf.pred,
		buf.grads,
	);
	adamStep(buf.params, buf.g, buf.adam, t, lr);
	return loss;
}
