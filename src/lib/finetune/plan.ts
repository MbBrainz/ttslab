/**
 * Dispatch planning for the Finetune Lab trainer — pure functions producing
 * op descriptors (kernel + uniform words + buffer names + dispatch shape),
 * exactly like the Woof GPU backend's planner. The session resolves buffer
 * names to real buffers, caches pipelines and bind groups, and replays the
 * cached ops per step. Everything here is unit-testable with no device.
 */
import { FT_KERNELS } from "./kernels";
import { HIDDEN, type MlpShape, OUTPUT_DIM, paramSegments } from "./mlp";
import { BATCH_SIZE, INPUT_DIM } from "./tasks";

// ---------------------------------------------------------------------------
// Word packing helpers (same approach as the Woof planner; fresh code).
// ---------------------------------------------------------------------------

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/** Bit-cast an f32 to its u32 word (uniform structs mix ints and floats). */
export function f32Word(v: number): number {
	f32Scratch[0] = v;
	return u32Scratch[0];
}

/** Round up to the 16-byte alignment uniform buffers require. */
export function round16(n: number): number {
	return Math.max(16, Math.ceil(n / 16) * 16);
}

// ---------------------------------------------------------------------------
// Op descriptors + buffer plan.
// ---------------------------------------------------------------------------

export interface FtOp {
	label: string;
	kernel: string;
	/** Raw uniform words, in the kernel's struct field order. */
	uniforms: number[];
	/** Buffer names for bindings 1..n (binding 0 is the uniform). */
	buffers: string[];
	dispatch: [number, number, number];
	/** When set, binding 0 binds this pre-created shared uniform buffer
	 * instead of materializing one from `uniforms` (Adam's content is
	 * rewritten every step: lr + bias correction). */
	sharedUniform?: string;
}

/** Element counts (f32 unless the name carries the ":u32" marker). */
export function planBuffers(
	batch = BATCH_SIZE,
	shape: MlpShape = {
		in: INPUT_DIM,
		hidden: HIDDEN,
		out: OUTPUT_DIM,
	},
): Map<string, number> {
	const seg = paramSegments(shape);
	const h = shape.hidden;
	const sizes = new Map<string, number>();
	// parameters + grads + Adam moments, one buffer per tensor (segmented so
	// every matmul binds its tensor directly and Adam dispatches per tensor)
	sizes.set("w1", seg.w1.size);
	sizes.set("b1", seg.b1.size);
	sizes.set("w2", seg.w2.size);
	sizes.set("b2", seg.b2.size);
	sizes.set("w3", seg.w3.size);
	sizes.set("b3", seg.b3.size);
	for (const p of ["g", "m", "v"] as const) {
		sizes.set(`${p}w1`, seg.w1.size);
		sizes.set(`${p}b1`, seg.b1.size);
		sizes.set(`${p}w2`, seg.w2.size);
		sizes.set(`${p}b2`, seg.b2.size);
		sizes.set(`${p}w3`, seg.w3.size);
		sizes.set(`${p}b3`, seg.b3.size);
	}
	// state
	sizes.set("feats", batch * shape.in);
	sizes.set("target", batch * shape.out);
	sizes.set("pred", batch * shape.out);
	sizes.set("act1", batch * h);
	sizes.set("act2", batch * h);
	sizes.set("delta3", batch * shape.out);
	sizes.set("deltaA", batch * h);
	sizes.set("deltaB", batch * h);
	sizes.set("err2", batch);
	sizes.set("ones", batch);
	sizes.set("sqout", 6); // grad sum-of-squares partials, one slot per tensor
	sizes.set("bins:u32", 32); // weight histogram
	return sizes;
}

export const PARAM_SEGMENTS_ORDER = [
	{ name: "w1", grad: "gw1", mom: "mw1", vel: "vw1" },
	{ name: "b1", grad: "gb1", mom: "mb1", vel: "vb1" },
	{ name: "w2", grad: "gw2", mom: "mw2", vel: "vw2" },
	{ name: "b2", grad: "gb2", mom: "mb2", vel: "vb2" },
	{ name: "w3", grad: "gw3", mom: "mw3", vel: "vw3" },
	{ name: "b3", grad: "gb3", mom: "mb3", vel: "vb3" },
] as const;

function flat64(n: number): [number, number, number] {
	return [Math.max(1, Math.ceil(n / 64)), 1, 1];
}

/**
 * One training step: 22 dispatches. Forward (mm/tanh ×2 + mm), output delta,
 * backward (wgrad/dgrad/tanh_bwd), Adam per tensor. All uniforms are static
 * EXCEPT Adam's (lr + bias correction change with the learning rate and step
 * count) — the session rewrites the shared Adam uniform before each submit.
 */
export function planStep(
	batch = BATCH_SIZE,
	shape: MlpShape = { in: INPUT_DIM, hidden: HIDDEN, out: OUTPUT_DIM },
): FtOp[] {
	const h = shape.hidden;
	const ops: FtOp[] = [];
	// --- forward ---
	ops.push({
		label: "mm.l1",
		kernel: "mm",
		uniforms: [h, shape.in, batch, 0],
		buffers: ["feats", "w1", "b1", "act1"],
		dispatch: [h, batch, 1],
	});
	ops.push({
		label: "tanh.act1",
		kernel: "tanh",
		uniforms: [batch * h, 0, 0, 0],
		buffers: ["act1"],
		dispatch: flat64(batch * h),
	});
	ops.push({
		label: "mm.l2",
		kernel: "mm",
		uniforms: [h, h, batch, 0],
		buffers: ["act1", "w2", "b2", "act2"],
		dispatch: [h, batch, 1],
	});
	ops.push({
		label: "tanh.act2",
		kernel: "tanh",
		uniforms: [batch * h, 0, 0, 0],
		buffers: ["act2"],
		dispatch: flat64(batch * h),
	});
	ops.push({
		label: "mm.l3",
		kernel: "mm",
		uniforms: [shape.out, h, batch, 0],
		buffers: ["act2", "w3", "b3", "pred"],
		dispatch: [shape.out, batch, 1],
	});
	// --- output delta + squared errors ---
	ops.push({
		label: "mse.delta",
		kernel: "mse_delta",
		// delta = 2·e/n (the dMSE/dpred chain-rule factor, matching mlp.ts)
		uniforms: [batch * shape.out, 0, 0, f32Word(2 / batch)],
		buffers: ["pred", "target", "delta3", "err2"],
		dispatch: flat64(batch * shape.out),
	});
	// --- backward ---
	// gW3 / gb3: d = delta3 (batch × out), a = act2 / ones
	ops.push({
		label: "wg.w3",
		kernel: "wgrad",
		uniforms: [shape.out, h, batch, 0],
		buffers: ["delta3", "act2", "gw3"],
		dispatch: [shape.out, 1, 1],
	});
	ops.push({
		label: "wg.b3",
		kernel: "wgrad",
		uniforms: [shape.out, 1, batch, 0],
		buffers: ["delta3", "ones", "gb3"],
		dispatch: [shape.out, 1, 1],
	});
	// delta into layer 2 pre-activation, then through tanh'
	ops.push({
		label: "dg.h2",
		kernel: "dgrad",
		uniforms: [h, shape.out, batch, 0],
		buffers: ["delta3", "w3", "deltaA"],
		dispatch: [batch, 1, 1],
	});
	ops.push({
		label: "tb.h2",
		kernel: "tanh_bwd",
		uniforms: [batch * h, 0, 0, 0],
		buffers: ["deltaA", "act2"],
		dispatch: flat64(batch * h),
	});
	// gW2 / gb2: d = deltaA, a = act1 / ones
	ops.push({
		label: "wg.w2",
		kernel: "wgrad",
		uniforms: [h, h, batch, 0],
		buffers: ["deltaA", "act1", "gw2"],
		dispatch: [h, 1, 1],
	});
	ops.push({
		label: "wg.b2",
		kernel: "wgrad",
		uniforms: [h, 1, batch, 0],
		buffers: ["deltaA", "ones", "gb2"],
		dispatch: [h, 1, 1],
	});
	// delta into layer 1 pre-activation, then through tanh'
	ops.push({
		label: "dg.h1",
		kernel: "dgrad",
		uniforms: [h, h, batch, 0],
		buffers: ["deltaA", "w2", "deltaB"],
		dispatch: [batch, 1, 1],
	});
	ops.push({
		label: "tb.h1",
		kernel: "tanh_bwd",
		uniforms: [batch * h, 0, 0, 0],
		buffers: ["deltaB", "act1"],
		dispatch: flat64(batch * h),
	});
	// gW1 / gb1: d = deltaB, a = features / ones
	ops.push({
		label: "wg.w1",
		kernel: "wgrad",
		uniforms: [h, shape.in, batch, 0],
		buffers: ["deltaB", "feats", "gw1"],
		dispatch: [h, 1, 1],
	});
	ops.push({
		label: "wg.b1",
		kernel: "wgrad",
		uniforms: [h, 1, batch, 0],
		buffers: ["deltaB", "ones", "gb1"],
		dispatch: [h, 1, 1],
	});
	// --- Adam (6 ops, one uniform buffer per segment — the kernel guards on
	// the segment's n, which lives in the uniform, so uniforms cannot be
	// shared across segments; the session rewrites all six contents per
	// step: same lr/bias correction, different n) ---
	const sizes = planBuffers(batch, shape);
	for (const seg of PARAM_SEGMENTS_ORDER) {
		ops.push({
			label: `adam.${seg.name}`,
			kernel: "adam",
			uniforms: [],
			buffers: [seg.name, seg.grad, seg.mom, seg.vel],
			dispatch: flat64(sizes.get(seg.name) ?? 0),
			sharedUniform: `adamU.${seg.name}`,
		});
	}
	return ops;
}

/**
 * Diagnostics ops, run once per UI tick after the last step (same encoder,
 * ordered passes): gradient sum-of-squares into the 6 slots of `sqout`, then
 * one histogram pass per parameter tensor accumulating atomically into
 * `bins`. Ordered as separate passes so the atomic bin counts are exact.
 */
export function planDiagnostics(
	batch = BATCH_SIZE,
	shape: MlpShape = { in: INPUT_DIM, hidden: HIDDEN, out: OUTPUT_DIM },
): FtOp[] {
	const sizes = planBuffers(batch, shape);
	const ops: FtOp[] = [];
	PARAM_SEGMENTS_ORDER.forEach((seg, i) => {
		ops.push({
			label: `sq.${seg.grad}`,
			kernel: "sqnorm",
			uniforms: [sizes.get(seg.grad) ?? 0, i, 0, 0],
			buffers: [seg.grad, "sqout"],
			dispatch: [1, 1, 1],
		});
	});
	for (const seg of PARAM_SEGMENTS_ORDER) {
		ops.push({
			label: `hist.${seg.name}`,
			kernel: "histogram",
			// content (fmin/finv weight window) is owned by the session and
			// rewritten on every weight reset
			uniforms: [],
			buffers: [seg.name, "bins"],
			dispatch: flat64(sizes.get(seg.name) ?? 0),
			sharedUniform: `histU.${seg.name}`,
		});
	}
	return ops;
}

/** Uniform words for one histogram op (packed in kernel field order). */
export function histogramUniformWords(
	n: number,
	fmin: number,
	finv: number,
): number[] {
	return [n, 0, 0, f32Word(fmin), f32Word(finv)];
}

/** Uniform words for the shared Adam buffer (packed in kernel field order). */
export function adamUniformWords(
	n: number,
	lr: number,
	beta1: number,
	beta2: number,
	eps: number,
	t: number,
): number[] {
	const bc1 = 1 - beta1 ** t;
	const bc2 = 1 - beta2 ** t;
	return [
		n,
		0,
		0,
		f32Word(lr),
		f32Word(beta1),
		f32Word(beta2),
		f32Word(bc1),
		f32Word(bc2),
		f32Word(eps),
	];
}

/** Defensive: every op must reference a registered kernel and (in tests) a
 * planned buffer. Exported for the tests' binding-consistency check. */
export function kernelSource(name: string): string {
	const src = FT_KERNELS[name];
	if (!src) throw new Error(`finetune: unknown kernel ${name}`);
	return src;
}
