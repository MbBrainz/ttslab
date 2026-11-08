import { describe, expect, it } from "vitest";
import { getLoader } from "../registry";
import { loadWoofNpz, TorchRandn, WoofEngine } from "./woof";
import {
	buildWoofGpuModel,
	createWoofGpuSession,
	f32Word,
	flatDispatch,
	type GpuQLinear,
	packI8,
	planBuffers,
	planDecoder,
	planFrame,
	planPrefix,
	planSeanet,
	round16,
	type WgDevice,
	type WgQueue,
	WOOF_KERNELS,
	WoofGpuSessionImpl,
} from "./woof-gpu";

// ---------------------------------------------------------------------------
// Synthetic Woof npz — a real stored ZIP of .npy arrays with the same tree
// layout as the production weights, shrunk to d=16/H=2/L=1 so the pure
// planning functions can be exercised end to end in Node.
// ---------------------------------------------------------------------------

type NpyEntry = { descr: string; shape: number[]; data: Uint8Array };

function npyBytes(e: NpyEntry): Uint8Array {
	const dict = `{'descr': '${e.descr}', 'fortran_order': False, 'shape': (${e.shape.join(",")}), }\n`;
	const header = new TextEncoder().encode(dict);
	const out = new Uint8Array(10 + header.length + e.data.length);
	const v = new DataView(out.buffer);
	out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
	v.setUint16(8, header.length, true);
	out.set(header, 10);
	out.set(e.data, 10 + header.length);
	return out;
}

function f32(data: number[]): Uint8Array {
	return new Uint8Array(Float32Array.from(data).buffer);
}
function i8(data: number[]): Uint8Array {
	return new Uint8Array(Int8Array.from(data).buffer);
}
function utf32(s: string): Uint8Array {
	const out = new Uint8Array(s.length * 4);
	const v = new DataView(out.buffer);
	for (let i = 0; i < s.length; i++) v.setUint32(i * 4, s.charCodeAt(i), true);
	return out;
}

function u16(v: number): Uint8Array {
	const b = new Uint8Array(2);
	new DataView(b.buffer).setUint16(0, v, true);
	return b;
}
function u32(v: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, v, true);
	return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
	const len = parts.reduce((p, c) => p + c.length, 0);
	const out = new Uint8Array(len);
	let off = 0;
	for (const part of parts) {
		out.set(part, off);
		off += part.length;
	}
	return out;
}

/** Stored (uncompressed) ZIP of npy entries, matching numpy's savez layout. */
function makeNpz(entries: Map<string, NpyEntry>): ArrayBuffer {
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	const nameEnc = new TextEncoder();
	let offset = 0;
	const offsets: number[] = [];
	for (const [name, e] of entries) {
		const nameBytes = nameEnc.encode(name);
		const payload = npyBytes(e);
		offsets.push(offset);
		locals.push(
			concat([
				u32(0x04034b50),
				u16(20), // version
				u16(0), // flags
				u16(0), // method
				u16(0), // time
				u16(0), // date
				u32(payload.length), // crc (not checked by the parser)
				u32(payload.length), // compressed size
				u32(payload.length), // uncompressed size
				u16(nameBytes.length),
				u16(0), // extra
				nameBytes,
				payload,
			]),
		);
		offset += 30 + nameBytes.length + payload.length;
	}
	const cdStart = offset;
	let idx = 0;
	for (const [name, e] of entries) {
		const nameBytes = nameEnc.encode(name);
		const payloadLen = npyBytes(e).length;
		centrals.push(
			concat([
				u32(0x02014b50),
				u16(20), // version made by
				u16(20), // version needed
				u16(0), // flags
				u16(0), // method
				u16(0), // time
				u16(0), // date
				u32(0), // crc
				u32(payloadLen),
				u32(payloadLen),
				u16(nameBytes.length),
				u16(0), // extra
				u16(0), // comment
				u16(0), // disk start
				u16(0), // internal attrs
				u32(0), // external attrs
				u32(offsets[idx]),
				nameBytes,
			]),
		);
		idx++;
	}
	const cd = concat(centrals);
	const eocd = concat([
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(entries.size),
		u16(entries.size),
		u32(cd.length),
		u32(cdStart),
		u16(0),
	]);
	return concat([...locals, cd, eocd]).buffer as ArrayBuffer;
}

const D = 16;
const HW = 4;
const LATENT = 2;
const FF = 8;
const DEPTH = 1;
const Q = (rows: number, cols: number, seed: number): NpyEntry => ({
	descr: "|i1",
	shape: [rows, cols],
	data: i8(
		Array.from(
			{ length: rows * cols },
			(_, i) => ((i * 7 + seed * 13) % 61) - 30,
		),
	),
});
const S1 = (rows: number): NpyEntry => ({
	descr: "<f4",
	shape: [rows],
	data: f32(Array.from({ length: rows }, (_, i) => 0.01 * ((i % 5) + 1))),
});
const F2 = (rows: number, cols: number): NpyEntry => ({
	descr: "<f4",
	shape: [rows, cols],
	data: f32(
		Array.from({ length: rows * cols }, (_, i) => 0.02 * ((i % 7) + 1)),
	),
});

function buildTreeJson(): string {
	return JSON.stringify({
		speech: {
			cfg: {
				L: 1,
				d: D,
				H: 2,
				ff: FF,
				hw: HW,
				depth: DEPTH,
				latent: LATENT,
				rope_base: 10000,
			},
		},
		decoder: {
			cfg: { heads: 1, head_dim: 4, window: 2, eps: 1e-5 },
			tf: [{ qkv: null }],
			seanet: [
				["elu", null],
				["convt", { stride: 4 }],
				["res", null],
				["conv", null],
			],
		},
		max_frames: 12,
		fps: 12.5,
		mean: { "@": "arr.mean" },
		std: { "@": "arr.std" },
		voices: {
			juno: { "@": "arr.voice.juno" },
			mira: { "@": "arr.voice.mira" },
		},
	});
}

function syntheticNpz(): ArrayBuffer {
	const entries = new Map<string, NpyEntry>();
	// speech transformer: wqkv (3d, d), wo (d, d), w1 (2ff, d), w2 (d, ff)
	entries.set("speech.layers.0.0.q", Q(3 * D, D, 1));
	entries.set("speech.layers.0.0.s", S1(3 * D));
	entries.set("speech.layers.0.1.q", Q(D, D, 2));
	entries.set("speech.layers.0.1.s", S1(D));
	entries.set("speech.layers.0.2.q", Q(2 * FF, D, 3));
	entries.set("speech.layers.0.2.s", S1(2 * FF));
	entries.set("speech.layers.0.3.q", Q(D, FF, 4));
	entries.set("speech.layers.0.3.s", S1(D));
	// cond + ada + flow head
	entries.set("speech.ce.q", Q(HW + 1, HW, 5));
	entries.set("speech.ce.s", S1(HW + 1));
	entries.set("speech.ada.q", Q(3 * HW * (DEPTH + 1), HW, 6));
	entries.set("speech.ada.s", S1(3 * HW * (DEPTH + 1)));
	entries.set("speech.hblocks.0.0.q", Q(2 * HW, HW, 7));
	entries.set("speech.hblocks.0.0.s", S1(2 * HW));
	entries.set("speech.hblocks.0.1.q", Q(HW, HW, 8));
	entries.set("speech.hblocks.0.1.s", S1(HW));
	entries.set("speech.lat_in.w", F2(D, LATENT));
	entries.set("speech.lat_in.b", {
		descr: "<f4",
		shape: [D],
		data: f32(new Array(D).fill(0.1)),
	});
	entries.set("speech.h_inp.w", F2(HW, LATENT));
	entries.set("speech.h_inp.b", {
		descr: "<f4",
		shape: [HW],
		data: f32(new Array(HW).fill(0.1)),
	});
	entries.set("speech.h_out.w", F2(LATENT, HW));
	entries.set("speech.h_out.b", {
		descr: "<f4",
		shape: [LATENT],
		data: f32(new Array(LATENT).fill(0.1)),
	});
	entries.set("speech.text_emb", F2(95, D));
	entries.set("speech.bos", {
		descr: "<f4",
		shape: [D],
		data: f32(new Array(D).fill(0.05)),
	});
	// decoder transformer (heads=1, head_dim=4 -> D=4)
	entries.set("decoder.inp.0", F2(4, LATENT));
	entries.set("decoder.inp.1", {
		descr: "<f4",
		shape: [4],
		data: f32(new Array(4).fill(0.1)),
	});
	entries.set("decoder.inv_freq", {
		descr: "<f4",
		shape: [2],
		data: f32([1, 0.5]),
	});
	for (const part of ["ln1.0", "ln1.1", "ln2.0", "ln2.1"] as const) {
		entries.set(`decoder.tf.0.${part}`, {
			descr: "<f4",
			shape: [4],
			data: f32(new Array(4).fill(1)),
		});
	}
	const grouped = (
		name: string,
		shape: number[],
		q8Rows: number,
		q8Cols: number,
	): void => {
		entries.set(`${name}.q8`, {
			descr: "|i1",
			shape: [q8Rows, q8Cols],
			data: i8(
				Array.from({ length: q8Rows * q8Cols }, (_, i) => ((i * 5) % 41) - 20),
			),
		});
		entries.set(`${name}.s`, S1(q8Rows));
	};
	grouped("decoder.tf.0.qkv", [12, 4], 12, 4);
	grouped("decoder.tf.0.o", [4, 4], 4, 4);
	grouped("decoder.tf.0.fc1", [8, 4], 8, 4);
	grouped("decoder.tf.0.fc2", [4, 8], 4, 8);
	// SEANet: convt (cin 4 -> cout 2, k 2, stride 4), res (2ch, k 3), conv (2 -> 1, k 3)
	const groupedW = (name: string, rows: number, q8Cols: number): void => {
		entries.set(`${name}.w.q8`, {
			descr: "|i1",
			shape: [rows, q8Cols],
			data: i8(
				Array.from({ length: rows * q8Cols }, (_, i) => ((i * 3) % 31) - 15),
			),
		});
		entries.set(`${name}.w.s`, S1(rows));
		entries.set(`${name}.b`, {
			descr: "<f4",
			shape: [rows],
			data: f32(new Array(rows).fill(0.01)),
		});
	};
	groupedW("decoder.seanet.1.1", 2, 8); // (cin 4, k 2) -> flat 8
	groupedW("decoder.seanet.2.1.0", 2, 12); // (cin 2, k 3) -> flat 6, padded to 8+4
	groupedW("decoder.seanet.2.1.1", 2, 12);
	groupedW("decoder.seanet.3.1", 1, 12); // (cin 2, k 3) -> flat 6
	entries.set("arr.mean", {
		descr: "<f4",
		shape: [LATENT],
		data: f32([0.1, -0.1]),
	});
	entries.set("arr.std", {
		descr: "<f4",
		shape: [LATENT],
		data: f32([1.1, 0.9]),
	});
	entries.set("arr.voice.juno", F2(16 * D, 1));
	entries.set("arr.voice.mira", F2(16 * D, 1));
	// __tree__ — 0-d <U… array with the JSON
	const treeJson = buildTreeJson();
	entries.set("__tree__", {
		descr: `<U${treeJson.length}`,
		shape: [],
		data: utf32(treeJson),
	});
	// grouped metadata lives inside the tree (q8 refs + shape/axis/g)
	return syntheticNpzWithMeta(entries);
}

/** Rebuild the npz with grouped-int8 metadata injected into __tree__. */
function syntheticNpzWithMeta(entries: Map<string, NpyEntry>): ArrayBuffer {
	const treeJson = buildTreeJson();
	const tree = JSON.parse(treeJson) as {
		decoder: {
			tf: Array<Record<string, unknown>>;
			seanet: Array<[string, Record<string, unknown> | null]>;
		};
	};
	const metaNode = (
		shape: number[],
		axis: number,
		g: number,
		ref: string,
	): Record<string, unknown> => ({
		shape,
		axis,
		g,
		q8: { "@": ref },
		s: { "@": ref.replace(/\.q8$/, ".s") },
	});
	tree.decoder.tf[0].qkv = metaNode([12, 4], 0, 4, "decoder.tf.0.qkv.q8");
	tree.decoder.tf[0].o = metaNode([4, 4], 0, 4, "decoder.tf.0.o.q8");
	tree.decoder.tf[0].fc1 = metaNode([8, 4], 0, 4, "decoder.tf.0.fc1.q8");
	tree.decoder.tf[0].fc2 = metaNode([4, 8], 0, 4, "decoder.tf.0.fc2.q8");
	tree.decoder.seanet[1][1] = {
		stride: 4,
		w: metaNode([4, 2, 2], 1, 4, "decoder.seanet.1.1.w.q8"),
	};
	// res block: both convs nest under the op's params like the real tree
	tree.decoder.seanet[2][1] = {
		"1": {
			"0": metaNode([2, 2, 3], 0, 4, "decoder.seanet.2.1.0.w.q8"),
			"1": metaNode([2, 2, 3], 0, 4, "decoder.seanet.2.1.1.w.q8"),
		},
	};
	tree.decoder.seanet[3][1] = {
		w: metaNode([1, 2, 3], 0, 4, "decoder.seanet.3.1.w.q8"),
	};
	const finalJson = JSON.stringify(tree);
	entries.set("__tree__", {
		descr: `<U${finalJson.length}`,
		shape: [],
		data: utf32(finalJson),
	});
	return makeNpz(entries);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("woof-gpu packing helpers", () => {
	it("packs int8 rows LSB-first with zero-copy when aligned", () => {
		const src = new ArrayBuffer(16);
		const q = new Int8Array(src, 0, 8);
		q.set([-1, 2, -3, 4, 5, -6, 7, -8]);
		const { words, zeroCopy } = packI8(q);
		expect(zeroCopy).toBe(true);
		expect(words.length).toBe(2);
		expect(words[0]).toBe(
			((-1 & 0xff) |
				((2 & 0xff) << 8) |
				((-3 & 0xff) << 16) |
				((4 & 0xff) << 24)) >>>
				0,
		);
		expect(words[1]).toBe(
			((5 & 0xff) |
				((-6 & 0xff) << 8) |
				((7 & 0xff) << 16) |
				((-8 & 0xff) << 24)) >>>
				0,
		);
	});

	it("repacks unaligned views with identical words", () => {
		const src = new ArrayBuffer(16);
		const q = new Int8Array(src, 1, 8);
		q.set([-1, 2, -3, 4, 5, -6, 7, -8]);
		const { words, zeroCopy } = packI8(q);
		expect(zeroCopy).toBe(false);
		const aligned = packI8(new Int8Array(src, 4, 4));
		void aligned;
		// same bytes, just a different container offset
		const expect0 =
			((-1 & 0xff) |
				((2 & 0xff) << 8) |
				((-3 & 0xff) << 16) |
				((4 & 0xff) << 24)) >>>
			0;
		expect(words[0]).toBe(expect0);
	});

	it("bit-casts f32 uniforms", () => {
		expect(f32Word(1.0)).toBe(
			new Float32Array([1.0]).buffer.byteLength ? 0x3f800000 : 0,
		);
		expect(f32Word(-2.5)).toBe(0xc0200000);
	});

	it("rounds buffer sizes to 16 and splits dispatches", () => {
		expect(round16(1)).toBe(16);
		expect(round16(17)).toBe(32);
		expect(flatDispatch(100, 64)).toEqual([2, 1]);
		expect(flatDispatch(65535 * 64 + 1, 64)).toEqual([65535, 2]);
	});
});

describe("woof-gpu kernel registry", () => {
	it("ships 22 compute kernels with entry points", () => {
		const names = Object.keys(WOOF_KERNELS);
		expect(names.length).toBe(22);
		for (const name of names) {
			expect(WOOF_KERNELS[name]).toContain("@compute");
			expect(WOOF_KERNELS[name]).toContain("@workgroup_size");
			expect(WOOF_KERNELS[name]).toContain("fn main");
		}
	});

	it("keeps the documented kernel set", () => {
		expect(Object.keys(WOOF_KERNELS).sort()).toEqual(
			[
				"acc",
				"add",
				"affine",
				"attn",
				"attn_w",
				"cache",
				"conv",
				"convt",
				"elu",
				"framecopy",
				"gelu",
				"glu",
				"ln",
				"lnmod",
				"mm",
				"mvt",
				"muladd",
				"rmsnorm",
				"rope",
				"rope_t",
				"silu",
				"transpose",
			].sort(),
		);
	});
});

describe("woof-gpu model build from npz", () => {
	const buffer = syntheticNpz();
	const npz = loadWoofNpz(buffer);
	const model = buildWoofGpuModel(npz);

	it("parses the synthetic npz through the shared loader", () => {
		// the CPU engine loads the same bytes (sanity: both engines agree on cfg)
		const cpu = WoofEngine.load(buffer.slice(0));
		expect(cpu.fps).toBe(12.5);
		expect(model.maxFrames).toBe(12);
		expect(model.speech.d).toBe(D);
		expect(model.speech.hw).toBe(HW);
		expect(model.decoder.D).toBe(4);
	});

	it("extracts quantized speech linears with per-row scales", () => {
		const wqkv = model.speech.layers[0];
		expect(wqkv.rows).toBe(3 * D);
		expect(wqkv.cols).toBe(D);
		expect(wqkv.wq).toBe(D / 4);
		expect(wqkv.group).toBe(D); // one scale per row
		// packed word decodes to the original int8s (i8x4 semantics)
		const origData = npz.entries.get("speech.layers.0.0.q")?.data;
		if (!origData) throw new Error("fixture missing speech.layers.0.0.q");
		const b0 = origData[0];
		const b1 = origData[1];
		expect((wqkv.w[0] << 24) >> 24).toBe((b0 << 24) >> 24);
		expect((wqkv.w[0] << 16) >> 24).toBe((b1 << 24) >> 24);
	});

	it("handles grouped convT tensors padded past the logical size", () => {
		const convt = model.decoder.seanet.get("seanet.1") as GpuQLinear;
		// (cin 4, cout 2, k 2) axis 1: rows = cout = 2, flat = 8
		expect(convt.rows).toBe(2);
		expect(convt.cols).toBe(8);
		expect(convt.wq).toBe(2); // 8 stored bytes / 4
		expect(convt.group).toBe(4);
		expect(convt.groupedAxis).toBe(1);
	});

	it("derives conv tap counts from the grouped shape", () => {
		const conv = model.decoder.seanet.get("seanet.3") as GpuQLinear;
		// (cout 1, cin 2, k 3) -> flat 6, stored padded to 12
		expect(conv.rows).toBe(1);
		expect(conv.cols).toBe(6);
		const taps = conv.cols / conv.shape[1 === conv.groupedAxis ? 0 : 1];
		expect(taps).toBe(3);
	});

	it("plans the kv cache and state buffers", () => {
		const sizes = planBuffers(model, 4);
		// L*2*H*maxLen*Dh = 1*2*2*1100*8
		expect(sizes.get("kv")).toBe(2 * 2 * 1100 * 8);
		expect(sizes.get("qkv")).toBe(1100 * 3 * D);
		expect(sizes.get("pos:u32")).toBe(5);
		expect(sizes.get("noise")).toBe(4 * LATENT);
	});

	it("plans the SEANet workspace for the full frame budget", () => {
		const sn = planSeanet(model, model.maxFrames);
		// elu in place; convt (4->2, stride 4): (2, 48); res temps (2, 48);
		// final conv (2 -> 1): (1, 48)
		expect(sn.samples).toBe(48);
		expect(sn.finalBuffer).toBe("sn.3");
		expect(sn.buffers.get("sn.0")).toBe(2 * 48);
		expect(sn.buffers.get("sn.3")).toBe(1 * 48);
	});
});

describe("woof-gpu dispatch planning", () => {
	const model = buildWoofGpuModel(loadWoofNpz(syntheticNpz()));
	const p0 = 16 + 4 + 1; // voice frames + text ids + bos

	it("plans the prefix pass: 10 ops per layer plus cond", () => {
		const ops = planPrefix(model, p0);
		// L=1: rms, qkv, rope, cache, attn, wo, rms2, w1, glu, w2 = 10,
		// + rms.ce (cond() rms-normalizes its input) + ce + silu
		expect(ops.length).toBe(13);
		const qkv = ops.find((o) => o.label.endsWith(".qkv.0"));
		if (!qkv) throw new Error("no qkv op planned");
		expect(qkv.kernel).toBe("mm");
		// rows, cols, wq, group, tokens, xOff, xStride, yOff, yStride, wOff, flags
		expect(qkv.uniforms.slice(0, 5)).toEqual([3 * D, D, D / 4, D, p0]);
		expect(qkv.uniforms[8]).toBe(3 * D); // yStride
		expect(qkv.uniforms[10] & 1).toBe(1); // bias
		expect(qkv.buffers).toHaveLength(5); // w, s, x, y, bias (no pos on mm)
		expect(qkv.dispatch).toEqual([3 * D, p0, 1]);
		const wo = ops.find((o) => o.label.endsWith(".wo.0"));
		if (!wo) throw new Error("no wo op planned");
		// residual wo accumulates WITHOUT bias (CPU oracle semantics)
		expect(wo.uniforms[10]).toBe(2);
	});

	it("plans a decode frame with pos-slot indirection", () => {
		const ops = planFrame(model, 2, true);
		// rms.ce, silu.ce, ada, hinp, [lnmod, hb1, silu, hb2, muladd] x depth,
		// lnmod.fin, hout, z, latin,
		// [rms, qkv, rope, cache, attn, wo, rms2, w1, glu, w2] x L,
		// rms.ce.next, ce.next, silu.next, eoscopy, framecopy
		expect(ops.length).toBe(
			1 + 1 + 1 + 1 + 5 * DEPTH + 2 + 1 + 1 + 10 + 2 + 2 + 2,
		);
		const rope = ops.find((o) => o.label.endsWith(".rope.0"));
		if (!rope) throw new Error("no rope op planned");
		expect(rope.uniforms[4]).toBe(2); // slot
		expect(rope.uniforms[5]).toBe(1); // posMode = pos[slot]
		const framecopy = ops[ops.length - 1];
		expect(framecopy.kernel).toBe("framecopy");
		expect(framecopy.uniforms[2]).toBe(4); // baseSlot = BATCH
		// first frame of the first batch skips the leading cond (prefix did it)
		const first = planFrame(model, 0, false);
		expect(first.length).toBe(ops.length - 3);
	});

	it("plans the decoder transformer + SEANet chain", () => {
		const frames = 12;
		const ops = planDecoder(model, frames);
		// affine, inp, [ln, qkv, rope, attn, o, ln2, fc1, gelu, fc2] x 2,
		// transpose, elu, convt, res(a, elu, b, add), conv
		expect(ops.length).toBe(
			2 + 9 * model.decoder.tf.length + 1 + 1 + 1 + 4 + 1,
		);
		const sn = planSeanet(model, frames);
		expect(sn.samples).toBe(frames * 4);
		const convt = ops.find((o) => o.kernel === "convt");
		if (!convt) throw new Error("no convt op planned");
		// cin, cout, k, stride, tin, wq, group, flags
		expect(convt.uniforms.slice(0, 4)).toEqual([4, 2, 2, 4]);
		expect(convt.uniforms[10 - 3]).toBe(1); // bias flag
	});
});

describe("seed determinism contract", () => {
	it("snapshot/restore keeps the torch-compatible stream byte-exact", () => {
		const a = new TorchRandn();
		a.seed(42);
		const snap0 = a.snapshot(); // freshly seeded state
		const first = a.randn(32);
		const second = a.randn(32);
		// restore to the seed: both draws replay byte-exact
		a.restore(snap0);
		expect(a.randn(32)).toEqual(first);
		expect(a.randn(32)).toEqual(second);
		// mid-stream snapshot: resume reproduces the next draw
		const snap1 = a.snapshot();
		const third = a.randn(32);
		a.restore(snap1);
		expect(a.randn(32)).toEqual(third);
		// a fresh stream with the same seed produces the same values
		const b = new TorchRandn();
		b.seed(42);
		expect(b.randn(32)).toEqual(first);
	});

	it("partial-batch redraw reproduces the CPU stream position", () => {
		// simulate the session's EOS-overshoot rollback: draw 4, EOS after 2,
		// restore + redraw 2 — must equal drawing exactly 2 from scratch.
		const gpu = new TorchRandn();
		gpu.seed(7);
		const snap = gpu.snapshot();
		const drawn = [gpu.randn(2), gpu.randn(2), gpu.randn(2), gpu.randn(2)];
		void drawn;
		gpu.restore(snap);
		gpu.randn(2);
		gpu.randn(2);
		const cpu = new TorchRandn();
		cpu.seed(7);
		const c1 = cpu.randn(2);
		const c2 = cpu.randn(2);
		expect(gpu.randn(2)).toEqual(cpu.randn(2));
		void c1;
		void c2;
	});
});

describe("woof-gpu kernel/op binding consistency", () => {
	// Every kernel declares @group(0) @binding(0) as its uniform and one
	// binding per op buffer; this catches WGSL/buffer-list drift at test time
	// (the real validation otherwise only happens in a browser).
	function declaredBindings(kernel: string): number {
		const matches = WOOF_KERNELS[kernel].matchAll(
			/@group\(0\) @binding\((\d+)\)/g,
		);
		const indices = [...matches].map((m) => Number(m[1]));
		expect(indices.length).toBeGreaterThan(0);
		expect(indices).toEqual(indices.map((v, i) => i)); // dense 0..n-1
		return indices.length;
	}

	it("every planned op matches its kernel's binding surface", () => {
		const model = buildWoofGpuModel(loadWoofNpz(syntheticNpz()));
		const ops = [
			...planPrefix(model, 21),
			...planFrame(model, 0, false),
			...planFrame(model, 3, true),
			...planDecoder(model, 12),
		];
		for (const op of ops) {
			const bindings = declaredBindings(op.kernel);
			expect(op.buffers.length).toBe(bindings - 1);
		}
	});

	it("every op's buffer names resolve in the buffer plan", () => {
		const model = buildWoofGpuModel(loadWoofNpz(syntheticNpz()));
		const sizes = planBuffers(model, 4);
		const sn = planSeanet(model, model.maxFrames);
		for (const [k, v] of sn.buffers) sizes.set(k, v);
		const names = new Set([...sizes.keys()].map((n) => n.replace(":u32", "")));
		names.add("zeros1");
		const ops = [
			...planPrefix(model, 21),
			...planFrame(model, 1, true),
			...planDecoder(model, 12),
		];
		for (const op of ops) {
			for (const b of op.buffers) {
				expect(names.has(b)).toBe(true);
			}
		}
	});
});

describe("woof-gpu session with a mocked device", () => {
	function makeMockDevice() {
		const created: Array<{ label?: string; size: number; usage: number }> = [];
		const written: Array<{ label?: string; bytes: number }> = [];
		const bindGroups: Array<{ label?: string; entries: number }> = [];
		const queue: WgQueue = {
			writeBuffer: (buffer, _off, data) => {
				written.push({
					label: buffer.label,
					bytes: (data as Float32Array).byteLength ?? 0,
				});
			},
			submit: () => 0,
		};
		const device: WgDevice = {
			limits: {
				maxBufferSize: 1 << 30,
				maxStorageBufferBindingSize: 1 << 30,
				maxComputeWorkgroupStorageSize: 16384,
			},
			queue,
			createBuffer: (d) => {
				created.push({ label: d.label, size: d.size, usage: d.usage });
				const size = d.size;
				return {
					size,
					label: d.label,
					mapAsync: async () => {},
					getMappedRange: () => new ArrayBuffer(size),
					unmap: () => {},
					destroy: () => {},
				};
			},
			createShaderModule: () => ({}),
			createComputePipeline: () => ({
				getBindGroupLayout: () => ({}),
			}),
			createComputePipelineAsync: async () => ({
				getBindGroupLayout: () => ({}),
			}),
			createBindGroup: (d) => {
				bindGroups.push({ label: d.label, entries: d.entries.length });
				return {};
			},
			createCommandEncoder: () => {
				throw new Error("not expected in planning tests");
			},
			destroy: () => {},
		};
		return { device, created, written, bindGroups };
	}

	it("creates state buffers with 16-aligned sizes and uploads packed weights", () => {
		const model = buildWoofGpuModel(loadWoofNpz(syntheticNpz()));
		const { device, created, written } = makeMockDevice();
		const session = new WoofGpuSessionImpl(device, model, { vendor: "mock" });
		const internal = session as unknown as {
			checkLimits(): void;
			createBuffers(): void;
			uploadWeights(): void;
		};
		internal.checkLimits();
		internal.createBuffers();
		internal.uploadWeights();
		const kv = created.find((b) => b.label === "kv");
		if (!kv) throw new Error("kv buffer not created");
		expect(kv.size).toBe(round16(2 * 2 * 1100 * 8 * 4));
		const pos = created.find((b) => b.label === "pos");
		if (!pos) throw new Error("pos buffer not created");
		expect(pos.size).toBe(round16(5 * 4));
		// weight upload touched the packed q8 of the first layer linear
		const wqkvWrite = written.find((w) => w.label === "w.speech.layers.0.0");
		if (!wqkvWrite) throw new Error("wqkv not uploaded");
		expect(wqkvWrite.bytes).toBe(((3 * D * D) / 4) * 4);
	});

	it("materializes op descriptors into cached pipelines + bind groups", () => {
		const model = buildWoofGpuModel(loadWoofNpz(syntheticNpz()));
		const { device, bindGroups } = makeMockDevice();
		const session = new WoofGpuSessionImpl(device, model, {});
		const internal = session as unknown as {
			createBuffers(): void;
			uploadWeights(): void;
			materialize(op: {
				label: string;
				kernel: string;
				uniforms: number[];
				buffers: string[];
				dispatch: [number, number, number];
			}): { dispatch: [number, number, number] };
		};
		internal.createBuffers();
		internal.uploadWeights();
		const ops = planPrefix(model, 21);
		const mat = internal.materialize(ops[0]);
		expect(mat.dispatch).toEqual(ops[0].dispatch);
		// uniform + kernel bindings
		expect(bindGroups[0].entries).toBe(ops[0].buffers.length + 1);
		// cached second time (no new bind group)
		internal.materialize(ops[0]);
		expect(bindGroups).toHaveLength(1);
	});

	it("exposes adapter info and the kernel count", () => {
		const model = buildWoofGpuModel(loadWoofNpz(syntheticNpz()));
		const { device } = makeMockDevice();
		const session = new WoofGpuSessionImpl(device, model, {
			vendor: "test-vendor",
			architecture: "test-arch",
		});
		expect(session.backend).toBe("webgpu");
		expect(session.kernelCount).toBe(22);
		expect(session.adapterInfo.vendor).toBe("test-vendor");
	});
});

describe("woof-gpu fallback selection", () => {
	it("returns null without navigator.gpu (CI/Node)", async () => {
		const session = await createWoofGpuSession(syntheticNpz());
		expect(session).toBeNull();
	});

	it("registers the woof loader as webgpu+wasm with auto preference", async () => {
		const loader = await getLoader("woof-tts");
		expect(loader?.getSupportedBackends()).toEqual(["webgpu", "wasm"]);
		expect(loader?.getPreferredBackend?.()).toBe("auto");
		// synthesize before load must throw (backend not silently chosen yet)
		await expect(loader?.synthesize?.("hi", "juno")).rejects.toThrow(
			/Model not loaded/,
		);
	});
});
