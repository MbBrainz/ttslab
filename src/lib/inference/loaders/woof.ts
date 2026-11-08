import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";
import type { WoofGpuSession } from "./woof-gpu";

/**
 * Underdog Woof (30.7M/38.2M params, 40.6 MB) — the second-smallest download
 * in the lab, and the only model here that ships NO runtime: no ONNX, no
 * transformers.js, no WASM engine. The Hugging Face repo
 * (ConwayResearch/Underdog-Woof) is a single uncompressed `.npz` of numpy
 * arrays plus a ~380-line numpy reference implementation
 * (`underdog_woof/runtime.py`). This loader is a hand-written TypeScript port
 * of that runtime: every matmul is a plain typed-array loop running on the
 * existing WASM-class backend of the inference worker, with zero native code.
 *
 * Pipeline (one pass per text piece, 24 kHz mono out):
 *
 *   1. Char-level encode (91-char vocab; ids = char index + 3; 1 = BOS).
 *   2. Speech model — an 8-layer, d=448, 7-head RoPE transformer. It reads the
 *      prefix [voice (16 frames), text embeddings, BOS] once, then decodes
 *      32-dim audio latents frame by frame at 25 fps: each frame is noise
 *      (drawn from a torch-compatible MT19937 + Box-Muller, so a seed gives
 *      the same audio everywhere) plus a one-step flow-head prediction,
 *      conditioned on a running context vector; an EOS logit ends the loop.
 *   3. Audio decoder — adapted from Kyutai's Mimi: a 2-layer sliding-window
 *      (250) transformer, then a SEANet stack (strided conv-transpose 8/6/5/4
 *      with residual convs) upscaling 25 Hz latents to 24 kHz waveform.
 *
 * Intentional deviations from the reference (`Woof.__call__`):
 *   - No take-retry/stall-rejection loop (single take per piece).
 *   - The number/date/money text normalizer (`normalize.py`, ~48 KB of rules)
 *     and the respelling lexicon are NOT ported — text is passed through as
 *     written. The model was trained on normalized text, so spelled-out
 *     numbers ("twenty-five dollars") sound right while digits, dates and
 *     prices may be read oddly. This is the main quality gap to close later.
 *   - Sentence/clause splitting (textsplit.py) IS ported, because the speech
 *     model caps at 750 frames (30 s) and long sentences must be broken up.
 *
 * Backends: this file is the WASM-class typed-array path (numerically exact
 * vs the numpy reference). The WebGPU path lives in `woof-gpu.ts` — a
 * hand-written WGSL kernel set of 22 kernels over the raw WebGPU API
 * (browser-verified 2026-11-08 vs this CPU path: Pearson corr 0.9999998,
 * ~6.1 s CPU vs ~0.19 s GPU per sentence). Its kernel decomposition (which
 * ops became kernels, weights kept int8-packed on the GPU and dequantized
 * inside the matmul/conv kernels, positions passed via a storage buffer so
 * dispatch plans can be cached, frames stepped in small batches with one EOS
 * readback per batch) follows the structure of Underdog's own browser bundle
 * (underdog.ai/woof, chunks SayIt/woof/decoder, 19 WGSL kernels), studied as
 * reference; all WGSL and TypeScript there is our own implementation. Seed
 * parity is exact across backends:
 * noise is drawn on the CPU from the same torch-compatible MT19937 stream
 * and uploaded, so identical text+voice+seed produce identical audio on both.
 *
 * License: Underdog Non-Commercial License 1.0 (weights AND code). Free for
 * non-commercial use with credit ("Voice by Underdog Woof"); commercial use
 * needs a license from Underdog (license@conway.tech). This port is a
 * derivative of the model's code and inherits those terms.
 */

const MODEL_ID = "ConwayResearch/Underdog-Woof";
export const WEIGHTS_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/woof_int8.npz`;
export const SAMPLE_RATE = 24000;

export const VOICES: Voice[] = [
	{ id: "juno", name: "Juno" },
	{ id: "mira", name: "Mira" },
];
export const DEFAULT_VOICE = "juno";

/** Generation params — the reference Woof() defaults. */
export const TEMP = 0.5;
export const EOS_THRESHOLD = 0.9;
/** Reference Woof() default: at most 0.095 s of audio per input character. */
export const MIN_SECONDS_PER_CHAR = 0.095;

// ---------------------------------------------------------------------------
// Text encoding (runtime.py CHARS/VOCAB/encode_text)
// ---------------------------------------------------------------------------

const CHARS = [
	..." abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:'\"-()&/%$€£@#+=*_<>[]",
	"…",
	"—",
];
const VOCAB = new Map<string, number>(CHARS.map((c, i) => [c, i + 3]));

export function encodeText(s: string): number[] {
	return [1, ...[...s].map((c) => VOCAB.get(c) ?? 2)];
}

// ---------------------------------------------------------------------------
// Sentence / clause splitting — port of textsplit.py (default settings; the
// env-tunable first-utterance split is off upstream and not ported).
// ---------------------------------------------------------------------------

const CLAUSE_MAX = 120;
// Note: the reference's env-tunable FIRST_MAX/_split_first first-utterance
// split is off upstream and not ported, so no FIRST_MIN constant either.
const MIN_PIECE = 30;

function splitAtConjunction(s: string, clauseMax: number): string[] {
	if (s.length <= clauseMax) return [s];
	const candidates: number[] = [];
	for (const m of s.matchAll(
		/\s(?=and\b|but\b|or\b|nor\b|that\b|which\b|who\b|whom\b|whose\b|when\b|where\b|while\b|because\b|although\b|though\b|so\b|if\b|as\b|than\b|until\b)/g,
	)) {
		const c = m.index;
		if (c >= MIN_PIECE && s.length - c >= MIN_PIECE) candidates.push(c);
	}
	if (candidates.length === 0) return [s];
	const c = candidates.reduce((best, cur) =>
		Math.abs(cur - s.length / 2) < Math.abs(best - s.length / 2) ? cur : best,
	);
	return [
		...splitAtConjunction(s.slice(0, c).trim(), clauseMax),
		...splitAtConjunction(s.slice(c).trim(), clauseMax),
	];
}

export function splitWoofText(text: string): string[] {
	const out: string[] = [];
	for (const sentence of text.trim().split(/(?<=[.!?…])\s+/)) {
		if (!sentence) continue;
		if (sentence.length <= CLAUSE_MAX) {
			out.push(sentence);
			continue;
		}
		const clauses = sentence
			.split(/(?<=[,;:])\s+|(?<=—)\s*|(?<=--)\s*/g)
			.filter((c) => c.length > 0);
		const merged: string[] = [];
		let cur = "";
		for (const c of clauses) {
			if (cur && cur.length + 1 + c.length > CLAUSE_MAX) {
				merged.push(cur);
				cur = c;
			} else {
				cur = !cur
					? c
					: cur.endsWith("—") || cur.endsWith("--")
						? cur + c
						: `${cur} ${c}`;
			}
		}
		if (cur) merged.push(cur);
		for (const piece of merged) {
			out.push(...splitAtConjunction(piece, CLAUSE_MAX));
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// NPZ / NPY parsing. numpy's savez() writes an uncompressed zip of .npy files;
// this repo's weights are verified ZIP_STORED, so no inflate is needed.
// ---------------------------------------------------------------------------

export interface NpyArray {
	descr: string;
	shape: number[];
	data: Uint8Array;
}

export function parseWoofNpz(buffer: ArrayBuffer): Map<string, NpyArray> {
	const view = new DataView(buffer);
	const size = buffer.byteLength;
	let eocd = -1;
	for (let i = size - 22; i >= Math.max(0, size - 65557); i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("Woof weights: not a ZIP/NPZ container");
	const count = view.getUint16(eocd + 10, true);
	let ptr = view.getUint32(eocd + 16, true);
	const entries = new Map<string, NpyArray>();
	const nameBytes = new Uint8Array(256);
	for (let n = 0; n < count; n++) {
		if (view.getUint32(ptr, true) !== 0x02014b50) {
			throw new Error("Woof weights: corrupt zip central directory");
		}
		const method = view.getUint16(ptr + 10, true);
		const compressedSize = view.getUint32(ptr + 20, true);
		const nameLen = view.getUint16(ptr + 28, true);
		const extraLen = view.getUint16(ptr + 30, true);
		const commentLen = view.getUint16(ptr + 32, true);
		const localOffset = view.getUint32(ptr + 42, true);
		if (nameLen > nameBytes.length) {
			throw new Error("Woof weights: zip entry name too long");
		}
		for (let i = 0; i < nameLen; i++)
			nameBytes[i] = view.getUint8(ptr + 46 + i);
		const name = String.fromCharCode(...nameBytes.subarray(0, nameLen));
		if (method !== 0) {
			throw new Error(
				`Woof weights: zip entry ${name} is compressed (method ${method}); only stored NPZ files are supported`,
			);
		}
		if (view.getUint32(localOffset, true) !== 0x04034b50) {
			throw new Error(`Woof weights: corrupt zip local header for ${name}`);
		}
		const lNameLen = view.getUint16(localOffset + 26, true);
		const lExtraLen = view.getUint16(localOffset + 28, true);
		const dataStart = localOffset + 30 + lNameLen + lExtraLen;
		// Key by the array name with the .npy suffix stripped (runtime.py's
		// npz[k] addressing, e.g. "speech.layers.0.0.q").
		const key = name.endsWith(".npy") ? name.slice(0, -4) : name;
		entries.set(key, {
			descr: "",
			shape: [],
			data: new Uint8Array(buffer, dataStart, compressedSize),
		});
		ptr += 46 + nameLen + extraLen + commentLen;
	}
	// Parse each .npy member in place: header fields + zero-copy payload view.
	for (const entry of entries.values()) {
		const bytes = entry.data;
		if (
			bytes[0] !== 0x93 ||
			bytes[1] !== 0x4e ||
			bytes[2] !== 0x55 ||
			bytes[3] !== 0x4d ||
			bytes[4] !== 0x50 ||
			bytes[5] !== 0x59
		) {
			throw new Error("Woof weights: zip entry is not a .npy array");
		}
		const major = bytes[6];
		let hlen: number;
		let off: number;
		if (major === 1) {
			hlen = bytes[8] | (bytes[9] << 8);
			off = 10;
		} else {
			hlen = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
			off = 12;
		}
		let header = "";
		for (let i = 0; i < hlen; i++)
			header += String.fromCharCode(bytes[off + i]);
		const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
		const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1];
		const shapeMatch = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1];
		if (!descr || fortran !== "False" || shapeMatch === undefined) {
			throw new Error("Woof weights: unsupported .npy header");
		}
		entry.descr = descr;
		entry.shape = shapeMatch
			.split(",")
			.map((p) => p.trim())
			.filter((p) => p.length > 0)
			.map(Number);
		entry.data = bytes.subarray(off + hlen);
	}
	return entries;
}

export function npyF32(a: NpyArray): Float32Array {
	const n = a.shape.reduce((p, c) => p * c, 1);
	const view = new DataView(
		a.data.buffer,
		a.data.byteOffset,
		a.data.byteLength,
	);
	if (a.descr === "<f4") {
		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
		return out;
	}
	if (a.descr === "<f2") {
		// IEEE 754 half precision, decoded manually (JS has no Float16 yet).
		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const half = view.getUint16(i * 2, true);
			const sign = (half & 0x8000) >>> 15;
			const exp = (half & 0x7c00) >>> 10;
			const frac = half & 0x03ff;
			let value: number;
			if (exp === 0) {
				value = frac * 2 ** -24;
			} else if (exp === 31) {
				value = frac === 0 ? Number.POSITIVE_INFINITY : Number.NaN;
			} else {
				value = (1 + frac / 1024) * 2 ** (exp - 15);
			}
			out[i] = sign ? -value : value;
		}
		return out;
	}
	throw new Error(`Woof weights: unsupported dtype ${a.descr}`);
}

export function npyI8(a: NpyArray): Int8Array {
	if (a.descr !== "|i1") {
		throw new Error(`Woof weights: expected int8, got ${a.descr}`);
	}
	return new Int8Array(a.data.buffer, a.data.byteOffset, a.data.length);
}

/** Decode a 0-d <U… npy array (UTF-32LE codepoints) — used for __tree__ JSON. */
function npyUtf32String(a: NpyArray): string {
	const n = Math.floor(a.data.byteLength / 4);
	const view = new DataView(
		a.data.buffer,
		a.data.byteOffset,
		a.data.byteLength,
	);
	const codes = new Uint32Array(Math.min(n, 8192));
	let s = "";
	for (let start = 0; start < n; start += codes.length) {
		const len = Math.min(codes.length, n - start);
		for (let i = 0; i < len; i++) {
			codes[i] = view.getUint32((start + i) * 4, true);
		}
		s += String.fromCharCode(...codes.subarray(0, len));
	}
	return s.replace(/\0+$/, "");
}

// ---------------------------------------------------------------------------
// Weight access: speech linears are per-row int8 (q, s, optional b); decoder
// tensors are fp16 or grouped int8. Dequantized to fp32 at load.
// ---------------------------------------------------------------------------

export interface QLinear {
	q: Int8Array; // (out, in) row-major
	s: Float32Array; // (out,)
	b: Float32Array | null;
	out: number;
	in: number;
}

export function qLinear(entries: Map<string, NpyArray>, base: string): QLinear {
	const qEntry = entries.get(`${base}.q`);
	const sEntry = entries.get(`${base}.s`);
	if (!qEntry || !sEntry) throw new Error(`Woof weights: missing ${base}.q/.s`);
	const bEntry = entries.get(`${base}.b`);
	return {
		q: npyI8(qEntry),
		s: npyF32(sEntry),
		b: bEntry ? npyF32(bEntry) : null,
		out: qEntry.shape[0],
		in: qEntry.shape[1],
	};
}

export interface WLinear {
	w: Float32Array; // (out, in) row-major
	b: Float32Array;
}

export function wLinear(entries: Map<string, NpyArray>, base: string): WLinear {
	const wEntry = entries.get(`${base}.w`);
	const bEntry = entries.get(`${base}.b`);
	if (!wEntry || !bEntry) throw new Error(`Woof weights: missing ${base}.w/.b`);
	return { w: npyF32(wEntry), b: npyF32(bEntry) };
}

/** Metadata for grouped-int8 tensors, collected from the __tree__ JSON. */
export interface GroupMeta {
	shape: number[];
	axis: number;
	g: number;
}

/**
 * Grouped-int8 decode (runtime.py deq()): q8 is (rows, n) with columns padded
 * to ng*g; per-group scales s (rows, ng) apply along the flattened non-axis
 * dims. Returns fp32 laid out row-major as `shape` (only axis 0 and 1 occur).
 */
function deqGrouped(
	q8: Int8Array,
	q8Cols: number,
	s: Float32Array,
	meta: GroupMeta,
): Float32Array {
	const rows = meta.shape[meta.axis];
	const ng = s.length / rows;
	const g = meta.g;
	const total = ng * g;
	// Dequantize to a row-major (rows, total) matrix; columns beyond q8Cols
	// are zero padding up to the group boundary.
	const m = new Float32Array(rows * total);
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < q8Cols; c++) {
			m[r * total + c] = q8[r * q8Cols + c] * s[r * ng + ((c / g) | 0)];
		}
	}
	const size = meta.shape.reduce((p, c) => p * c, 1);
	const out = new Float32Array(size);
	if (meta.axis === 0) {
		// Repack to compact rows: trailing padded columns are dropped.
		const rest = size / rows;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < rest; c++) out[r * rest + c] = m[r * total + c];
		}
		return out;
	}
	// axis 1 with a 3-D shape (d0, d1, d2): m rows are (d0, d2) tiles with
	// stride `total`; moveaxis puts them back as (d0, d1, d2).
	const [d0, d1, d2] = meta.shape;
	for (let i = 0; i < d1; i++) {
		for (let j = 0; j < d0; j++) {
			for (let k = 0; k < d2; k++) {
				out[(j * d1 + i) * d2 + k] = m[i * total + j * d2 + k];
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// torch-compatible RNG (runtime.py TorchRandn): MT19937 with init_genrand
// seeding, 24-bit uniforms, Box-Muller in blocks of 16 (8 cos, 8 sin pairs).
// ---------------------------------------------------------------------------

export class TorchRandn {
	private mt = new Uint32Array(624);
	private idx = 625;

	constructor() {
		this.seed(0);
	}

	seed(s: number): void {
		this.mt[0] = s >>> 0;
		for (let i = 1; i < 624; i++) {
			const prev = this.mt[i - 1];
			this.mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
		}
		this.idx = 624;
	}

	/** Capture the full generator state — used by the WebGPU path to roll the
	 * stream back when a batched decode overshoots EOS (so the GPU stream
	 * position stays identical to the CPU path's). */
	snapshot(): TorchRandnSnapshot {
		return { mt: this.mt.slice(), idx: this.idx };
	}

	restore(s: TorchRandnSnapshot): void {
		this.mt.set(s.mt);
		this.idx = s.idx;
	}

	private nextUint32(): number {
		if (this.idx >= 624) {
			const mt = this.mt;
			for (let i = 0; i < 624; i++) {
				const y = (mt[i] & 0x80000000) | (mt[(i + 1) % 624] & 0x7fffffff);
				let v = (mt[(i + 397) % 624] ^ (y >>> 1)) >>> 0;
				if ((y & 1) !== 0) v = (v ^ 0x9908b0df) >>> 0;
				mt[i] = v;
			}
			this.idx = 0;
		}
		let y = this.mt[this.idx++];
		y = (y ^ (y >>> 11)) >>> 0;
		y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
		y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
		y = (y ^ (y >>> 18)) >>> 0;
		return y;
	}

	/** randn(n) matching torch.manual_seed(seed) + torch.randn(n) in float32. */
	randn(n: number): Float32Array {
		const u = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			u[i] = (this.nextUint32() & 0xffffff) * 2.0 ** -24;
		}
		const out = new Float32Array(n);
		const TWO_PI = 2.0 * Math.PI;
		for (let base = 0; base + 16 <= n; base += 16) {
			for (let k = 0; k < 8; k++) {
				const r = Math.sqrt(-2.0 * Math.log(1.0 - u[base + k]));
				const th = TWO_PI * u[base + 8 + k];
				out[base + k] = r * Math.cos(th);
				out[base + 8 + k] = r * Math.sin(th);
			}
		}
		return out;
	}
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

/** float32 machine epsilon — the speech model's RMS-norm epsilon. */
export const F32_EPS = 1.1920929e-7;

/** Opaque snapshot of the MT19937 stream (see TorchRandn.snapshot). */
export interface TorchRandnSnapshot {
	mt: Uint32Array;
	idx: number;
}

function silu(x: Float32Array, n: number = x.length): void {
	for (let i = 0; i < n; i++) x[i] = x[i] / (1 + Math.exp(-x[i]));
}

function erf32(x: number): number {
	// Abramowitz-Stegun 7.1.26 (the same approximation the numpy runtime uses).
	const a = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * a);
	const poly =
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
			t +
			0.254829592) *
		t;
	const y = 1 - poly * Math.exp(-a * a);
	return x < 0 ? -y : y;
}

function gelu(x: Float32Array): void {
	for (let i = 0; i < x.length; i++) {
		x[i] = 0.5 * x[i] * (1 + erf32(x[i] * Math.SQRT1_2));
	}
}

function elu(x: Float32Array): void {
	for (let i = 0; i < x.length; i++) {
		if (x[i] < 0) x[i] = Math.expm1(x[i]);
	}
}

/** RMS-norm scale (no gain): 1 / sqrt(mean(x^2) + eps). */
function rmsScale(
	x: Float32Array,
	offset: number,
	len: number,
	eps: number,
): number {
	let sum = 0;
	for (let i = 0; i < len; i++) sum += x[offset + i] * x[offset + i];
	return 1 / Math.sqrt(sum / len + eps);
}

/** Mean-subtracted layer norm in place, no gain (runtime.py _layer_norm). */
function layerNormInPlace(h: Float32Array): void {
	let mean = 0;
	for (let i = 0; i < h.length; i++) mean += h[i];
	mean /= h.length;
	let varSum = 0;
	for (let i = 0; i < h.length; i++) {
		h[i] -= mean;
		varSum += h[i] * h[i];
	}
	const inv = 1 / Math.sqrt(varSum / h.length + 1e-5);
	for (let i = 0; i < h.length; i++) h[i] *= inv;
}

/** out (rows, W.out) = x (rows, W.in) @ qᵀ with per-row scale and bias. */
function gemvQRows(
	out: Float32Array,
	W: QLinear,
	x: Float32Array,
	rows: number,
): void {
	const { q, s, b, out: outDim, in: inDim } = W;
	for (let t = 0; t < rows; t++) {
		const xb = t * inDim;
		const ob = t * outDim;
		for (let o = 0; o < outDim; o++) {
			let acc = 0;
			const qb = o * inDim;
			for (let j = 0; j < inDim; j++) acc += q[qb + j] * x[xb + j];
			out[ob + o] = acc * s[o] + (b ? b[o] : 0);
		}
	}
}

/** Single-row int8 gemv: out = (x @ qᵀ) * s + b. */
function gemvQ(out: Float32Array, W: QLinear, x: Float32Array): void {
	const { q, s, b, out: outDim, in: inDim } = W;
	for (let o = 0; o < outDim; o++) {
		let acc = 0;
		const qb = o * inDim;
		for (let j = 0; j < inDim; j++) acc += q[qb + j] * x[j];
		out[o] = acc * s[o] + (b ? b[o] : 0);
	}
}

/** Single-row fp32 gemv with bias: out = x @ wᵀ + b (w is (out,in)). */
function gemvF(
	out: Float32Array,
	w: Float32Array,
	b: Float32Array,
	x: Float32Array,
): void {
	const outDim = b.length;
	const inDim = x.length;
	for (let o = 0; o < outDim; o++) {
		let acc = 0;
		const wb = o * inDim;
		for (let j = 0; j < inDim; j++) acc += w[wb + j] * x[j];
		out[o] = acc + b[o];
	}
}

// ---------------------------------------------------------------------------
// Speech model (runtime.py Speech): prefix pass + per-frame flow decoding
// ---------------------------------------------------------------------------

export interface SpeechCfg {
	L: number;
	d: number;
	H: number;
	ff: number;
	hw: number;
	depth: number;
	latent: number;
	rope_base: number;
}

class SpeechModel {
	readonly cfg: SpeechCfg;
	readonly Dh: number;
	readonly maxLen = 1100;
	readonly layers: QLinear[]; // 4 per layer: wqkv, wo, w1, w2
	readonly ce: QLinear;
	readonly ada: QLinear;
	readonly hblocks: QLinear[]; // 2 per depth level: w1, w2
	readonly latIn: WLinear;
	readonly hInp: WLinear;
	readonly hOut: WLinear;
	readonly textEmb: Float32Array; // (95, d)
	readonly bos: Float32Array; // (d,)
	readonly cos: Float32Array; // (maxLen, Dh)
	readonly sin: Float32Array; // (maxLen, Dh), signed [-sn, sn]
	readonly kv: Float32Array; // (L, 2, H, maxLen, Dh)
	readonly scale: number;

	constructor(cfg: SpeechCfg, entries: Map<string, NpyArray>) {
		this.cfg = cfg;
		this.Dh = cfg.d / cfg.H;
		this.layers = [];
		for (let l = 0; l < cfg.L; l++) {
			for (let k = 0; k < 4; k++) {
				this.layers.push(qLinear(entries, `speech.layers.${l}.${k}`));
			}
		}
		this.ce = qLinear(entries, "speech.ce");
		this.ada = qLinear(entries, "speech.ada");
		this.hblocks = [];
		for (let j = 0; j < cfg.depth; j++) {
			for (let k = 0; k < 2; k++) {
				this.hblocks.push(qLinear(entries, `speech.hblocks.${j}.${k}`));
			}
		}
		this.latIn = wLinear(entries, "speech.lat_in");
		this.hInp = wLinear(entries, "speech.h_inp");
		this.hOut = wLinear(entries, "speech.h_out");
		const te = entries.get("speech.text_emb");
		const bo = entries.get("speech.bos");
		if (!te || !bo) throw new Error("Woof weights: missing text_emb/bos");
		this.textEmb = npyF32(te);
		this.bos = npyF32(bo);
		// RoPE tables: ang[t][k] = t / ropeBase^(2k/Dh); the runtime bakes the
		// sign into the sin table ([-sn, sn]) so the rotation is rotateHalf(+).
		const Dh = this.Dh;
		this.cos = new Float32Array(this.maxLen * Dh);
		this.sin = new Float32Array(this.maxLen * Dh);
		for (let t = 0; t < this.maxLen; t++) {
			for (let k = 0; k < Dh / 2; k++) {
				const ang = t * (1 / cfg.rope_base ** ((2 * k) / Dh));
				const cs = Math.cos(ang);
				const sn = Math.sin(ang);
				this.cos[t * Dh + k] = cs;
				this.cos[t * Dh + k + Dh / 2] = cs;
				this.sin[t * Dh + k] = -sn;
				this.sin[t * Dh + k + Dh / 2] = sn;
			}
		}
		this.kv = new Float32Array(cfg.L * 2 * cfg.H * this.maxLen * Dh);
		this.scale = Dh ** -0.5;
	}

	private layer(l: number): [QLinear, QLinear, QLinear, QLinear] {
		return [
			this.layers[l * 4],
			this.layers[l * 4 + 1],
			this.layers[l * 4 + 2],
			this.layers[l * 4 + 3],
		];
	}

	/** RoPE: dst = src rotated at absolute position pos (Dh lanes). The sin
	 * table is signed ([-sn, sn]), matching the runtime's rotateHalf(+). */
	private rotaryInto(
		dst: Float32Array,
		src: Float32Array,
		srcOff: number,
		pos: number,
	): void {
		const { Dh, cos, sin } = this;
		const half = Dh / 2;
		const cb = pos * Dh;
		for (let i = 0; i < half; i++) {
			const x1 = src[srcOff + i];
			const x2 = src[srcOff + i + half];
			dst[i] = x1 * cos[cb + i] + x2 * sin[cb + i];
			dst[i + half] = x2 * cos[cb + i + half] + x1 * sin[cb + i + half];
		}
	}

	/** Teacher-forced pass over [voice | text | bos], filling the KV cache. */
	private prefixBlock(l: number, x: Float32Array, rows: number): void {
		const { d, H, ff } = this.cfg;
		const { Dh, kv, scale, maxLen } = this;
		const [wqkv, wo, w1, w2] = this.layer(l);
		const xn = new Float32Array(rows * d);
		for (let t = 0; t < rows; t++) {
			const inv = rmsScale(x, t * d, d, F32_EPS);
			for (let i = 0; i < d; i++) xn[t * d + i] = x[t * d + i] * inv;
		}
		const qkv = new Float32Array(rows * 3 * d);
		gemvQRows(qkv, wqkv, xn, rows);
		const kCacheLayer = l * 2 * H * maxLen * Dh;
		const vCacheLayer = (l * 2 + 1) * H * maxLen * Dh;
		const qRot = new Float32Array(Dh);
		const kRot = new Float32Array(Dh);
		const scores = new Float32Array(rows);
		const attRow = new Float32Array(d);
		const attOut = new Float32Array(Dh);
		for (let t = 0; t < rows; t++) {
			attRow.fill(0);
			for (let h = 0; h < H; h++) {
				const base = t * 3 * d + h * Dh;
				this.rotaryInto(qRot, qkv, base, t);
				this.rotaryInto(kRot, qkv, base + d, t);
				const kCache = kCacheLayer + h * maxLen * Dh;
				const vCache = vCacheLayer + h * maxLen * Dh;
				for (let i = 0; i < Dh; i++) {
					kv[kCache + t * Dh + i] = kRot[i];
					kv[vCache + t * Dh + i] = qkv[base + 2 * d + i];
				}
				let maxScore = -Infinity;
				for (let u = 0; u <= t; u++) {
					let acc = 0;
					const kb = kCache + u * Dh;
					for (let i = 0; i < Dh; i++) acc += qRot[i] * kv[kb + i];
					scores[u] = acc * scale;
					if (scores[u] > maxScore) maxScore = scores[u];
				}
				let sum = 0;
				for (let u = 0; u <= t; u++) {
					scores[u] = Math.exp(scores[u] - maxScore);
					sum += scores[u];
				}
				const invSum = 1 / sum;
				attOut.fill(0);
				for (let u = 0; u <= t; u++) {
					const wgt = scores[u] * invSum;
					const vb = vCache + u * Dh;
					for (let i = 0; i < Dh; i++) attOut[i] += wgt * kv[vb + i];
				}
				for (let i = 0; i < Dh; i++) attRow[h * Dh + i] = attOut[i];
			}
			// x[t] += attRow @ woᵀ
			const ob = t * d;
			for (let o = 0; o < d; o++) {
				let acc = 0;
				const qb = o * d;
				for (let i = 0; i < d; i++) acc += wo.q[qb + i] * attRow[i];
				x[ob + o] += acc * wo.s[o];
			}
			// FFN: gate = silu(gu[:ff]) * gu[ff:]; x[t] += gate @ w2ᵀ
			const inv = rmsScale(x, ob, d, F32_EPS);
			const xb2 = t * d;
			for (let i = 0; i < d; i++) xn[xb2 + i] = x[xb2 + i] * inv;
			const gu = new Float32Array(2 * ff);
			gemvQ(gu, w1, xn.subarray(xb2, xb2 + d));
			silu(gu, ff);
			const gate = new Float32Array(ff);
			for (let i = 0; i < ff; i++) gate[i] = gu[i] * gu[ff + i];
			const ffOut = new Float32Array(d);
			gemvQ(ffOut, w2, gate);
			for (let o = 0; o < d; o++) x[ob + o] += ffOut[o];
		}
	}

	/** One decode step at absolute position p (runtime.py _block1). */
	private block1(l: number, x: Float32Array, p: number): void {
		const { d, H, ff } = this.cfg;
		const { Dh, kv, scale, maxLen } = this;
		const [wqkv, wo, w1, w2] = this.layer(l);
		const inv = rmsScale(x, 0, d, F32_EPS);
		const xn = new Float32Array(d);
		for (let i = 0; i < d; i++) xn[i] = x[i] * inv;
		const qkv = new Float32Array(3 * d);
		gemvQ(qkv, wqkv, xn);
		const kCacheLayer = l * 2 * H * maxLen * Dh;
		const vCacheLayer = (l * 2 + 1) * H * maxLen * Dh;
		const qRot = new Float32Array(Dh);
		const kRot = new Float32Array(Dh);
		const scores = new Float32Array(p + 1);
		const attOut = new Float32Array(Dh);
		const attRow = new Float32Array(d);
		for (let h = 0; h < H; h++) {
			const base = h * Dh;
			this.rotaryInto(qRot, qkv, base, p);
			this.rotaryInto(kRot, qkv, base + d, p);
			const kCache = kCacheLayer + h * maxLen * Dh;
			const vCache = vCacheLayer + h * maxLen * Dh;
			for (let i = 0; i < Dh; i++) {
				kv[kCache + p * Dh + i] = kRot[i];
				kv[vCache + p * Dh + i] = qkv[base + 2 * d + i];
			}
			let maxScore = -Infinity;
			for (let u = 0; u <= p; u++) {
				let acc = 0;
				const kb = kCache + u * Dh;
				for (let i = 0; i < Dh; i++) acc += qRot[i] * kv[kb + i];
				scores[u] = acc * scale;
				if (scores[u] > maxScore) maxScore = scores[u];
			}
			let sum = 0;
			for (let u = 0; u <= p; u++) {
				scores[u] = Math.exp(scores[u] - maxScore);
				sum += scores[u];
			}
			const invSum = 1 / sum;
			attOut.fill(0);
			for (let u = 0; u <= p; u++) {
				const wgt = scores[u] * invSum;
				const vb = vCache + u * Dh;
				for (let i = 0; i < Dh; i++) attOut[i] += wgt * kv[vb + i];
			}
			for (let i = 0; i < Dh; i++) attRow[h * Dh + i] = attOut[i];
		}
		for (let o = 0; o < d; o++) {
			let acc = 0;
			const qb = o * d;
			for (let i = 0; i < d; i++) acc += wo.q[qb + i] * attRow[i];
			x[o] += acc * wo.s[o];
		}
		// FFN with a fresh RMS norm
		const inv2 = rmsScale(x, 0, d, F32_EPS);
		for (let i = 0; i < d; i++) xn[i] = x[i] * inv2;
		const gu = new Float32Array(2 * ff);
		gemvQ(gu, w1, xn);
		silu(gu, ff);
		for (let i = 0; i < ff; i++) gu[i] *= gu[ff + i];
		const ffOut = new Float32Array(d);
		gemvQ(ffOut, w2, gu.subarray(0, ff));
		for (let o = 0; o < d; o++) x[o] += ffOut[o];
	}

	/** cond head: returns [context vector (hw,), eos logit]. */
	private cond(x: Float32Array): [Float32Array, number] {
		const hw = this.cfg.hw;
		const inv = rmsScale(x, 0, x.length, F32_EPS);
		const xn = new Float32Array(x.length);
		for (let i = 0; i < x.length; i++) xn[i] = x[i] * inv;
		const ce = new Float32Array(this.ce.out);
		gemvQ(ce, this.ce, xn);
		silu(ce, hw);
		return [ce.slice(0, hw), ce[hw]];
	}

	/** One-step flow head (runtime.py _head): predicts the latent delta. */
	private head(s: Float32Array, noise: Float32Array): Float32Array {
		const { hw, depth } = this.cfg;
		const A = new Float32Array(this.ada.out);
		gemvQ(A, this.ada, s);
		const h = new Float32Array(hw);
		gemvF(h, this.hInp.w, this.hInp.b, noise);
		const y = new Float32Array(hw);
		const hn = new Float32Array(hw);
		const tmp = new Float32Array(2 * hw);
		const out2 = new Float32Array(hw);
		for (let j = 0; j < depth; j++) {
			const o = 3 * hw * j;
			hn.set(h);
			layerNormInPlace(hn);
			for (let i = 0; i < hw; i++) y[i] = A[o + i] + hn[i] * A[o + hw + i];
			gemvQ(tmp, this.hblocks[j * 2], y);
			silu(tmp);
			gemvQ(out2, this.hblocks[j * 2 + 1], tmp);
			for (let i = 0; i < hw; i++) h[i] += A[o + 2 * hw + i] * out2[i];
		}
		const o = 3 * hw * depth;
		hn.set(h);
		layerNormInPlace(hn);
		for (let i = 0; i < hw; i++) y[i] = A[o + i] + hn[i] * A[o + hw + i];
		const out = new Float32Array(this.cfg.latent);
		gemvF(out, this.hOut.w, this.hOut.b, y);
		return out;
	}

	generate(
		voice: Float32Array,
		textIds: number[],
		maxFrames: number,
		temp: number,
		eosThreshold: number,
		minFramesPerChar: number,
		rng: TorchRandn,
	): Float32Array {
		const { d, L, latent } = this.cfg;
		const voiceFrames = voice.length / d;
		const p0 = voiceFrames + textIds.length + 1;
		const frames = Math.min(maxFrames, this.maxLen - p0);
		const minFrames = Math.floor(minFramesPerChar * textIds.length);
		// prefix = [voice frames | text embeddings | bos]
		const x = new Float32Array(p0 * d);
		x.set(voice, 0);
		for (let i = 0; i < textIds.length; i++) {
			const id = textIds[i];
			const row = voiceFrames + i;
			if ((id + 1) * d > this.textEmb.length) {
				throw new Error(`Woof: text id ${id} out of range for text_emb`);
			}
			for (let k = 0; k < d; k++) x[row * d + k] = this.textEmb[id * d + k];
		}
		x.set(this.bos, (p0 - 1) * d);
		for (let l = 0; l < L; l++) this.prefixBlock(l, x, p0);
		const xLast = x.slice((p0 - 1) * d, p0 * d);
		let [s, e] = this.cond(xLast);
		const eosT = Math.log(eosThreshold / (1 - eosThreshold));
		const out = new Float32Array(frames * latent);
		const noise = new Float32Array(latent);
		const z = new Float32Array(latent);
		const ctx = new Float32Array(d);
		let n = 0;
		for (let f = 0; f < frames; f++) {
			if (f > Math.max(3, minFrames) && e > eosT) break;
			noise.set(rng.randn(latent));
			for (let i = 0; i < latent; i++) noise[i] *= temp;
			const delta = this.head(s, noise);
			for (let i = 0; i < latent; i++) {
				z[i] = noise[i] + delta[i];
				out[f * latent + i] = z[i];
			}
			gemvF(ctx, this.latIn.w, this.latIn.b, z);
			for (let l = 0; l < L; l++) this.block1(l, ctx, p0 + f);
			const res = this.cond(ctx);
			s = res[0];
			e = res[1];
			n = f + 1;
		}
		return out.slice(0, n * latent);
	}
}

// ---------------------------------------------------------------------------
// Audio decoder (runtime.py Decoder): Mimi-style transformer + SEANet stack,
// executed over the whole utterance (the runtime's chunked execution of the
// high-rate stages is a memory optimization with identical results, since its
// streaming conv state carries across chunks).
// ---------------------------------------------------------------------------

interface TfLayer {
	ln1g: Float32Array;
	ln1b: Float32Array;
	ln2g: Float32Array;
	ln2b: Float32Array;
	qkv: Float32Array; // (3D, D)
	o: Float32Array; // (D, D)
	fc1: Float32Array; // (ff, D)
	fc2: Float32Array; // (D, ff)
}

interface ConvOp {
	kind: "conv";
	taps: Float32Array[]; // k taps, each (cin, cout)
	b: Float32Array;
	cin: number;
	cout: number;
	k: number;
}

interface ConvTOp {
	kind: "convt";
	m: Float32Array; // (cin, k*cout)
	b: Float32Array;
	cin: number;
	cout: number;
	k: number;
	stride: number;
}

interface ResOp {
	kind: "res";
	a: ConvOp;
	b: ConvOp;
}

type SeanetOp = ConvOp | ConvTOp | ResOp | { kind: "elu" };

function makeConv(
	entries: Map<string, NpyArray>,
	base: string,
	meta: GroupMeta,
): ConvOp {
	const wEntry = entries.get(`${base}.w.q8`);
	const bEntry = entries.get(`${base}.b`);
	const sEntry = entries.get(`${base}.w.s`);
	if (!wEntry || !bEntry || !sEntry)
		throw new Error(`Woof weights: missing ${base}`);
	const w = deqGrouped(npyI8(wEntry), wEntry.shape[1], npyF32(sEntry), meta);
	// w is (cout, cin, k) row-major; build per-tap (cin, cout) matrices.
	const [cout, cin, k] = meta.shape;
	const taps: Float32Array[] = [];
	for (let j = 0; j < k; j++) {
		const tap = new Float32Array(cin * cout);
		for (let o = 0; o < cout; o++) {
			for (let i = 0; i < cin; i++) {
				tap[i * cout + o] = w[(o * cin + i) * k + j];
			}
		}
		taps.push(tap);
	}
	return { kind: "conv", taps, b: npyF32(bEntry), cin, cout, k };
}

function makeConvT(
	entries: Map<string, NpyArray>,
	base: string,
	meta: GroupMeta,
	stride: number,
): ConvTOp {
	const wEntry = entries.get(`${base}.w.q8`);
	const bEntry = entries.get(`${base}.b`);
	const sEntry = entries.get(`${base}.w.s`);
	if (!wEntry || !bEntry || !sEntry)
		throw new Error(`Woof weights: missing ${base}`);
	const w = deqGrouped(npyI8(wEntry), wEntry.shape[1], npyF32(sEntry), meta);
	// w is (cin, cout, k); the runtime builds (cin, k*cout) with k-major
	// columns: M[i, j*cout + o] = w[(i*cout + o)*k + j].
	const [cin, cout, k] = meta.shape;
	const m = new Float32Array(cin * k * cout);
	for (let i = 0; i < cin; i++) {
		for (let o = 0; o < cout; o++) {
			for (let j = 0; j < k; j++) {
				m[(i * k + j) * cout + o] = w[(i * cout + o) * k + j];
			}
		}
	}
	return { kind: "convt", m, b: npyF32(bEntry), cin, cout, k, stride };
}

function deqLinear(
	entries: Map<string, NpyArray>,
	base: string,
	meta: GroupMeta,
): Float32Array {
	const q8Entry = entries.get(`${base}.q8`);
	const sEntry = entries.get(`${base}.s`);
	if (!q8Entry || !sEntry) throw new Error(`Woof weights: missing ${base}`);
	return deqGrouped(npyI8(q8Entry), q8Entry.shape[1], npyF32(sEntry), meta);
}

export interface DecoderTree {
	cfg: { heads: number; head_dim: number; window: number; eps: number };
	tfLayers: number;
	seanetKinds: string[];
	seanetStrides: number[];
}

class WoofDecoder {
	readonly heads: number;
	readonly headDim: number;
	readonly window: number;
	readonly eps: number;
	readonly D: number;
	readonly inpW: Float32Array; // (D, latent) — used as lat @ Wᵀ
	readonly inpB: Float32Array;
	readonly invFreq: Float32Array;
	readonly tf: TfLayer[];
	readonly ops: SeanetOp[];

	constructor(
		entries: Map<string, NpyArray>,
		tree: DecoderTree,
		meta: Map<string, GroupMeta>,
	) {
		this.heads = tree.cfg.heads;
		this.headDim = tree.cfg.head_dim;
		this.window = tree.cfg.window;
		this.eps = tree.cfg.eps;
		this.D = this.heads * this.headDim;
		const inpWEntry = entries.get("decoder.inp.0");
		const inpBEntry = entries.get("decoder.inp.1");
		if (!inpWEntry || !inpBEntry)
			throw new Error("Woof weights: missing decoder.inp");
		this.inpW = npyF32(inpWEntry);
		this.inpB = npyF32(inpBEntry);
		const invEntry = entries.get("decoder.inv_freq");
		if (!invEntry) throw new Error("Woof weights: missing decoder.inv_freq");
		this.invFreq = npyF32(invEntry);
		this.tf = [];
		for (let l = 0; l < tree.tfLayers; l++) {
			this.tf.push({
				ln1g: npyF32(entries.get(`decoder.tf.${l}.ln1.0`) as NpyArray),
				ln1b: npyF32(entries.get(`decoder.tf.${l}.ln1.1`) as NpyArray),
				ln2g: npyF32(entries.get(`decoder.tf.${l}.ln2.0`) as NpyArray),
				ln2b: npyF32(entries.get(`decoder.tf.${l}.ln2.1`) as NpyArray),
				qkv: deqLinear(
					entries,
					`decoder.tf.${l}.qkv`,
					meta.get(`decoder.tf.${l}.qkv`) as GroupMeta,
				),
				o: deqLinear(
					entries,
					`decoder.tf.${l}.o`,
					meta.get(`decoder.tf.${l}.o`) as GroupMeta,
				),
				fc1: deqLinear(
					entries,
					`decoder.tf.${l}.fc1`,
					meta.get(`decoder.tf.${l}.fc1`) as GroupMeta,
				),
				fc2: deqLinear(
					entries,
					`decoder.tf.${l}.fc2`,
					meta.get(`decoder.tf.${l}.fc2`) as GroupMeta,
				),
			});
		}
		this.ops = [];
		for (let idx = 0; idx < tree.seanetKinds.length; idx++) {
			const kind = tree.seanetKinds[idx];
			if (kind === "elu") {
				this.ops.push({ kind: "elu" });
			} else if (kind === "conv") {
				this.ops.push(
					makeConv(
						entries,
						`decoder.seanet.${idx}.1`,
						meta.get(`decoder.seanet.${idx}.1.w`) as GroupMeta,
					),
				);
			} else if (kind === "convt") {
				this.ops.push(
					makeConvT(
						entries,
						`decoder.seanet.${idx}.1`,
						meta.get(`decoder.seanet.${idx}.1.w`) as GroupMeta,
						tree.seanetStrides[idx],
					),
				);
			} else {
				this.ops.push({
					kind: "res",
					a: makeConv(
						entries,
						`decoder.seanet.${idx}.1.0`,
						meta.get(`decoder.seanet.${idx}.1.0.w`) as GroupMeta,
					),
					b: makeConv(
						entries,
						`decoder.seanet.${idx}.1.1`,
						meta.get(`decoder.seanet.${idx}.1.1.w`) as GroupMeta,
					),
				});
			}
		}
	}

	/** out (rows, outDim) = x (rows, inDim) @ wᵀ for row-major (out,in) weights. */
	private static linRows(
		out: Float32Array,
		w: Float32Array,
		outDim: number,
		x: Float32Array,
		rows: number,
	): void {
		const inDim = x.length / rows;
		for (let t = 0; t < rows; t++) {
			const xb = t * inDim;
			const ob = t * outDim;
			for (let o = 0; o < outDim; o++) {
				let acc = 0;
				const wb = o * inDim;
				for (let j = 0; j < inDim; j++) acc += w[wb + j] * x[xb + j];
				out[ob + o] = acc;
			}
		}
	}

	private ln(
		h: Float32Array,
		rows: number,
		g: Float32Array,
		b: Float32Array,
	): void {
		const D = this.D;
		for (let t = 0; t < rows; t++) {
			const off = t * D;
			let mean = 0;
			for (let i = 0; i < D; i++) mean += h[off + i];
			mean /= D;
			let varSum = 0;
			for (let i = 0; i < D; i++) {
				h[off + i] -= mean;
				varSum += h[off + i] * h[off + i];
			}
			const inv = 1 / Math.sqrt(varSum / D + this.eps);
			for (let i = 0; i < D; i++) h[off + i] = h[off + i] * inv * g[i] + b[i];
		}
	}

	private transformer(h: Float32Array): void {
		const T = h.length / this.D;
		const { D, heads, headDim, window } = this;
		const half = headDim / 2;
		const cos = new Float32Array(T * headDim);
		const sin = new Float32Array(T * headDim);
		for (let t = 0; t < T; t++) {
			for (let k = 0; k < half; k++) {
				const ang = t * this.invFreq[k];
				cos[t * headDim + k] = Math.cos(ang);
				cos[t * headDim + k + half] = Math.cos(ang);
				sin[t * headDim + k] = Math.sin(ang);
				sin[t * headDim + k + half] = Math.sin(ang);
			}
		}
		const qkv = new Float32Array(T * 3 * D);
		const y = new Float32Array(T * D);
		const scale = headDim ** -0.5;
		const scores = new Float32Array(T);
		const att = new Float32Array(headDim);
		for (const layer of this.tf) {
			// attention block — ln runs on the copy in y; h keeps the residual
			y.set(h);
			this.ln(y, T, layer.ln1g, layer.ln1b);
			WoofDecoder.linRows(qkv, layer.qkv, 3 * D, y, T);
			// RoPE on q,k (rotate-half with negated second-half sin)
			for (let t = 0; t < T; t++) {
				for (let hh = 0; hh < heads; hh++) {
					const off = t * 3 * D + hh * headDim;
					for (let i = 0; i < half; i++) {
						const q1 = qkv[off + i];
						const q2 = qkv[off + i + half];
						qkv[off + i] =
							q1 * cos[t * headDim + i] - q2 * sin[t * headDim + i];
						qkv[off + i + half] =
							q2 * cos[t * headDim + i + half] +
							q1 * sin[t * headDim + i + half];
						const kc = t * 3 * D + D + hh * headDim;
						const k1 = qkv[kc + i];
						const k2 = qkv[kc + i + half];
						qkv[kc + i] = k1 * cos[t * headDim + i] - k2 * sin[t * headDim + i];
						qkv[kc + i + half] =
							k2 * cos[t * headDim + i + half] +
							k1 * sin[t * headDim + i + half];
					}
				}
			}
			// attention with sliding-window causal mask (allowed: t-window < u <= t)
			for (let t = 0; t < T; t++) {
				const lo = Math.max(0, t - window + 1);
				for (let hh = 0; hh < heads; hh++) {
					const qOff = t * 3 * D + hh * headDim;
					let maxScore = -Infinity;
					for (let u = lo; u <= t; u++) {
						let acc = 0;
						const kb = u * 3 * D + D + hh * headDim;
						for (let i = 0; i < headDim; i++)
							acc += qkv[qOff + i] * qkv[kb + i];
						scores[u] = acc * scale;
						if (scores[u] > maxScore) maxScore = scores[u];
					}
					let sum = 0;
					for (let u = lo; u <= t; u++) {
						scores[u] = Math.exp(scores[u] - maxScore);
						sum += scores[u];
					}
					const invSum = 1 / sum;
					att.fill(0);
					for (let u = lo; u <= t; u++) {
						const wgt = scores[u] * invSum;
						const vb = u * 3 * D + 2 * D + hh * headDim;
						for (let i = 0; i < headDim; i++) att[i] += wgt * qkv[vb + i];
					}
					const yb = t * D + hh * headDim;
					for (let i = 0; i < headDim; i++) y[yb + i] = att[i];
				}
			}
			WoofDecoder.linRows(qkv, layer.o, D, y, T);
			for (let i = 0; i < h.length; i++) h[i] += qkv[i];
			// FFN — same pattern: normalize a copy, keep the residual in h
			y.set(h);
			this.ln(y, T, layer.ln2g, layer.ln2b);
			const ffDim = layer.fc1.length / D;
			const ffBuf = new Float32Array(T * ffDim);
			WoofDecoder.linRows(ffBuf, layer.fc1, ffDim, y, T);
			gelu(ffBuf);
			WoofDecoder.linRows(y, layer.fc2, D, ffBuf, T);
			for (let i = 0; i < h.length; i++) h[i] += y[i];
		}
	}

	private convFull(op: ConvOp, x: Float32Array, rows: number): Float32Array {
		const { taps, b, cin, cout, k } = op;
		const out = new Float32Array(rows * cout);
		for (let i = 0; i < rows; i++) {
			for (let o = 0; o < cout; o++) out[i * cout + o] = b[o];
		}
		// Causal conv with left zero-padding of k-1 (equals the runtime's
		// streaming conv state after reset, consumed over the whole sequence).
		const padded = new Float32Array((rows + k - 1) * cin);
		padded.set(x, (k - 1) * cin);
		for (let j = 0; j < k; j++) {
			const tap = taps[j];
			for (let i = 0; i < rows; i++) {
				const xb = (i + j) * cin;
				const ob = i * cout;
				for (let c = 0; c < cin; c++) {
					const xv = padded[xb + c];
					if (xv === 0) continue;
					const tb = c * cout;
					for (let o = 0; o < cout; o++) out[ob + o] += xv * tap[tb + o];
				}
			}
		}
		return out;
	}

	private convTFull(op: ConvTOp, x: Float32Array, rows: number): Float32Array {
		const { m, b, cin, cout, k, stride } = op;
		// z[t, col] = sum_i x[t, i] * m[i, col] — m is (cin, k*cout), so this
		// is a transposed product; accumulate rank-1 updates per input column.
		const z = new Float32Array(rows * k * cout);
		for (let t = 0; t < rows; t++) {
			const xb = t * cin;
			const zb = t * k * cout;
			for (let i = 0; i < cin; i++) {
				const xv = x[xb + i];
				if (xv === 0) continue;
				const mb = i * k * cout;
				for (let col = 0; col < k * cout; col++)
					z[zb + col] += xv * m[mb + col];
			}
		}
		// The runtime keeps a carry between calls; consumed in one pass here the
		// carry is zero, so frame t's second half lands on output row t*stride+j
		// of frame t+1 (rows with t>0 only).
		const out = new Float32Array(rows * stride * cout);
		for (let t = 0; t < rows; t++) {
			for (let j = 0; j < stride; j++) {
				const ob = (t * stride + j) * cout;
				const zb = t * k * cout + j * cout;
				const carry = t > 0 ? (t - 1) * k * cout + (j + stride) * cout : -1;
				for (let c = 0; c < cout; c++) {
					out[ob + c] = z[zb + c] + b[c] + (carry >= 0 ? z[carry + c] : 0);
				}
			}
		}
		return out;
	}

	private runOps(x: Float32Array, rows: number, ops: SeanetOp[]): Float32Array {
		let cur = x;
		let curRows = rows;
		for (const op of ops) {
			if (op.kind === "elu") {
				elu(cur);
			} else if (op.kind === "conv") {
				cur = this.convFull(op, cur, curRows);
				curRows = cur.length / op.cout;
			} else if (op.kind === "convt") {
				cur = this.convTFull(op, cur, curRows);
				curRows = cur.length / op.cout;
			} else {
				// res: x + conv2(elu(conv1(elu(x))))
				const yIn = Float32Array.from(cur);
				elu(yIn);
				const a = this.convFull(op.a, yIn, curRows);
				elu(a);
				const bOut = this.convFull(op.b, a, curRows);
				for (let i = 0; i < cur.length; i++) cur[i] += bOut[i];
			}
		}
		return cur;
	}

	decode(
		lat: Float32Array,
		frames: number,
		mean: Float32Array,
		std: Float32Array,
	): Float32Array {
		const latent = mean.length;
		const scaled = new Float32Array(frames * latent);
		for (let f = 0; f < frames; f++) {
			for (let c = 0; c < latent; c++) {
				scaled[f * latent + c] = lat[f * latent + c] * std[c] + mean[c];
			}
		}
		const h = new Float32Array(frames * this.D);
		WoofDecoder.linRows(h, this.inpW, this.D, scaled, frames);
		for (let t = 0; t < frames; t++) {
			for (let i = 0; i < this.D; i++) h[t * this.D + i] += this.inpB[i];
		}
		this.transformer(h);
		// The final SEANet conv has cout=1, so the output is flat samples.
		return this.runOps(h, frames, this.ops);
	}
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface WoofTree {
	speech: { cfg: SpeechCfg };
	decoder: {
		cfg: { heads: number; head_dim: number; window: number; eps: number };
		tf: unknown[];
		seanet: Array<[string, unknown]>;
	};
	max_frames: number;
	fps: number;
	mean: { "@": string };
	std: { "@": string };
	voices: Record<string, { "@": string }>;
}

// ---------------------------------------------------------------------------
// Shared npz extraction (CPU engine and WebGPU engine both start here)
// ---------------------------------------------------------------------------

export interface WoofNpz {
	entries: Map<string, NpyArray>;
	tree: WoofTree;
	meta: Map<string, GroupMeta>;
}

/** Parse the npz, read __tree__ and collect the grouped-int8 metadata. */
export function loadWoofNpz(buffer: ArrayBuffer): WoofNpz {
	const entries = parseWoofNpz(buffer);
	const treeEntry = entries.get("__tree__");
	if (!treeEntry) throw new Error("Woof weights: missing __tree__");
	const tree = JSON.parse(npyUtf32String(treeEntry)) as WoofTree;
	const meta = new Map<string, GroupMeta>();
	const walk = (node: unknown, path: string): void => {
		if (Array.isArray(node)) {
			node.forEach((v, i) => {
				walk(v, `${path}.${i}`);
			});
			return;
		}
		if (node !== null && typeof node === "object") {
			const obj = node as Record<string, unknown>;
			if (
				"shape" in obj &&
				"axis" in obj &&
				"g" in obj &&
				"q8" in obj &&
				typeof obj.q8 === "object" &&
				obj.q8 !== null &&
				"@" in obj.q8
			) {
				// Reference keys look like "decoder.tf.0.qkv.q8"; index them by
				// the tensor's base name (without the .q8 suffix).
				const ref = ((obj.q8 as { "@": string })["@"] as string).replace(
					/\.q8$/,
					"",
				);
				meta.set(ref, {
					shape: obj.shape as number[],
					axis: obj.axis as number,
					g: obj.g as number,
				});
			}
			for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
		}
	};
	walk(tree, "");
	return { entries, tree, meta };
}

export function buildDecoderTree(tree: WoofTree): DecoderTree {
	return {
		cfg: tree.decoder.cfg,
		tfLayers: tree.decoder.tf.length,
		seanetKinds: tree.decoder.seanet.map((op) => op[0]),
		seanetStrides: tree.decoder.seanet.map((op) =>
			op[0] === "convt" ? ((op[1] as { stride: number }).stride as number) : 0,
		),
	};
}

export class WoofEngine {
	readonly speech: SpeechModel;
	readonly dec: WoofDecoder;
	readonly mean: Float32Array;
	readonly std: Float32Array;
	readonly voices: Record<string, Float32Array>;
	readonly maxFrames: number;
	readonly fps: number;
	private rng = new TorchRandn();

	constructor(
		speech: SpeechModel,
		dec: WoofDecoder,
		mean: Float32Array,
		std: Float32Array,
		voices: Record<string, Float32Array>,
		maxFrames: number,
		fps: number,
	) {
		this.speech = speech;
		this.dec = dec;
		this.mean = mean;
		this.std = std;
		this.voices = voices;
		this.maxFrames = maxFrames;
		this.fps = fps;
	}

	static load(buffer: ArrayBuffer): WoofEngine {
		const { entries, tree, meta } = loadWoofNpz(buffer);

		const meanArr = entries.get(tree.mean["@"]);
		const stdArr = entries.get(tree.std["@"]);
		if (!meanArr || !stdArr) throw new Error("Woof weights: missing mean/std");
		const mean = npyF32(meanArr);
		const std = npyF32(stdArr);
		const voices: Record<string, Float32Array> = {};
		for (const [name, ref] of Object.entries(tree.voices)) {
			const e = entries.get(ref["@"]);
			if (e) voices[name] = npyF32(e);
		}
		if (!voices.juno || !voices.mira) {
			throw new Error("Woof weights: missing voices (expected juno and mira)");
		}
		const speech = new SpeechModel(tree.speech.cfg, entries);
		const dec = new WoofDecoder(entries, buildDecoderTree(tree), meta);
		return new WoofEngine(
			speech,
			dec,
			mean,
			std,
			voices,
			tree.max_frames,
			tree.fps,
		);
	}

	/** Seed the shared RNG stream (reference Woof.__call__(seed=…)). */
	seedRng(seed: number): void {
		this.rng.seed(seed);
	}

	/** Synthesize one piece of text; draws continue the shared RNG stream, so
	 * multi-piece synthesis matches the reference's sequential draws. The rng
	 * parameter lets the loader share ONE stream across backends (the WebGPU
	 * path must draw from the identical stream). */
	synthesizePiece(
		text: string,
		voiceId: string,
		rng: TorchRandn = this.rng,
	): Float32Array {
		const voice = this.voices[voiceId];
		if (!voice) throw new Error(`Woof: unknown voice "${voiceId}"`);
		const ids = encodeText(text);
		const lat = this.speech.generate(
			voice,
			ids,
			this.maxFrames,
			TEMP,
			EOS_THRESHOLD,
			MIN_SECONDS_PER_CHAR * (this.fps / 12.5),
			rng,
		);
		const frames = lat.length / this.mean.length;
		return this.dec.decode(lat, frames, this.mean, this.std);
	}
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export class WoofTtsLoader implements ModelLoader {
	slug = "woof-tts";
	type = "tts" as const;
	framework = "custom-js" as const;

	private engine: WoofEngine | null = null;
	private gpu: WoofGpuSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		const response = await fetch(WEIGHTS_URL);
		if (!response.ok) {
			throw new Error(`Failed to fetch Woof weights: ${response.status}`);
		}
		if (!response.body) throw new Error("Woof weights: response has no body");
		const total = Number(response.headers.get("content-length") ?? 0);
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let loaded = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				chunks.push(value);
				loaded += value.length;
				options.onProgress?.({
					status: "downloading",
					file: "woof_int8.npz",
					loaded: total > 0 ? Math.min(loaded, total) : loaded,
					total: total > 0 ? total : loaded,
				});
			}
		}
		const bytes = new Uint8Array(loaded);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}

		// WebGPU path: build the WGSL engine from the same npz bytes. Any
		// failure (no adapter, device lost, adapter limits too small) falls
		// back to the typed-array path, matching the site's auto behaviour.
		this.gpu = null;
		this.engine = null;
		if (options.backend === "webgpu") {
			try {
				const { createWoofGpuSession } = await import("./woof-gpu");
				this.gpu = await createWoofGpuSession(bytes.buffer);
				if (this.gpu) this.loadedBackend = "webgpu";
			} catch (err) {
				console.warn(
					"[woof] WebGPU engine unavailable, falling back to WASM:",
					err instanceof Error ? err.message : err,
				);
			}
		}
		if (!this.gpu) {
			this.engine = WoofEngine.load(bytes.buffer);
			this.loadedBackend = "wasm";
		}
		options.onProgress?.({
			status: "ready",
			file: "woof_int8.npz",
			loaded,
			total: total > 0 ? total : loaded,
		});
		return {
			dispose: () => {
				this.gpu?.dispose();
				this.gpu = null;
				this.engine = null;
			},
		};
	}

	async synthesize(
		text: string,
		voice: string,
		options?: { speed?: number },
	): Promise<AudioResult> {
		if (!this.engine && !this.gpu) throw new Error("Model not loaded");
		// Note: `speed` is accepted for API compatibility but Woof has no speed
		// knob in the reference runtime, so it is ignored.
		void options;
		const resolvedVoice = voice === "default" ? DEFAULT_VOICE : voice;
		if (!VOICES.some((v) => v.id === resolvedVoice)) {
			throw new Error(
				`Voice "${resolvedVoice}" not found. Should be one of: ${VOICES.map((v) => v.id).join(", ")}.`,
			);
		}
		const start = performance.now();
		// Long text is split into sentences (and long sentences into clauses)
		// exactly like the reference textsplit.py; the RNG is seeded once per
		// call (reference default seed 0) and the pieces draw sequentially.
		// The same seed ⇒ the same audio on both backends: the WebGPU path
		// draws its noise from this identical CPU RNG stream.
		this.rng.seed(0);
		const pieces = splitWoofText(text);
		const chunks: Float32Array[] = [];
		for (const piece of pieces.length > 0 ? pieces : [text]) {
			if (!piece.trim()) continue;
			chunks.push(await this.synthesizePiece(piece, resolvedVoice));
		}
		const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
		const audio = new Float32Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			audio.set(chunk, offset);
			offset += chunk.length;
		}
		const totalMs = performance.now() - start;
		if (audio.length === 0) {
			throw new Error(
				"Model returned empty audio data. Try reloading the model.",
			);
		}
		return {
			audio,
			sampleRate: SAMPLE_RATE,
			duration: audio.length / SAMPLE_RATE,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: this.loadedBackend,
			},
		};
	}

	private rng = new TorchRandn();

	private async synthesizePiece(
		piece: string,
		voiceId: string,
	): Promise<Float32Array> {
		if (this.gpu) return this.gpu.synthesizePiece(piece, voiceId, this.rng);
		if (!this.engine) throw new Error("Model not loaded");
		return this.engine.synthesizePiece(piece, voiceId, this.rng);
	}

	getVoices(): Voice[] {
		return VOICES;
	}

	getLanguages(): string[] {
		return ["en"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["webgpu", "wasm"];
	}

	getPreferredBackend(): "webgpu" | "wasm" | "auto" {
		return "auto";
	}
}
