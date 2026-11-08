import { describe, expect, it } from "vitest";
import { FT_KERNEL_COUNT, FT_KERNELS } from "./kernels";
import { HIDDEN, OUTPUT_DIM } from "./mlp";
import {
	adamUniformWords,
	f32Word,
	histogramUniformWords,
	PARAM_SEGMENTS_ORDER,
	planBuffers,
	planDiagnostics,
	planStep,
	round16,
} from "./plan";
import { BATCH_SIZE, INPUT_DIM } from "./tasks";

describe("ft kernel registry", () => {
	it("ships 9 compute kernels with entry points", () => {
		const names = Object.keys(FT_KERNELS);
		expect(FT_KERNEL_COUNT).toBe(9);
		expect(names.length).toBe(9);
		for (const name of names) {
			expect(FT_KERNELS[name]).toContain("@compute");
			expect(FT_KERNELS[name]).toContain("@workgroup_size(64)");
			expect(FT_KERNELS[name]).toContain("fn main");
		}
	});

	it("keeps the documented kernel set", () => {
		expect(Object.keys(FT_KERNELS).sort()).toEqual(
			[
				"adam",
				"dgrad",
				"histogram",
				"mm",
				"mse_delta",
				"sqnorm",
				"tanh",
				"tanh_bwd",
				"wgrad",
			].sort(),
		);
	});

	it("only uses u32 atomics (WGSL has no f32 atomics)", () => {
		expect(FT_KERNELS.histogram).toContain("array<atomic<u32>>");
		expect(FT_KERNELS.histogram).toContain("atomicAdd");
		// NaN weights must never be indexed (u32(NaN) is undefined behavior)
		expect(FT_KERNELS.histogram).toContain("raw == raw");
	});
});

describe("ft buffer plan", () => {
	const sizes = planBuffers();

	it("sizes the six parameter tensors and their grad/moment twins", () => {
		expect(sizes.get("w1")).toBe(64 * 16);
		expect(sizes.get("b1")).toBe(64);
		expect(sizes.get("w2")).toBe(64 * 64);
		expect(sizes.get("b2")).toBe(64);
		expect(sizes.get("w3")).toBe(64);
		expect(sizes.get("b3")).toBe(1);
		for (const p of ["g", "m", "v"] as const) {
			expect(sizes.get(`${p}w2`)).toBe(64 * 64);
			expect(sizes.get(`${p}b3`)).toBe(1);
		}
	});

	it("sizes the training state for the full batch", () => {
		expect(sizes.get("feats")).toBe(BATCH_SIZE * INPUT_DIM);
		expect(sizes.get("act1")).toBe(BATCH_SIZE * HIDDEN);
		expect(sizes.get("act2")).toBe(BATCH_SIZE * HIDDEN);
		expect(sizes.get("delta3")).toBe(BATCH_SIZE * OUTPUT_DIM);
		expect(sizes.get("err2")).toBe(BATCH_SIZE);
		expect(sizes.get("ones")).toBe(BATCH_SIZE);
		expect(sizes.get("sqout")).toBe(6);
		expect(sizes.get("bins:u32")).toBe(32);
	});

	it("rounds uniform sizes to 16-byte alignment", () => {
		expect(round16(1)).toBe(16);
		expect(round16(36)).toBe(48); // adam struct: 9 words
		expect(round16(20)).toBe(32); // histogram struct: 5 words
	});
});

describe("ft step plan", () => {
	const ops = planStep();

	it("dispatches exactly 22 kernels per training step", () => {
		expect(ops.length).toBe(22);
	});

	it("runs forward -> delta -> backward -> adam in dependency order", () => {
		const labels = ops.map((o) => o.label);
		const idx = (l: string) => labels.indexOf(l);
		expect(idx("mm.l1")).toBeLessThan(idx("tanh.act1"));
		expect(idx("tanh.act1")).toBeLessThan(idx("mm.l2"));
		expect(idx("mm.l2")).toBeLessThan(idx("tanh.act2"));
		expect(idx("tanh.act2")).toBeLessThan(idx("mm.l3"));
		expect(idx("mm.l3")).toBeLessThan(idx("mse.delta"));
		expect(idx("mse.delta")).toBeLessThan(idx("wg.w3"));
		expect(idx("wg.b3")).toBeLessThan(idx("dg.h2"));
		expect(idx("dg.h2")).toBeLessThan(idx("tb.h2"));
		expect(idx("tb.h2")).toBeLessThan(idx("wg.w2"));
		expect(idx("wg.w2")).toBeLessThan(idx("dg.h1"));
		expect(idx("dg.h1")).toBeLessThan(idx("tb.h1"));
		expect(idx("tb.h1")).toBeLessThan(idx("wg.w1"));
		expect(idx("wg.b1")).toBeLessThan(idx("adam.w1"));
		expect(labels[labels.length - 1]).toBe("adam.b3");
	});

	it("matmul shapes follow the layer dims", () => {
		const l1 = ops.find((o) => o.label === "mm.l1");
		if (!l1) throw new Error("no mm.l1");
		// out=64 hidden, cols=16 inputs, tokens=batch -> [64, batch, 1]
		expect(l1.uniforms).toEqual([HIDDEN, INPUT_DIM, BATCH_SIZE, 0]);
		expect(l1.buffers).toEqual(["feats", "w1", "b1", "act1"]);
		expect(l1.dispatch).toEqual([HIDDEN, BATCH_SIZE, 1]);
		const l3 = ops.find((o) => o.label === "mm.l3");
		if (!l3) throw new Error("no mm.l3");
		expect(l3.uniforms).toEqual([OUTPUT_DIM, HIDDEN, BATCH_SIZE, 0]);
		expect(l3.dispatch).toEqual([OUTPUT_DIM, BATCH_SIZE, 1]);
	});

	it("wgrad overwrites full grad tensors (no accumulation, no zeroing)", () => {
		const w2 = ops.find((o) => o.label === "wg.w2");
		if (!w2) throw new Error("no wg.w2");
		expect(w2.uniforms).toEqual([HIDDEN, HIDDEN, BATCH_SIZE, 0]);
		expect(w2.buffers).toEqual(["deltaA", "act1", "gw2"]);
		expect(w2.dispatch).toEqual([HIDDEN, 1, 1]);
		const b3 = ops.find((o) => o.label === "wg.b3");
		if (!b3) throw new Error("no wg.b3");
		// bias grad = wgrad against a ones-vector (cols=1)
		expect(b3.buffers).toEqual(["delta3", "ones", "gb3"]);
		expect(b3.uniforms).toEqual([OUTPUT_DIM, 1, BATCH_SIZE, 0]);
	});

	it("adam ops share the per-segment uniform and cover every tensor", () => {
		const adamOps = ops.filter((o) => o.kernel === "adam");
		expect(adamOps.map((o) => o.label)).toEqual(
			PARAM_SEGMENTS_ORDER.map((s) => `adam.${s.name}`),
		);
		for (const op of adamOps) {
			expect(op.sharedUniform).toMatch(/^adamU\./);
			expect(op.buffers).toHaveLength(4); // params, grads, mom, vel
		}
		const w1 = adamOps.find((o) => o.label === "adam.w1");
		expect(w1?.dispatch).toEqual([Math.ceil(1024 / 64), 1, 1]);
	});

	it("delta ping-pong buffers never feed a dgrad in place", () => {
		const dg = ops.find((o) => o.label === "dg.h2");
		if (!dg) throw new Error("no dg.h2");
		expect(dg.buffers).toEqual(["delta3", "w3", "deltaA"]);
		const dg1 = ops.find((o) => o.label === "dg.h1");
		if (!dg1) throw new Error("no dg.h1");
		expect(dg1.buffers).toEqual(["deltaA", "w2", "deltaB"]);
	});
});

describe("ft diagnostics plan", () => {
	const ops = planDiagnostics();

	it("runs one sqnorm per grad tensor + one histogram per param tensor", () => {
		const sq = ops.filter((o) => o.label.startsWith("sq."));
		const hist = ops.filter((o) => o.label.startsWith("hist."));
		expect(sq).toHaveLength(6);
		expect(hist).toHaveLength(6);
		sq.forEach((op, i) => {
			expect(op.uniforms[1]).toBe(i); // output slot
			expect(op.buffers[1]).toBe("sqout");
			expect(op.dispatch).toEqual([1, 1, 1]);
		});
		for (const op of hist) {
			expect(op.sharedUniform).toMatch(/^histU\./);
			expect(op.buffers[1]).toBe("bins");
		}
	});
});

describe("ft uniform word packing", () => {
	it("bit-casts floats into the adam uniform", () => {
		const words = adamUniformWords(1024, 0.02, 0.9, 0.999, 1e-8, 1);
		expect(words[0]).toBe(1024);
		expect(words[3]).toBe(f32Word(0.02));
		expect(words[4]).toBe(f32Word(0.9));
		expect(words[7]).toBe(f32Word(1 - 0.999 ** 1));
		// bias correction at t=3 differs from t=1
		const t3 = adamUniformWords(1024, 0.02, 0.9, 0.999, 1e-8, 3);
		expect(t3[6]).toBe(f32Word(1 - 0.9 ** 3));
		expect(t3[6]).not.toBe(words[6]);
	});

	it("packs the histogram window", () => {
		const words = histogramUniformWords(64, -0.3, 53.333);
		expect(words[0]).toBe(64);
		expect(words[3]).toBe(f32Word(-0.3));
		expect(words[4]).toBe(f32Word(53.333));
	});
});

describe("ft op binding consistency", () => {
	// Same drift guard as the Woof GPU tests: every op must reference a
	// registered kernel and supply one buffer per declared storage binding.
	function declaredBindings(kernel: string): number {
		const matches = FT_KERNELS[kernel].matchAll(
			/@group\(0\) @binding\((\d+)\)/g,
		);
		const indices = [...matches].map((m) => Number(m[1]));
		expect(indices.length).toBeGreaterThan(0);
		expect(indices).toEqual(indices.map((v, i) => i)); // dense 0..n-1
		return indices.length;
	}

	it("every planned op matches its kernel's binding surface", () => {
		const ops = [...planStep(), ...planDiagnostics()];
		for (const op of ops) {
			const bindings = declaredBindings(op.kernel);
			expect(op.buffers.length).toBe(bindings - 1);
		}
	});

	it("every op's buffer names resolve in the buffer plan (uniforms excepted)", () => {
		const sizes = planBuffers();
		const names = new Set([...sizes.keys()].map((n) => n.replace(":u32", "")));
		const ops = [...planStep(), ...planDiagnostics()];
		for (const op of ops) {
			for (const b of op.buffers) {
				expect(names.has(b)).toBe(true);
			}
			if (op.sharedUniform) {
				expect(op.sharedUniform).toMatch(/^(adamU|histU)\./);
			}
		}
	});
});
