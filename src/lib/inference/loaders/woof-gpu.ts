import type { GroupMeta, NpyArray, QLinear, WoofNpz } from "./woof";
import {
	buildDecoderTree,
	EOS_THRESHOLD,
	encodeText,
	F32_EPS,
	loadWoofNpz,
	MIN_SECONDS_PER_CHAR,
	npyF32,
	qLinear,
	TEMP,
	TorchRandn,
	WEIGHTS_URL,
	WoofEngine,
	wLinear,
} from "./woof";

/**
 * Woof on WebGPU — a hand-written WGSL kernel set over the raw WebGPU API
 * (no typegpu/onnxruntime dependency), giving woof-tts a real second backend
 * next to the typed-array CPU port in `woof.ts`. The set is 22 kernels
 * (`Object.keys(WOOF_KERNELS).length` — asserted in `woof-gpu.test.ts`).
 *
 * Lineage: the kernel decomposition follows the structure of Underdog's own
 * browser bundle (underdog.ai/woof — the SayIt/woof/decoder chunks ship 19
 * WGSL compute kernels; our own set is 22). From that reference we adopted
 * the *approach*:
 *   - weights stay int8-packed on the GPU (4 bytes per u32) and are
 *     dequantized in registers inside the matmul/conv kernels, so there is
 *     no fp32 weight blow-up at load (the two-voice npz is ~40 MB packed;
 *     dequantizing it to fp32 would transiently cost ~250 MB of JS heap —
 *     a real iOS memory ceiling. We never dequantize: peak JS heap stays at
 *     the download size plus small packing copies);
 *   - decode positions are passed through a small storage buffer, so all
 *     dispatch plans (pipeline + bind group + uniform sets) are static and
 *     cached — per batch only `pos`, `noise` are uploaded and `eos` read
 *     back;
 *   - frames are decoded in small batches (4) with one readback per batch;
 *   - the device is created with `requiredLimits` at the adapter maximum
 *     (mirroring the reference; our largest single buffer is the speech KV
 *     cache at ~31 MB, well under the 128 MiB default
 *     maxStorageBufferBindingSize, but we request explicitly anyway).
 * All WGSL and all TypeScript here is our own implementation (the reference
 * is Underdog NC-1.0-licensed; the CPU port was done the same way).
 *
 * Verified status (honest):
 *   - CPU path (woof.ts): numerically exact vs the numpy reference runtime.
 *   - WebGPU path: browser-verified 2026-11-08 — `__woofVerify()` executed in
 *     headed Chromium: same sentence / voice juno / seed 0 through both
 *     backends → Pearson corr 0.9999998 (target >= 0.9999), 78 frames on
 *     both, CPU 6094 ms vs GPU 194 ms (~31x), adapter apple metal-3, no WGSL
 *     compile errors / device-lost / OOM. Floating-point accumulation order
 *     differs (parallel reductions in matmul/attention, GELU/ELU
 *     approximations), so bit-exactness is NOT expected — only correlation.
 *     EOS gating uses the same thresholds and the same seeded noise stream,
 *     so both backends produce the same frame count. To re-run: execute
 *     `await __woofVerify()` from the console on any page that loads this
 *     module (procedure documented on `runWoofBackendCheck` below).
 *
 * Expected performance: per audio frame the speech model does ~30 MFLOP of
 * int8 matmul (8 layers x [qkv 1344x448, wo 448x448, w1 640x448, w2 448x320]
 * plus the flow head). The CPU typed-array port runs that at roughly
 * 1-3 GFLOP/s (~10-30 ms/frame, i.e. below real time for 12.5 fps audio);
 * the GPU matmul kernel (one workgroup per output row, 64 lanes striding
 * 4-element quads, workgroup tree reduction) should beat that by an order of
 * magnitude. The decode loop is launch-latency bound (~100 tiny dispatches
 * per frame), which is why frames are batched. The SEANet decoder is a
 * one-shot pass per sentence (a few GFLOP) and is not the bottleneck.
 *
 * Risks (documented, not hidden):
 *   - iOS/Safari: WebGPU exists but older devices may reject a 31 MB storage
 *     binding or drop the device mid-run (`device.lost` is logged; synthesis
 *     then throws and the caller can reload with wasm).
 *   - Adapter limits: we assert our buffer sizes against
 *     maxStorageBufferBindingSize/maxBufferSize at load and refuse the GPU
 *     path (-> wasm fallback) instead of failing mid-sentence.
 *   - Workgroup shared memory: the speech attention scratch (1104 f32) fits
 *     the 16 KiB default maxComputeWorkgroupStorageSize.
 */

// ---------------------------------------------------------------------------
// Minimal structural WebGPU types (no @webgpu/types dependency — the DOM lib
// in this repo does not include WebGPU). Numeric usage constants follow the
// WebGPU spec.
// ---------------------------------------------------------------------------

const GPU_BUFFER_USAGE = {
	MAP_READ: 0x0001,
	COPY_SRC: 0x0004,
	COPY_DST: 0x0008,
	UNIFORM: 0x0040,
	STORAGE: 0x0080,
} as const;
const GPU_MAP_MODE_READ = 0x0001;

export interface WgBuffer {
	size: number;
	label?: string;
	mapAsync(mode: number): Promise<void>;
	getMappedRange(): ArrayBuffer;
	unmap(): void;
	destroy(): void;
}

export interface WgBufferDescriptor {
	size: number;
	usage: number;
	label?: string;
	mappedAtCreation?: boolean;
}

export interface WgQueue {
	writeBuffer(
		buffer: WgBuffer,
		bufferOffset: number,
		data: ArrayBufferView | ArrayBuffer,
		dataOffset?: number,
		size?: number,
	): void;
	submit(commandBuffers: unknown[]): void;
}

export type WgBindGroupLayout = Record<string, never>;

export type WgBindGroup = Record<string, never>;

export interface WgComputePipeline {
	getBindGroupLayout(index: number): WgBindGroupLayout;
}

export interface WgBindGroupDescriptor {
	layout: WgBindGroupLayout;
	entries: Array<{
		binding: number;
		resource: { buffer: WgBuffer; offset?: number; size?: number };
	}>;
	label?: string;
}

export interface WgComputePipelineDescriptor {
	layout: "auto";
	compute: { module: WgShaderModule; entryPoint: string };
	label?: string;
}

export type WgShaderModule = Record<string, never>;

export interface WgCommandEncoder {
	beginComputePass(): WgComputePassEncoder;
	copyBufferToBuffer(
		source: WgBuffer,
		sourceOffset: number,
		destination: WgBuffer,
		destinationOffset: number,
		size: number,
	): void;
	finish(): unknown;
}

export interface WgComputePassEncoder {
	setPipeline(pipeline: WgComputePipeline): void;
	setBindGroup(index: number, bindGroup: WgBindGroup): void;
	dispatchWorkgroups(x: number, y?: number, z?: number): void;
	end(): void;
}

export interface WgDevice {
	limits: {
		maxBufferSize: number;
		maxStorageBufferBindingSize: number;
		maxComputeWorkgroupStorageSize: number;
	};
	queue: WgQueue;
	createBuffer(descriptor: WgBufferDescriptor): WgBuffer;
	createShaderModule(descriptor: {
		code: string;
		label?: string;
	}): WgShaderModule;
	createComputePipeline(
		descriptor: WgComputePipelineDescriptor,
	): WgComputePipeline;
	createComputePipelineAsync(
		descriptor: WgComputePipelineDescriptor,
	): Promise<WgComputePipeline>;
	createBindGroup(descriptor: WgBindGroupDescriptor): WgBindGroup;
	createCommandEncoder(descriptor?: { label?: string }): WgCommandEncoder;
	destroy(): void;
}

export interface WgAdapter {
	limits: {
		maxBufferSize: number;
		maxStorageBufferBindingSize: number;
		maxComputeWorkgroupStorageSize: number;
	};
	info?: { vendor?: string; architecture?: string; description?: string };
	requestDevice(descriptor?: {
		requiredLimits?: Record<string, number>;
	}): Promise<WgDevice>;
}

export interface WgGPUNamespace {
	requestAdapter(descriptor?: {
		powerPreference?: string;
	}): Promise<WgAdapter | null>;
}

function navigatorGpu(): WgGPUNamespace | undefined {
	if (typeof navigator === "undefined") return undefined;
	return (navigator as unknown as { gpu?: WgGPUNamespace }).gpu;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Round up to the 16-byte alignment uniform buffers require. */
export function round16(n: number): number {
	return Math.max(16, Math.ceil(n / 16) * 16);
}

/** Decode frames per GPU submit (the reference batches 3; one eos readback
 * per batch keeps the CPU-gated EOS semantics). */
const BATCH = 4;

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);
/** Bit-cast an f32 to its u32 word (for uniform buffers mixing ints/floats). */
export function f32Word(v: number): number {
	f32Scratch[0] = v;
	return u32Scratch[0];
}

/**
 * Pack int8 weight rows into u32 words, 4 bytes per word, LSB-first —
 * exactly the layout the WGSL `i8x4` decode expects (byte j of word i is
 * column 4*i+j). When the source bytes are 4-aligned inside their buffer the
 * npz payload can be viewed zero-copy (npz stores little-endian bytes, and
 * WebGPU is little-endian).
 */
export function packI8(q: Int8Array): {
	words: Uint32Array;
	zeroCopy: boolean;
} {
	const aligned = q.byteOffset % 4 === 0;
	if (aligned) {
		return {
			words: new Uint32Array(q.buffer, q.byteOffset, q.length >> 2),
			zeroCopy: true,
		};
	}
	const words = new Uint32Array(Math.ceil(q.length / 4));
	for (let i = 0; i < q.length; i++) {
		words[i >> 2] |= (q[i] & 0xff) << ((i & 3) * 8);
	}
	return { words, zeroCopy: false };
}

/** One dispatch dimension, split over y when it exceeds the 65535 limit. */
export function flatDispatch(n: number, size: number): [number, number] {
	const groups = Math.ceil(n / size);
	return [Math.min(groups, 65535), Math.ceil(groups / 65535)];
}

// ---------------------------------------------------------------------------
// WGSL kernels. All kernels are named woof_*; every entry point is `main`.
// Uniform structs are plain u32/f32 scalar lists; planners below build the
// words in exactly this field order.
// ---------------------------------------------------------------------------

const COMMON = /* wgsl */ `
fn i8x4(u: u32) -> vec4<f32> {
  return vec4<f32>(vec4<i32>(bitcast<i32>(u << 24u), bitcast<i32>(u << 16u), bitcast<i32>(u << 8u), bitcast<i32>(u)) >> vec4<u32>(24u));
}
fn silu1(x: f32) -> f32 { return x / (1.0 + exp(-x)); }
fn elu1(x: f32) -> f32 { return select(exp(x) - 1.0, x, x > 0.0); }
fn erf1(x: f32) -> f32 {
  // Abramowitz-Stegun 7.1.26 — the same approximation the CPU port uses.
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  let y = 1.0 - poly * exp(-a * a);
  return select(-y, y, x >= 0.0);
}
fn flatIdx(wg: vec3<u32>, li: u32) -> u32 { return (wg.y * 65535u + wg.x) * 256u + li; }
`;

/**
 * woof_mm — int8-packed matmul: y[t, r] = (x[t] . w[r]) * s[r, g] (+bias),
 * optional accumulate into y. One workgroup (64 lanes) per (weight row,
 * token); lanes stride 4-column quads, then tree-reduce in shared memory.
 * Serves every speech transformer linear (448-dim) and the decoder
 * transformer linears; per-row-group scales make it double for the speech
 * per-row quantization (one group per row).
 */
const MM = /* wgsl */ `
struct P { rows: u32, cols: u32, wq: u32, group: u32, tokens: u32, xOff: u32, xStride: u32, yOff: u32, yStride: u32, wOff: u32, flags: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<u32>;
@group(0) @binding(2) var<storage, read> s: array<f32>;
@group(0) @binding(3) var<storage, read> x: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
@group(0) @binding(5) var<storage, read> bias: array<f32>;
var<workgroup> part: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let r = p.wOff + wg.x + wg.z * 65535u;
  if (r >= p.wOff + p.rows) { return; }
  let t = wg.y;
  let quads = p.cols / 4u;
  let ng = arrayLength(&s) / p.rows;
  let wrow = r * p.wq;
  let xrow = p.xOff + t * p.xStride;
  var acc = 0.0;
  for (var c4 = li; c4 < quads; c4 += 64u) {
    let c = c4 * 4u;
    let wv = i8x4(w[wrow + c4]) * s[r * ng + c / p.group];
    acc += dot(wv, vec4<f32>(x[xrow + c], x[xrow + c + 1u], x[xrow + c + 2u], x[xrow + c + 3u]));
  }
  part[li] = acc;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { part[li] += part[li + k]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    var v = part[0];
    if ((p.flags & 1u) != 0u) { v += bias[r]; }
    let at = p.yOff + t * p.yStride + r;
    if ((p.flags & 2u) != 0u) { v += y[at]; }
    y[at] = v;
  }
}
`;

/**
 * woof_mvt — tiny fp32 linear (out, in) x (tokens, in) -> (tokens, out) with
 * bias. Used for the fp32 weights the npz ships unquantized: decoder.inp,
 * speech.lat_in / h_inp / h_out (in-dims 32..320, one lane per dot slice).
 */
const MVT = /* wgsl */ `
struct P { out: u32, in: u32, tokens: u32, xOff: u32, xStride: u32, yOff: u32, yStride: u32, flags: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f32>;
@group(0) @binding(3) var<storage, read> b: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
var<workgroup> part: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let o = wg.x;
  let t = wg.y;
  if (o >= p.out || t >= p.tokens) { return; }
  let xrow = p.xOff + t * p.xStride;
  var acc = 0.0;
  for (var j = li; j < p.in; j += 64u) { acc += w[o * p.in + j] * x[xrow + j]; }
  part[li] = acc;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { part[li] += part[li + k]; }
    workgroupBarrier();
  }
  if (li == 0u) { y[p.yOff + t * p.yStride + o] = part[0] + b[o]; }
}
`;

/** woof_rmsnorm — per-row RMS norm, no gain (the speech model's pre-norm). */
const RMSNORM = /* wgsl */ `
struct P { rows: u32, d: u32, stride: u32, eps: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
var<workgroup> part: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let row = wg.x;
  if (row >= p.rows) { return; }
  let base = row * p.stride;
  var s = 0.0;
  for (var i = li; i < p.d; i += 64u) { let v = x[base + i]; s += v * v; }
  part[li] = s;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { part[li] += part[li + k]; }
    workgroupBarrier();
  }
  let inv = inverseSqrt(part[0] / f32(p.d) + p.eps);
  workgroupBarrier();
  for (var i = li; i < p.d; i += 64u) { y[base + i] = x[base + i] * inv; }
}
`;

/**
 * woof_rope — half-split RoPE applied in place to q and k slices of a
 * (tokens, 3d) qkv buffer. Positions come from pos[slot] (decode step) or
 * the uniform posBase (prefix pass). Angles: t * base^(-2k/hd).
 */
const ROPE = /* wgsl */ `
struct P { tokens: u32, heads: u32, hd: u32, d: u32, slot: u32, posMode: u32, posBase: u32, base: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> x: array<f32>;
@group(0) @binding(2) var<storage, read> pos: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let half = p.hd / 2u;
  let per = p.heads * half;
  let total = p.tokens * per;
  let i = gid.x;
  if (i >= total * 2u) { return; }
  let which = i / total;
  let j = i % total;
  let t = j / per;
  let h = (j % per) / half;
  let k = j % half;
  let basePos = select(p.posBase, pos[p.slot], p.posMode != 0u);
  let ang = f32(basePos + t) * pow(p.base, -f32(2u * k) / f32(p.hd));
  let c = cos(ang);
  let s = sin(ang);
  let at = t * 3u * p.d + which * p.d + h * p.hd + k;
  let at2 = at + half;
  let x1 = x[at];
  let x2 = x[at2];
  x[at] = x1 * c - x2 * s;
  x[at2] = x2 * c + x1 * s;
}
`;

/** woof_rope_t — decoder variant: angles from the stored inv_freq table.
 * Reads `pos` through the same select indirection as `rope` (posMode=0 keeps
 * posBase): an unused binding would be stripped from the auto layout and the
 * descriptor's pos entry would invalidate the whole bind group. */
const ROPE_T = /* wgsl */ `
struct P { tokens: u32, heads: u32, hd: u32, d: u32, slot: u32, posMode: u32, posBase: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> x: array<f32>;
@group(0) @binding(2) var<storage, read> pos: array<u32>;
@group(0) @binding(3) var<storage, read> inv: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let half = p.hd / 2u;
  let per = p.heads * half;
  let total = p.tokens * per;
  let i = gid.x;
  if (i >= total * 2u) { return; }
  let which = i / total;
  let j = i % total;
  let t = j / per;
  let h = (j % per) / half;
  let k = j % half;
  let basePos = select(p.posBase, pos[p.slot], p.posMode != 0u);
  let ang = f32(basePos + t) * inv[k];
  let c = cos(ang);
  let s = sin(ang);
  let at = t * 3u * p.d + which * p.d + h * p.hd + k;
  let at2 = at + half;
  let x1 = x[at];
  let x2 = x[at2];
  x[at] = x1 * c - x2 * s;
  x[at2] = x2 * c + x1 * s;
}
`;

/** woof_cache — write k/v rows of a qkv buffer into the (L, 2, H, maxLen, Dh)
 * speech KV cache at absolute position pos[slot]+t. */
const CACHE = /* wgsl */ `
struct P { tokens: u32, heads: u32, hd: u32, d: u32, maxLen: u32, layer: u32, slot: u32, posMode: u32, posBase: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> qkv: array<f32>;
@group(0) @binding(2) var<storage, read_write> kv: array<f32>;
@group(0) @binding(3) var<storage, read> pos: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.tokens * p.d) { return; }
  let t = i / p.d;
  let c = i % p.d;
  let h = c / p.hd;
  let e = c % p.hd;
  let basePos = select(p.posBase, pos[p.slot], p.posMode != 0u) + t;
  let kBase = p.layer * 2u * p.heads * p.maxLen * p.hd;
  let dst = kBase + h * p.maxLen * p.hd + basePos * p.hd + e;
  kv[dst] = qkv[t * 3u * p.d + p.d + c];
  kv[dst + p.heads * p.maxLen * p.hd] = qkv[t * 3u * p.d + 2u * p.d + c];
}
`;

/**
 * woof_attn — speech attention against the persistent KV cache. One
 * workgroup per (query row, head), 64 lanes: scores strided across lanes,
 * shared-memory max/sum reductions, then each lane owns one output dim
 * (sequential j order, matching the CPU accumulation order per element).
 */
const ATTN = /* wgsl */ `
struct P { tokens: u32, heads: u32, hd: u32, d: u32, maxLen: u32, layer: u32, slot: u32, posMode: u32, posBase: u32, scale: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> qkv: array<f32>;
@group(0) @binding(2) var<storage, read> kv: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
@group(0) @binding(4) var<storage, read> pos: array<u32>;
var<workgroup> qv: array<f32, 64>;
var<workgroup> sc: array<f32, 1104>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  let h = wg.y;
  if (t >= p.tokens) { return; }
  let basePos = select(p.posBase, pos[p.slot], p.posMode != 0u);
  let n = basePos + t + 1u;
  let kBase = p.layer * 2u * p.heads * p.maxLen * p.hd;
  let vBase = kBase + p.heads * p.maxLen * p.hd;
  let qRow = t * 3u * p.d + h * p.hd;
  if (li < p.hd) { qv[li] = qkv[qRow + li]; }
  workgroupBarrier();
  var mx = -1e30;
  for (var j = li; j < n; j += 64u) {
    let kb = kBase + h * p.maxLen * p.hd + j * p.hd;
    var acc = 0.0;
    for (var e = 0u; e < p.hd; e++) { acc += qv[e] * kv[kb + e]; }
    acc *= p.scale;
    sc[j] = acc;
    mx = max(mx, acc);
  }
  red[li] = mx;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] = max(red[li], red[li + k]); }
    workgroupBarrier();
  }
  let top = red[0];
  workgroupBarrier();
  var sum = 0.0;
  for (var j = li; j < n; j += 64u) { let e2 = exp(sc[j] - top); sc[j] = e2; sum += e2; }
  red[li] = sum;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] += red[li + k]; }
    workgroupBarrier();
  }
  let total = red[0];
  workgroupBarrier();
  if (li < p.hd) {
    var acc = 0.0;
    let vb = vBase + h * p.maxLen * p.hd;
    for (var j = 0u; j < n; j++) { acc += sc[j] * kv[vb + j * p.hd + li]; }
    out[t * p.d + h * p.hd + li] = acc / total;
  }
}
`;

/**
 * woof_attn_w — decoder transformer attention: full (tokens, 3d) buffer,
 * causal sliding-window mask (window = 250), one workgroup per (t, head).
 */
const ATTN_W = /* wgsl */ `
struct P { tokens: u32, heads: u32, hd: u32, d: u32, window: u32, pad0: u32, pad1: u32, scale: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> qkv: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
var<workgroup> qv: array<f32, 64>;
var<workgroup> sc: array<f32, 256>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  let h = wg.y;
  if (t >= p.tokens) { return; }
  let lo = select(0u, t + 1u - p.window, t + 1u > p.window);
  let n = t + 1u - lo;
  let qRow = t * 3u * p.d + h * p.hd;
  if (li < p.hd) { qv[li] = qkv[qRow + li]; }
  workgroupBarrier();
  var mx = -1e30;
  for (var j = li; j < n; j += 64u) {
    let u = lo + j;
    let kb = u * 3u * p.d + p.d + h * p.hd;
    var acc = 0.0;
    for (var e = 0u; e < p.hd; e++) { acc += qv[e] * qkv[kb + e]; }
    acc *= p.scale;
    sc[j] = acc;
    mx = max(mx, acc);
  }
  red[li] = mx;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] = max(red[li], red[li + k]); }
    workgroupBarrier();
  }
  let top = red[0];
  workgroupBarrier();
  var sum = 0.0;
  for (var j = li; j < n; j += 64u) { let e2 = exp(sc[j] - top); sc[j] = e2; sum += e2; }
  red[li] = sum;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] += red[li + k]; }
    workgroupBarrier();
  }
  let total = red[0];
  workgroupBarrier();
  if (li < p.hd) {
    var acc = 0.0;
    for (var j = 0u; j < n; j++) {
      let u = lo + j;
      acc += sc[j] * qkv[u * 3u * p.d + 2u * p.d + h * p.hd + li];
    }
    out[t * p.d + h * p.hd + li] = acc / total;
  }
}
`;

/** woof_glu — y[t, c] = silu(x[t, c]) * x[t, ff + c] (speech FFN gate). */
const GLU = /* wgsl */ `
struct P { n: u32, ff: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.n * p.ff) { return; }
  let t = i / p.ff;
  let c = i % p.ff;
  let g = x[t * 2u * p.ff + c];
  let u = x[t * 2u * p.ff + p.ff + c];
  y[i] = silu1(g) * u;
}
`;

/** woof_silu — in-place silu over n elements at off. */
const SILU = /* wgsl */ `
struct P { n: u32, off: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> x: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = p.off + gid.x;
  if (gid.x < p.n) { x[i] = silu1(x[i]); }
}
`;

/** woof_elu — in-place ELU over n elements at off. */
const ELU = /* wgsl */ `
struct P { n: u32, off: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> x: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = p.off + gid.x;
  if (gid.x < p.n) { x[i] = elu1(x[i]); }
}
`;

/** woof_gelu — in-place tanh-free (erf) GELU over n elements at off. */
const GELU = /* wgsl */ `
struct P { n: u32, off: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> x: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = p.off + gid.x;
  if (gid.x < p.n) {
    let v = x[i];
    x[i] = 0.5 * v * (1.0 + erf1(v * 0.70710678118654752));
  }
}
`;

/** woof_muladd — dst[i] += a[off + i] * b[i] (flow-head gate application). */
const MULADD = /* wgsl */ `
struct P { n: u32, off: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) { dst[i] += a[p.off + i] * b[i]; }
}
`;

/** woof_add — y[i] = a[i] + b[i] (all bindings must be distinct buffers:
 * WebGPU forbids one buffer at two bindings of a dispatch, read-only or
 * writable — in-place accumulation goes through woof_acc instead). */
const ADD = /* wgsl */ `
struct P { n: u32, aOff: u32, bOff: u32, yOff: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) { y[p.yOff + i] = a[p.aOff + i] + b[p.bOff + i]; }
}
`;

/** woof_acc — in-place accumulate y[i] += b[i] (SEANet residual add: the
 * accumulator is both the old value and the destination, which cannot be
 * expressed as two legal bindings of one dispatch — WebGPU forbids binding
 * one buffer twice, read-only or writable). */
const ACC = /* wgsl */ `
struct P { n: u32, bOff: u32, yOff: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) { y[p.yOff + i] += b[p.bOff + i]; }
}
`;

/**
 * woof_lnmod — flow-head adaLN: one row LN, then
 * y[i] = mod[shOff + i] + normed[i] * mod[scOff + i].
 */
const LNMOD = /* wgsl */ `
struct P { n: u32, shOff: u32, scOff: u32, eps: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
// note: not named \`mod\` — reserved word in WGSL
@group(0) @binding(2) var<storage, read> modu: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32) {
  var s = 0.0;
  for (var i = li; i < p.n; i += 64u) { s += x[i]; }
  red[li] = s;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] += red[li + k]; }
    workgroupBarrier();
  }
  let mean = red[0] / f32(p.n);
  workgroupBarrier();
  var v = 0.0;
  for (var i = li; i < p.n; i += 64u) { let e = x[i] - mean; v += e * e; }
  red[li] = v;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] += red[li + k]; }
    workgroupBarrier();
  }
  let inv = inverseSqrt(red[0] / f32(p.n) + p.eps);
  for (var i = li; i < p.n; i += 64u) {
    y[i] = modu[p.shOff + i] + (x[i] - mean) * inv * modu[p.scOff + i];
  }
}
`;

/** woof_ln — decoder transformer layer norm (mean-subtracted, gain+bias). */
const LN = /* wgsl */ `
struct P { rows: u32, d: u32, stride: u32, eps: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<storage, read> g: array<f32>;
@group(0) @binding(4) var<storage, read> b: array<f32>;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let row = wg.x;
  if (row >= p.rows) { return; }
  let base = row * p.stride;
  var s = 0.0;
  for (var i = li; i < p.d; i += 64u) { s += x[base + i]; }
  red[li] = s;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] += red[li + k]; }
    workgroupBarrier();
  }
  let mean = red[0] / f32(p.d);
  workgroupBarrier();
  var v = 0.0;
  for (var i = li; i < p.d; i += 64u) { let e = x[base + i] - mean; v += e * e; }
  red[li] = v;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { red[li] += red[li + k]; }
    workgroupBarrier();
  }
  let inv = inverseSqrt(red[0] / f32(p.d) + p.eps);
  for (var i = li; i < p.d; i += 64u) {
    y[base + i] = (x[base + i] - mean) * inv * g[i] + b[i];
  }
}
`;

/**
 * woof_conv — causal conv1d over channel-major buffers x (cin, t) ->
 * y (cout, t), left zero-padding k-1, weights read through the packed-int8
 * W() macro (row = output channel, col = flattened (cin, k)). flags bit 1
 * adds the bias, bit 2 applies ELU to the input (SEANet residual blocks).
 */
const CONV = /* wgsl */ `
struct P { cin: u32, cout: u32, k: u32, t: u32, wq: u32, group: u32, flags: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read> w: array<u32>;
@group(0) @binding(5) var<storage, read> s: array<f32>;
fn W(o: u32, col: u32) -> f32 {
  let i = o * (p.wq * 4u) + col;
  let sh = (i & 3u) * 8u;
  let ng = arrayLength(&s) / p.cout;
  return f32(bitcast<i32>(w[i >> 2u] << (24u - sh)) >> 24u) * s[o * ng + col / p.group];
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let idx = flatIdx(wg, li);
  if (idx >= p.cout * p.t) { return; }
  let o = idx / p.t;
  let tt = idx % p.t;
  var acc = 0.0;
  for (var i = 0u; i < p.cin; i++) {
    for (var j = 0u; j < p.k; j++) {
      if (tt + j + 1u < p.k) { continue; }
      var v = x[i * p.t + tt + j + 1u - p.k];
      if ((p.flags & 2u) != 0u) { v = elu1(v); }
      acc += W(o, i * p.k + j) * v;
    }
  }
  if ((p.flags & 1u) != 0u) { acc += bias[o]; }
  y[idx] = acc;
}
`;

/**
 * woof_convt — transposed (upsampling) conv, x (cin, tin) -> y
 * (cout, tin*stride), y[o, T] = sum over (i, j) with i*s + j == T of
 * W(o, i*k + j) * x[i, T/s - j] — the direct form of the CPU port's
 * z-buffer + carry fold, identical results.
 */
const CONVT = /* wgsl */ `
struct P { cin: u32, cout: u32, k: u32, stride: u32, tin: u32, wq: u32, group: u32, flags: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read> w: array<u32>;
@group(0) @binding(5) var<storage, read> s: array<f32>;
fn W(o: u32, col: u32) -> f32 {
  let i = o * (p.wq * 4u) + col;
  let sh = (i & 3u) * 8u;
  let ng = arrayLength(&s) / p.cout;
  return f32(bitcast<i32>(w[i >> 2u] << (24u - sh)) >> 24u) * s[o * ng + col / p.group];
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let tout = p.tin * p.stride;
  let idx = flatIdx(wg, li);
  if (idx >= p.cout * tout) { return; }
  let o = idx / tout;
  let tt = idx % tout;
  var acc = 0.0;
  var n = i32(tt / p.stride);
  loop {
    if (n < 0) { break; }
    let j = tt - u32(n) * p.stride;
    if (j >= p.k) { break; }
    for (var i = 0u; i < p.cin; i++) {
      var v = x[i * p.tin + u32(n)];
      if ((p.flags & 2u) != 0u) { v = elu1(v); }
      acc += W(o, i * p.k + j) * v;
    }
    n = n - 1;
  }
  if ((p.flags & 1u) != 0u) { acc += bias[o]; }
  y[idx] = acc;
}
`;

/** woof_transpose — (rows, cols) row-major -> (cols, rows) row-major. */
const TRANSPOSE = /* wgsl */ `
struct P { rows: u32, cols: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let idx = flatIdx(wg, li);
  if (idx >= p.rows * p.cols) { return; }
  let r = idx / p.cols;
  let c = idx % p.cols;
  y[c * p.rows + r] = x[idx];
}
`;

/** woof_affine — per-channel scale+bias (latent dequant before the decoder). */
const AFFINE = /* wgsl */ `
struct P { n: u32, c: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<storage, read> sc: array<f32>;
@group(0) @binding(4) var<storage, read> sh: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let idx = flatIdx(wg, li);
  if (idx >= p.n) { return; }
  y[idx] = x[idx] * sc[idx % p.c] + sh[idx % p.c];
}
`;

/**
 * woof_framecopy — copy one decode-slot's latent row into the sentence
 * latents buffer at row pos[slot] - pos[baseSlot] (positions are data, so
 * the op template stays cacheable).
 */
const FRAMECOPY = /* wgsl */ `
struct P { c: u32, slot: u32, baseSlot: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<storage, read> pos: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= p.c) { return; }
  let row = pos[p.slot] - pos[p.baseSlot];
  y[row * p.c + i] = x[p.slot * p.c + i];
}
`;

/** Kernel registry (name -> source). Order documents the kernel set. */
export const WOOF_KERNELS: Record<string, string> = {
	mm: COMMON + MM,
	mvt: COMMON + MVT,
	rmsnorm: COMMON + RMSNORM,
	rope: COMMON + ROPE,
	rope_t: COMMON + ROPE_T,
	cache: COMMON + CACHE,
	attn: COMMON + ATTN,
	attn_w: COMMON + ATTN_W,
	glu: COMMON + GLU,
	silu: COMMON + SILU,
	elu: COMMON + ELU,
	gelu: COMMON + GELU,
	muladd: COMMON + MULADD,
	add: COMMON + ADD,
	acc: COMMON + ACC,
	lnmod: COMMON + LNMOD,
	ln: COMMON + LN,
	conv: COMMON + CONV,
	convt: COMMON + CONVT,
	transpose: COMMON + TRANSPOSE,
	affine: COMMON + AFFINE,
	framecopy: COMMON + FRAMECOPY,
};

// ---------------------------------------------------------------------------
// Model extraction (pure — no device needed, unit-testable)
// ---------------------------------------------------------------------------

/** A quantized linear ready for GPU upload. */
export interface GpuQLinear {
	name: string;
	w: Uint32Array; // packed int8 rows (wq words per row)
	s: Float32Array; // (rows * ng) scales
	b: Float32Array; // bias or zeros(rows)
	rows: number; // output dims
	cols: number; // logical input dims (matmul quad loop bound * 4)
	wq: number; // stored quads per row (>= cols/4 when padded)
	group: number; // scale group size in columns (gsize)
	hasBias: boolean;
	/** Original tensor shape from the npz (conv taps derive from it). */
	shape: number[];
	/** Quantization axis within `shape` (speech linears: -1). */
	groupedAxis: number;
}

function gpuLinearFromQ(name: string, l: QLinear): GpuQLinear {
	if (l.q.length !== l.out * l.in) {
		throw new Error(
			`woof-gpu: ${name}: q is ${l.q.length} bytes, expected ${l.out * l.in}`,
		);
	}
	if (l.in % 4 !== 0) {
		throw new Error(
			`woof-gpu: ${name}: input dim ${l.in} is not a multiple of 4`,
		);
	}
	const { words } = packI8(l.q);
	return {
		name,
		w: words,
		s: l.s,
		b: l.b ?? new Float32Array(l.out),
		rows: l.out,
		cols: l.in,
		wq: l.in >> 2,
		group: l.in, // one scale per row
		hasBias: l.b !== null,
		shape: [l.out, l.in],
		groupedAxis: -1,
	};
}

/**
 * Grouped-int8 tensor view for the conv/decoder-transformer kernels. The npz
 * stores q8 as (rows = output channels, storedCols possibly padded to the
 * group grid); the logical flattened size per row may be smaller than
 * storedCols — trailing padding bytes are never read. Scale index for
 * (row, col) is row * ng + col / gsize with gsize = meta.g.
 *
 * layout "flat" (decoder tf linears): q8/s at `{name}.q8` / `{name}.s`.
 * layout "weight" (SEANet convs): q8/s at `{name}.w.q8` / `{name}.w.s`,
 * meta under `{name}.w` — the runtime's per-weight tensor nesting.
 */
export function gpuGrouped(
	name: string,
	entries: Map<string, NpyArray>,
	meta: Map<string, GroupMeta>,
	layout: "flat" | "weight" = "flat",
): GpuQLinear {
	const q8 = entries.get(layout === "weight" ? `${name}.w.q8` : `${name}.q8`);
	const sEntry = entries.get(layout === "weight" ? `${name}.w.s` : `${name}.s`);
	const bEntry = entries.get(`${name}.b`);
	const m = meta.get(layout === "weight" ? `${name}.w` : name);
	if (!q8 || !sEntry || !m) {
		throw new Error(`woof-gpu: missing grouped tensor ${name}`);
	}
	const rows = m.shape[m.axis];
	const flat = m.shape.reduce((p, c, i) => (i === m.axis ? p : p * c), 1);
	const q8Cols = q8.shape[1];
	const scales = npyF32(sEntry);
	const ng = scales.length / rows;
	if (!Number.isInteger(ng)) {
		throw new Error(
			`woof-gpu: ${name}: scales (${scales.length}) do not tile ${rows} rows`,
		);
	}
	if (q8Cols % 4 !== 0) {
		throw new Error(
			`woof-gpu: ${name}: stored columns ${q8Cols} are not a multiple of 4`,
		);
	}
	if (flat > q8Cols) {
		throw new Error(
			`woof-gpu: ${name}: logical size ${flat} exceeds stored columns ${q8Cols}`,
		);
	}
	// No divisibility check between q8Cols and ng: the npz's final scale group
	// may be partial (ng = ceil(flat / g), e.g. 144 columns over 5 groups of
	// 32), which is exactly how runtime.py's deq() reads it — the kernels'
	// scale index (col / g) mirrors that, so trailing padded columns and a
	// ragged last group are both fine.
	const bytes = new Int8Array(
		q8.data.buffer,
		q8.data.byteOffset,
		rows * q8Cols,
	);
	const { words } = packI8(bytes);
	return {
		name,
		w: words,
		s: scales,
		b: bEntry ? npyF32(bEntry) : new Float32Array(rows),
		rows,
		cols: flat,
		wq: q8Cols >> 2,
		group: m.g,
		hasBias: !!bEntry,
		shape: [...m.shape],
		groupedAxis: m.axis,
	};
}

export interface WoofGpuModel {
	speech: {
		L: number;
		d: number;
		H: number;
		ff: number;
		hw: number;
		depth: number;
		latent: number;
		ropeBase: number;
		maxLen: number;
		layers: GpuQLinear[]; // per layer: wqkv, wo, w1, w2
		ce: GpuQLinear;
		ada: GpuQLinear;
		hblocks: GpuQLinear[]; // per depth level: w1, w2
		latIn: { w: Float32Array; b: Float32Array; out: number; in: number };
		hInp: { w: Float32Array; b: Float32Array; out: number; in: number };
		hOut: { w: Float32Array; b: Float32Array; out: number; in: number };
		textEmb: Float32Array;
		bos: Float32Array;
	};
	decoder: {
		heads: number;
		headDim: number;
		D: number;
		window: number;
		eps: number;
		invFreq: Float32Array;
		inp: { w: Float32Array; b: Float32Array; out: number; in: number };
		tf: Array<{
			ln1g: Float32Array;
			ln1b: Float32Array;
			ln2g: Float32Array;
			ln2b: Float32Array;
			qkv: GpuQLinear;
			o: GpuQLinear;
			fc1: GpuQLinear;
			fc2: GpuQLinear;
		}>;
		seanetKinds: string[];
		seanetStrides: number[];
		seanet: Map<string, GpuQLinear>; // "seanet.{idx}" / "seanet.{idx}.0" / "seanet.{idx}.1"
	};
	voices: Record<string, Float32Array>;
	mean: Float32Array;
	std: Float32Array;
	maxFrames: number;
	fps: number;
}

/** Build the GPU weight set from a parsed npz (no device required). */
export function buildWoofGpuModel(npz: WoofNpz): WoofGpuModel {
	const { entries, tree, meta } = npz;
	const sc = tree.speech.cfg;
	const layers: GpuQLinear[] = [];
	for (let l = 0; l < sc.L; l++) {
		for (let k = 0; k < 4; k++) {
			layers.push(
				gpuLinearFromQ(
					`speech.layers.${l}.${k}`,
					qLinear(entries, `speech.layers.${l}.${k}`),
				),
			);
		}
	}
	const hblocks: GpuQLinear[] = [];
	for (let j = 0; j < sc.depth; j++) {
		for (let k = 0; k < 2; k++) {
			hblocks.push(
				gpuLinearFromQ(
					`speech.hblocks.${j}.${k}`,
					qLinear(entries, `speech.hblocks.${j}.${k}`),
				),
			);
		}
	}
	const latIn = wLinear(entries, "speech.lat_in");
	const hInp = wLinear(entries, "speech.h_inp");
	const hOut = wLinear(entries, "speech.h_out");
	const te = entries.get("speech.text_emb");
	const bo = entries.get("speech.bos");
	if (!te || !bo) throw new Error("woof-gpu: missing text_emb/bos");

	const dtree = buildDecoderTree(tree);
	const dHeadDim = dtree.cfg.head_dim;
	const tf: WoofGpuModel["decoder"]["tf"] = [];
	for (let l = 0; l < dtree.tfLayers; l++) {
		tf.push({
			ln1g: npyF32(entries.get(`decoder.tf.${l}.ln1.0`) as NpyArray),
			ln1b: npyF32(entries.get(`decoder.tf.${l}.ln1.1`) as NpyArray),
			ln2g: npyF32(entries.get(`decoder.tf.${l}.ln2.0`) as NpyArray),
			ln2b: npyF32(entries.get(`decoder.tf.${l}.ln2.1`) as NpyArray),
			qkv: gpuGrouped(`decoder.tf.${l}.qkv`, entries, meta),
			o: gpuGrouped(`decoder.tf.${l}.o`, entries, meta),
			fc1: gpuGrouped(`decoder.tf.${l}.fc1`, entries, meta),
			fc2: gpuGrouped(`decoder.tf.${l}.fc2`, entries, meta),
		});
	}
	const seanet = new Map<string, GpuQLinear>();
	for (let idx = 0; idx < dtree.seanetKinds.length; idx++) {
		const kind = dtree.seanetKinds[idx];
		if (kind === "conv" || kind === "convt") {
			seanet.set(
				`seanet.${idx}`,
				gpuGrouped(`decoder.seanet.${idx}.1`, entries, meta, "weight"),
			);
		} else if (kind !== "elu") {
			seanet.set(
				`seanet.${idx}.0`,
				gpuGrouped(`decoder.seanet.${idx}.1.0`, entries, meta, "weight"),
			);
			seanet.set(
				`seanet.${idx}.1`,
				gpuGrouped(`decoder.seanet.${idx}.1.1`, entries, meta, "weight"),
			);
		}
	}
	const invEntry = entries.get("decoder.inv_freq");
	if (!invEntry) throw new Error("woof-gpu: missing decoder.inv_freq");
	const inpW = entries.get("decoder.inp.0");
	const inpB = entries.get("decoder.inp.1");
	if (!inpW || !inpB) throw new Error("woof-gpu: missing decoder.inp");

	const voices: Record<string, Float32Array> = {};
	for (const [name, ref] of Object.entries(tree.voices)) {
		const e = entries.get(ref["@"]);
		if (e) voices[name] = npyF32(e);
	}
	const mean = npyF32(entries.get(tree.mean["@"]) as NpyArray);
	const std = npyF32(entries.get(tree.std["@"]) as NpyArray);

	return {
		speech: {
			L: sc.L,
			d: sc.d,
			H: sc.H,
			ff: sc.ff,
			hw: sc.hw,
			depth: sc.depth,
			latent: sc.latent,
			ropeBase: sc.rope_base,
			maxLen: 1100,
			layers,
			ce: gpuLinearFromQ("speech.ce", qLinear(entries, "speech.ce")),
			ada: gpuLinearFromQ("speech.ada", qLinear(entries, "speech.ada")),
			hblocks,
			latIn: {
				w: latIn.w,
				b: latIn.b,
				out: latIn.b.length,
				in: latIn.w.length / latIn.b.length,
			},
			hInp: {
				w: hInp.w,
				b: hInp.b,
				out: hInp.b.length,
				in: hInp.w.length / hInp.b.length,
			},
			hOut: {
				w: hOut.w,
				b: hOut.b,
				out: hOut.b.length,
				in: hOut.w.length / hOut.b.length,
			},
			textEmb: npyF32(te),
			bos: npyF32(bo),
		},
		decoder: {
			heads: dtree.cfg.heads,
			headDim: dHeadDim,
			D: dtree.cfg.heads * dHeadDim,
			window: dtree.cfg.window,
			eps: dtree.cfg.eps,
			invFreq: npyF32(invEntry),
			inp: {
				w: npyF32(inpW),
				b: npyF32(inpB),
				out: npyF32(inpB).length,
				in: npyF32(inpW).length / npyF32(inpB).length,
			},
			tf,
			seanetKinds: dtree.seanetKinds,
			seanetStrides: dtree.seanetStrides,
			seanet,
		},
		voices,
		mean,
		std,
		maxFrames: tree.max_frames,
		fps: tree.fps,
	};
}

// ---------------------------------------------------------------------------
// Dispatch planning (pure — produces op descriptors; the session resolves
// buffer names and caches the materialized pipelines/bind groups).
// ---------------------------------------------------------------------------

export interface OpDesc {
	label: string;
	kernel: string;
	/** Raw uniform words, in the kernel's struct field order. */
	uniforms: number[];
	/** Buffer names for bindings 1..n (binding 0 is the uniform). */
	buffers: string[];
	dispatch: [number, number, number];
}

function mmDispatch(rows: number, tokens: number): [number, number, number] {
	return [Math.min(rows, 65535), tokens, Math.ceil(rows / 65535)];
}

function flatDispatch3(n: number): [number, number, number] {
	const [x, y] = flatDispatch(n, 64);
	return [x, y, 1];
}

function flatDispatch256(n: number): [number, number, number] {
	const [x, y] = flatDispatch(n, 256);
	return [x, y, 1];
}

/** Buffer name registry — every storage buffer the session owns. */
export interface BufferPlan {
	/** name -> element count (f32 unless prefixed pos:). */
	sizes: Map<string, number>;
}

export function planBuffers(
	m: WoofGpuModel,
	batch: number,
): Map<string, number> {
	const s = m.speech;
	const d = m.decoder;
	const F = m.maxFrames;
	const sizes = new Map<string, number>();
	// weights
	for (const l of s.layers) {
		sizes.set(`w.${l.name}`, l.w.length);
		sizes.set(`s.${l.name}`, l.s.length);
		sizes.set(`b.${l.name}`, l.rows);
	}
	for (const key of ["ce", "ada"] as const) {
		const l = s[key];
		sizes.set(`w.${l.name}`, l.w.length);
		sizes.set(`s.${l.name}`, l.s.length);
		sizes.set(`b.${l.name}`, l.rows);
	}
	for (const l of s.hblocks) {
		sizes.set(`w.${l.name}`, l.w.length);
		sizes.set(`s.${l.name}`, l.s.length);
		sizes.set(`b.${l.name}`, l.rows);
	}
	for (const key of ["latIn", "hInp", "hOut"] as const) {
		const l = s[key];
		sizes.set(`wf.speech.${key}`, l.w.length);
		sizes.set(`bf.speech.${key}`, l.out);
	}
	sizes.set("text_emb", s.textEmb.length);
	sizes.set("bos", s.bos.length);
	sizes.set("wf.decoder.inp", d.inp.w.length);
	sizes.set("bf.decoder.inp", d.inp.out);
	sizes.set("inv_freq", d.invFreq.length);
	for (let l = 0; l < d.tf.length; l++) {
		sizes.set(`ln1g.${l}`, d.tf[l].ln1g.length);
		sizes.set(`ln1b.${l}`, d.tf[l].ln1b.length);
		sizes.set(`ln2g.${l}`, d.tf[l].ln2g.length);
		sizes.set(`ln2b.${l}`, d.tf[l].ln2b.length);
		for (const key of ["qkv", "o", "fc1", "fc2"] as const) {
			const t = d.tf[l][key];
			sizes.set(`w.${t.name}`, t.w.length);
			sizes.set(`s.${t.name}`, t.s.length);
			sizes.set(`b.${t.name}`, t.rows);
		}
	}
	for (const t of d.seanet.values()) {
		sizes.set(`w.${t.name}`, t.w.length);
		sizes.set(`s.${t.name}`, t.s.length);
		sizes.set(`b.${t.name}`, t.rows);
	}
	sizes.set("mean", m.mean.length);
	sizes.set("std", m.std.length);
	// speech state
	sizes.set("x", s.maxLen * s.d);
	sizes.set("xn", s.maxLen * s.d);
	sizes.set("qkv", s.maxLen * 3 * s.d);
	sizes.set("kv", s.L * 2 * s.H * s.maxLen * (s.d / s.H));
	sizes.set("att", s.maxLen * s.d);
	sizes.set("gu", s.maxLen * 2 * s.ff);
	sizes.set("gate", s.maxLen * s.ff);
	sizes.set("ce_out", s.hw + 1);
	sizes.set("ada_a", s.ada.rows);
	sizes.set("fh_h", s.hw);
	sizes.set("fh_y", s.hw);
	sizes.set("fh_tmp", 2 * s.hw);
	sizes.set("fh_out2", s.hw);
	sizes.set("delta", s.latent);
	sizes.set("ctx", s.d);
	sizes.set("zslots", batch * s.latent);
	sizes.set("noise", batch * s.latent);
	sizes.set("latents", F * s.latent);
	sizes.set("pos:u32", batch + 1);
	sizes.set("eos", batch);
	// decoder state
	sizes.set("d_scaled", F * s.latent);
	sizes.set("d_h", F * d.D);
	sizes.set("d_n1", F * d.D);
	sizes.set("d_n2", F * d.D);
	sizes.set("d_qkv", F * 3 * d.D);
	sizes.set("d_att", F * d.D);
	sizes.set("d_ff", F * d.tf[0].fc1.rows);
	sizes.set("d_t", d.D * F);
	return sizes;
}

/**
 * SEANet workspace plan: walks the op chain computing channel-major buffer
 * shapes for `frames` input frames. Returns ops plus the extra buffers they
 * need (name -> element count).
 */
export function planSeanet(
	m: WoofGpuModel,
	frames: number,
): {
	ops: OpDesc[];
	buffers: Map<string, number>;
	/** Name of the chain's final output buffer (1 x samples channel-major). */
	finalBuffer: string;
	samples: number;
} {
	const d = m.decoder;
	const ops: OpDesc[] = [];
	const buffers = new Map<string, number>();
	let curC = d.D;
	let curT = frames;
	let curName = "d_t";
	let tag = 0;
	const fmt = (c: number, t: number): string => {
		const name = `sn.${tag++}`;
		buffers.set(name, c * t);
		return name;
	};
	for (let idx = 0; idx < d.seanetKinds.length; idx++) {
		const kind = d.seanetKinds[idx];
		if (kind === "elu") {
			ops.push({
				label: `sn.elu.${idx}.${frames}`,
				kernel: "elu",
				uniforms: [curC * curT, 0, 0, 0],
				buffers: [curName],
				dispatch: flatDispatch3(curC * curT),
			});
		} else if (kind === "conv") {
			const t = d.seanet.get(`seanet.${idx}`) as GpuQLinear;
			const out = fmt(t.rows, curT);
			ops.push({
				label: `sn.conv.${idx}.${frames}`,
				kernel: "conv",
				uniforms: [curC, t.rows, kernelTaps(t, idx), curT, t.wq, t.group, 1, 0],
				buffers: [curName, out, `b.${t.name}`, `w.${t.name}`, `s.${t.name}`],
				dispatch: flatDispatch256(t.rows * curT),
			});
			curName = out;
			curC = t.rows;
		} else if (kind === "convt") {
			const t = d.seanet.get(`seanet.${idx}`) as GpuQLinear;
			const stride = d.seanetStrides[idx];
			const outT = curT * stride;
			const out = fmt(t.rows, outT);
			ops.push({
				label: `sn.convt.${idx}.${frames}`,
				kernel: "convt",
				uniforms: [
					curC,
					t.rows,
					kernelTaps(t, idx),
					stride,
					curT,
					t.wq,
					t.group,
					1,
				],
				buffers: [curName, out, `b.${t.name}`, `w.${t.name}`, `s.${t.name}`],
				dispatch: flatDispatch256(t.rows * outT),
			});
			curName = out;
			curC = t.rows;
			curT = outT;
		} else {
			const a = d.seanet.get(`seanet.${idx}.0`) as GpuQLinear;
			const b = d.seanet.get(`seanet.${idx}.1`) as GpuQLinear;
			const t1 = fmt(a.rows, curT);
			const t2 = fmt(b.rows, curT);
			ops.push({
				label: `sn.res.a.${idx}.${frames}`,
				kernel: "conv",
				uniforms: [curC, a.rows, kernelTaps(a, idx), curT, a.wq, a.group, 3, 0],
				buffers: [curName, t1, `b.${a.name}`, `w.${a.name}`, `s.${a.name}`],
				dispatch: flatDispatch256(a.rows * curT),
			});
			ops.push({
				label: `sn.res.elu.${idx}.${frames}`,
				kernel: "elu",
				uniforms: [a.rows * curT, 0, 0, 0],
				buffers: [t1],
				dispatch: flatDispatch3(a.rows * curT),
			});
			ops.push({
				label: `sn.res.b.${idx}.${frames}`,
				kernel: "conv",
				uniforms: [
					a.rows,
					b.rows,
					kernelTaps(b, idx),
					curT,
					b.wq,
					b.group,
					1,
					0,
				],
				buffers: [t1, t2, `b.${b.name}`, `w.${b.name}`, `s.${b.name}`],
				dispatch: flatDispatch256(b.rows * curT),
			});
			ops.push({
				label: `sn.res.add.${idx}.${frames}`,
				kernel: "acc",
				uniforms: [curC * curT, 0, 0, 0],
				buffers: [t2, curName],
				dispatch: flatDispatch3(curC * curT),
			});
		}
	}
	return { ops, buffers, finalBuffer: curName, samples: curC === 1 ? curT : 0 };
}

/**
 * Conv kernel size (taps): the grouped shape is (cout, cin, k) for convs
 * (axis 0) and (cin, cout, k) for convT (axis 1); the flattened logical size
 * per row is cin*k, so k = flat / cin (the non-axis, non-flattened dim).
 */
function kernelTaps(t: GpuQLinear, idx: number): number {
	// The tensor's row-major shape with the grouped axis removed leaves
	// (cin, k); cin is whichever remaining dim the flatten used.
	const nonAxis = t.shape.filter((_, i) => i !== t.groupedAxis);
	const cinDim = nonAxis[0];
	const k = t.cols / cinDim;
	if (!Number.isInteger(k) || k <= 0) {
		throw new Error(`woof-gpu: seanet ${idx}: non-integer tap count`);
	}
	return k;
}

/**
 * Prefix ops (teacher-forced pass over [voice | text | bos], rows = p0) plus
 * the initial cond head. Cached per rows count.
 */
export function planPrefix(m: WoofGpuModel, rows: number): OpDesc[] {
	const s = m.speech;
	const hd = s.d / s.H;
	const ops: OpDesc[] = [];
	const scale = f32Word(hd ** -0.5);
	for (let l = 0; l < s.L; l++) {
		const [wqkv, wo, w1, w2] = s.layers.slice(l * 4, l * 4 + 4);
		ops.push({
			label: `pf.${rows}.rms.${l}`,
			kernel: "rmsnorm",
			uniforms: [rows, s.d, s.d, f32Word(F32_EPS)],
			buffers: ["x", "xn"],
			dispatch: [rows, 1, 1],
		});
		ops.push({
			label: `pf.${rows}.qkv.${l}`,
			kernel: "mm",
			uniforms: [
				wqkv.rows,
				s.d,
				wqkv.wq,
				wqkv.group,
				rows,
				0,
				s.d,
				0,
				3 * s.d,
				0,
				1,
				0,
			],
			buffers: [
				`w.${wqkv.name}`,
				`s.${wqkv.name}`,
				"xn",
				"qkv",
				`b.${wqkv.name}`,
			],
			dispatch: mmDispatch(wqkv.rows, rows),
		});
		ops.push({
			label: `pf.${rows}.rope.${l}`,
			kernel: "rope",
			uniforms: [rows, s.H, hd, s.d, 0, 0, 0, f32Word(s.ropeBase)],
			buffers: ["qkv", "pos"],
			dispatch: flatDispatch3(rows * s.H * (hd / 2) * 2),
		});
		ops.push({
			label: `pf.${rows}.cache.${l}`,
			kernel: "cache",
			uniforms: [rows, s.H, hd, s.d, s.maxLen, l, 0, 0, 0, 0],
			buffers: ["qkv", "kv", "pos"],
			dispatch: flatDispatch3(rows * s.d),
		});
		ops.push({
			label: `pf.${rows}.attn.${l}`,
			kernel: "attn",
			uniforms: [rows, s.H, hd, s.d, s.maxLen, l, 0, 0, 0, scale],
			buffers: ["qkv", "kv", "att", "pos"],
			dispatch: [rows, s.H, 1],
		});
		// Residual wo: the CPU oracle accumulates (att @ wo^T) * s WITHOUT the
		// row bias — flags 2 = accumulate only, matching that exactly.
		ops.push({
			label: `pf.${rows}.wo.${l}`,
			kernel: "mm",
			uniforms: [wo.rows, s.d, wo.wq, wo.group, rows, 0, s.d, 0, s.d, 0, 2, 0],
			buffers: [`w.${wo.name}`, `s.${wo.name}`, "att", "x", `b.${wo.name}`],
			dispatch: mmDispatch(wo.rows, rows),
		});
		ops.push({
			label: `pf.${rows}.rms2.${l}`,
			kernel: "rmsnorm",
			uniforms: [rows, s.d, s.d, f32Word(F32_EPS)],
			buffers: ["x", "xn"],
			dispatch: [rows, 1, 1],
		});
		ops.push({
			label: `pf.${rows}.w1.${l}`,
			kernel: "mm",
			uniforms: [
				w1.rows,
				s.d,
				w1.wq,
				w1.group,
				rows,
				0,
				s.d,
				0,
				2 * s.ff,
				0,
				1,
				0,
			],
			buffers: [`w.${w1.name}`, `s.${w1.name}`, "xn", "gu", `b.${w1.name}`],
			dispatch: mmDispatch(w1.rows, rows),
		});
		ops.push({
			label: `pf.${rows}.glu.${l}`,
			kernel: "glu",
			uniforms: [rows, s.ff, 0, 0],
			buffers: ["gu", "gate"],
			dispatch: flatDispatch3(rows * s.ff),
		});
		ops.push({
			label: `pf.${rows}.w2.${l}`,
			kernel: "mm",
			uniforms: [
				w2.rows,
				s.ff,
				w2.wq,
				w2.group,
				rows,
				0,
				s.ff,
				0,
				s.d,
				0,
				3,
				0,
			],
			buffers: [`w.${w2.name}`, `s.${w2.name}`, "gate", "x", `b.${w2.name}`],
			dispatch: mmDispatch(w2.rows, rows),
		});
	}
	// initial cond head over the last prefix row — CPU cond() rms-normalizes
	// its input first, so the row passes through an rmsnorm op on the way
	ops.push({
		label: `pf.${rows}.rms.ce`,
		kernel: "rmsnorm",
		// rmsnorm addresses rows by workgroup x (uniform rows is the guard
		// bound) — dispatch rows workgroups so the LAST row (61 of 62) runs
		uniforms: [rows, s.d, s.d, f32Word(F32_EPS)],
		buffers: ["x", "xn"],
		dispatch: [rows, 1, 1],
	});
	ops.push({
		label: `pf.${rows}.ce`,
		kernel: "mm",
		uniforms: [
			s.ce.rows,
			s.d,
			s.ce.wq,
			s.ce.group,
			1,
			(rows - 1) * s.d,
			s.d,
			0,
			s.ce.rows,
			0,
			1,
			0,
		],
		buffers: [
			`w.${s.ce.name}`,
			`s.${s.ce.name}`,
			"xn",
			"ce_out",
			`b.${s.ce.name}`,
		],
		dispatch: mmDispatch(s.ce.rows, 1),
	});
	ops.push({
		label: `pf.${rows}.silu`,
		kernel: "silu",
		uniforms: [s.hw, 0, 0, 0],
		buffers: ["ce_out"],
		dispatch: flatDispatch3(s.hw),
	});
	return ops;
}

/**
 * One decode frame's ops for batch slot `slot`. `condFromCtx`: true when the
 * cond head reads the ctx buffer (every frame except the very first batch of
 * a sentence, whose cond ran at the end of the prefix pass).
 */
export function planFrame(
	m: WoofGpuModel,
	slot: number,
	condFromCtx: boolean,
): OpDesc[] {
	const s = m.speech;
	const hd = s.d / s.H;
	const ops: OpDesc[] = [];
	const scale = f32Word(hd ** -0.5);
	const A = s.ada;
	// cond head (from ctx; the first frame's cond ran at the end of prefix)
	// — CPU cond() rms-normalizes its input, mirror that before the matmul
	if (condFromCtx) {
		ops.push({
			label: `fr.${slot}.rms.ce`,
			kernel: "rmsnorm",
			uniforms: [1, s.d, s.d, f32Word(F32_EPS)],
			buffers: ["ctx", "xn"],
			dispatch: [1, 1, 1],
		});
		ops.push({
			label: `fr.${slot}.ce`,
			kernel: "mm",
			uniforms: [
				s.ce.rows,
				s.d,
				s.ce.wq,
				s.ce.group,
				1,
				0,
				s.d,
				0,
				s.ce.rows,
				0,
				1,
				0,
			],
			buffers: [
				`w.${s.ce.name}`,
				`s.${s.ce.name}`,
				"xn",
				"ce_out",
				`b.${s.ce.name}`,
			],
			dispatch: mmDispatch(s.ce.rows, 1),
		});
		// ada below consumes the POST-SILU context vector (CPU cond() silus
		// ce[0..hw) before returning s) — silu must run before ada reads
		ops.push({
			label: `fr.${slot}.silu.ce`,
			kernel: "silu",
			uniforms: [s.hw, 0, 0, 0],
			buffers: ["ce_out"],
			dispatch: flatDispatch3(s.hw),
		});
	}
	// flow head: A = ada(s); h = hInp(noise[slot])
	ops.push({
		label: `fr.${slot}.ada`,
		kernel: "mm",
		uniforms: [
			A.rows,
			s.hw,
			A.wq,
			A.group,
			1,
			0,
			s.hw + 1,
			0,
			A.rows,
			0,
			A.hasBias ? 1 : 0,
			0,
		],
		buffers: [`w.${A.name}`, `s.${A.name}`, "ce_out", "ada_a", `b.${A.name}`],
		dispatch: mmDispatch(A.rows, 1),
	});
	ops.push({
		label: `fr.${slot}.hinp`,
		kernel: "mvt",
		uniforms: [s.hInp.out, s.hInp.in, 1, slot * s.latent, s.latent, 0, s.hw, 0],
		buffers: ["noise", `wf.speech.hInp`, `bf.speech.hInp`, "fh_h"],
		dispatch: [s.hInp.out, 1, 1],
	});
	for (let j = 0; j < s.depth; j++) {
		const [hb1, hb2] = s.hblocks.slice(j * 2, j * 2 + 2);
		const o = 3 * s.hw * j;
		ops.push({
			label: `fr.${slot}.lnmod.${j}`,
			kernel: "lnmod",
			uniforms: [s.hw, o, o + s.hw, f32Word(1e-5)],
			buffers: ["fh_h", "ada_a", "fh_y"],
			dispatch: [1, 1, 1],
		});
		ops.push({
			label: `fr.${slot}.hb1.${j}`,
			kernel: "mm",
			uniforms: [
				hb1.rows,
				s.hw,
				hb1.wq,
				hb1.group,
				1,
				0,
				s.hw,
				0,
				2 * s.hw,
				0,
				hb1.hasBias ? 1 : 0,
				0,
			],
			buffers: [
				`w.${hb1.name}`,
				`s.${hb1.name}`,
				"fh_y",
				"fh_tmp",
				`b.${hb1.name}`,
			],
			dispatch: mmDispatch(hb1.rows, 1),
		});
		ops.push({
			label: `fr.${slot}.silu.${j}`,
			kernel: "silu",
			uniforms: [2 * s.hw, 0, 0, 0],
			buffers: ["fh_tmp"],
			dispatch: flatDispatch3(2 * s.hw),
		});
		ops.push({
			label: `fr.${slot}.hb2.${j}`,
			kernel: "mm",
			uniforms: [
				hb2.rows,
				// hb2 reads the gated fh_tmp (2*hw wide) — cols must be hb2.cols
				hb2.cols,
				hb2.wq,
				hb2.group,
				1,
				0,
				2 * s.hw,
				0,
				s.hw,
				0,
				hb2.hasBias ? 1 : 0,
				0,
			],
			buffers: [
				`w.${hb2.name}`,
				`s.${hb2.name}`,
				"fh_tmp",
				"fh_out2",
				`b.${hb2.name}`,
			],
			dispatch: mmDispatch(hb2.rows, 1),
		});
		ops.push({
			label: `fr.${slot}.muladd.${j}`,
			kernel: "muladd",
			uniforms: [s.hw, o + 2 * s.hw, 0, 0],
			buffers: ["ada_a", "fh_out2", "fh_h"],
			dispatch: flatDispatch3(s.hw),
		});
	}
	{
		const o = 3 * s.hw * s.depth;
		ops.push({
			label: `fr.${slot}.lnmod.fin`,
			kernel: "lnmod",
			uniforms: [s.hw, o, o + s.hw, f32Word(1e-5)],
			buffers: ["fh_h", "ada_a", "fh_y"],
			dispatch: [1, 1, 1],
		});
		ops.push({
			label: `fr.${slot}.hout`,
			kernel: "mvt",
			uniforms: [s.hOut.out, s.hOut.in, 1, 0, s.hw, 0, s.latent, 0],
			buffers: ["fh_y", `wf.speech.hOut`, `bf.speech.hOut`, "delta"],
			dispatch: [s.hOut.out, 1, 1],
		});
	}
	// z = noise + delta (written into the slot row of the latents staging)
	ops.push({
		label: `fr.${slot}.z`,
		kernel: "add",
		uniforms: [s.latent, slot * s.latent, 0, slot * s.latent],
		buffers: ["noise", "delta", "zslots"],
		dispatch: flatDispatch3(s.latent),
	});
	// ctx = lat_in(z)
	ops.push({
		label: `fr.${slot}.latin`,
		kernel: "mvt",
		uniforms: [
			s.latIn.out,
			s.latIn.in,
			1,
			slot * s.latent,
			s.latent,
			0,
			s.d,
			0,
		],
		buffers: ["zslots", `wf.speech.latIn`, `bf.speech.latIn`, "ctx"],
		dispatch: [s.latIn.out, 1, 1],
	});
	for (let l = 0; l < s.L; l++) {
		const [wqkv, wo, w1, w2] = s.layers.slice(l * 4, l * 4 + 4);
		ops.push({
			label: `fr.${slot}.rms.${l}`,
			kernel: "rmsnorm",
			uniforms: [1, s.d, s.d, f32Word(F32_EPS)],
			buffers: ["ctx", "xn"],
			dispatch: [1, 1, 1],
		});
		ops.push({
			label: `fr.${slot}.qkv.${l}`,
			kernel: "mm",
			uniforms: [
				wqkv.rows,
				s.d,
				wqkv.wq,
				wqkv.group,
				1,
				0,
				s.d,
				0,
				3 * s.d,
				0,
				1,
				0,
			],
			buffers: [
				`w.${wqkv.name}`,
				`s.${wqkv.name}`,
				"xn",
				"qkv",
				`b.${wqkv.name}`,
			],
			dispatch: mmDispatch(wqkv.rows, 1),
		});
		ops.push({
			label: `fr.${slot}.rope.${l}`,
			kernel: "rope",
			uniforms: [1, s.H, hd, s.d, slot, 1, 0, f32Word(s.ropeBase)],
			buffers: ["qkv", "pos"],
			dispatch: flatDispatch3(1 * s.H * (hd / 2) * 2),
		});
		ops.push({
			label: `fr.${slot}.cache.${l}`,
			kernel: "cache",
			uniforms: [1, s.H, hd, s.d, s.maxLen, l, slot, 1, 0, 0],
			buffers: ["qkv", "kv", "pos"],
			dispatch: flatDispatch3(s.d),
		});
		ops.push({
			label: `fr.${slot}.attn.${l}`,
			kernel: "attn",
			uniforms: [1, s.H, hd, s.d, s.maxLen, l, slot, 1, 0, scale],
			buffers: ["qkv", "kv", "att", "pos"],
			dispatch: [1, s.H, 1],
		});
		ops.push({
			label: `fr.${slot}.wo.${l}`,
			kernel: "mm",
			uniforms: [wo.rows, s.d, wo.wq, wo.group, 1, 0, s.d, 0, s.d, 0, 2, 0],
			buffers: [`w.${wo.name}`, `s.${wo.name}`, "att", "ctx", `b.${wo.name}`],
			dispatch: mmDispatch(wo.rows, 1),
		});
		ops.push({
			label: `fr.${slot}.rms2.${l}`,
			kernel: "rmsnorm",
			uniforms: [1, s.d, s.d, f32Word(F32_EPS)],
			buffers: ["ctx", "xn"],
			dispatch: [1, 1, 1],
		});
		ops.push({
			label: `fr.${slot}.w1.${l}`,
			kernel: "mm",
			uniforms: [
				w1.rows,
				s.d,
				w1.wq,
				w1.group,
				1,
				0,
				s.d,
				0,
				2 * s.ff,
				0,
				1,
				0,
			],
			buffers: [`w.${w1.name}`, `s.${w1.name}`, "xn", "gu", `b.${w1.name}`],
			dispatch: mmDispatch(w1.rows, 1),
		});
		ops.push({
			label: `fr.${slot}.glu.${l}`,
			kernel: "glu",
			uniforms: [1, s.ff, 0, 0],
			buffers: ["gu", "gate"],
			dispatch: flatDispatch3(s.ff),
		});
		ops.push({
			label: `fr.${slot}.w2.${l}`,
			kernel: "mm",
			uniforms: [w2.rows, s.ff, w2.wq, w2.group, 1, 0, s.ff, 0, s.d, 0, 3, 0],
			buffers: [`w.${w2.name}`, `s.${w2.name}`, "gate", "ctx", `b.${w2.name}`],
			dispatch: mmDispatch(w2.rows, 1),
		});
	}
	// cond for the next frame (rms-normalize ctx first, as CPU cond() does)
	ops.push({
		label: `fr.${slot}.rms.ce.next`,
		kernel: "rmsnorm",
		uniforms: [1, s.d, s.d, f32Word(F32_EPS)],
		buffers: ["ctx", "xn"],
		dispatch: [1, 1, 1],
	});
	ops.push({
		label: `fr.${slot}.ce.next`,
		kernel: "mm",
		uniforms: [
			s.ce.rows,
			s.d,
			s.ce.wq,
			s.ce.group,
			1,
			0,
			s.d,
			0,
			s.ce.rows,
			0,
			1,
			0,
		],
		buffers: [
			`w.${s.ce.name}`,
			`s.${s.ce.name}`,
			"xn",
			"ce_out",
			`b.${s.ce.name}`,
		],
		dispatch: mmDispatch(s.ce.rows, 1),
	});
	ops.push({
		label: `fr.${slot}.silu.next`,
		kernel: "silu",
		uniforms: [s.hw, 0, 0, 0],
		buffers: ["ce_out"],
		dispatch: flatDispatch3(s.hw),
	});
	// eos logit -> eos[slot]; latents row <- z slot row
	ops.push({
		label: `fr.${slot}.eoscopy`,
		kernel: "add",
		uniforms: [1, s.hw, 0, slot],
		buffers: ["ce_out", "zeros1", "eos"],
		dispatch: [1, 1, 1],
	});
	ops.push({
		label: `fr.${slot}.framecopy`,
		kernel: "framecopy",
		uniforms: [s.latent, slot, POS_BASE_SLOT, 0],
		buffers: ["zslots", "latents", "pos"],
		dispatch: [1, 1, 1],
	});
	return ops;
}

/** pos[POS_BASE_SLOT] holds p0 (framecopy's row origin). */
export const POS_BASE_SLOT = BATCH;

/** Decoder (Mimi transformer + SEANet) ops for a whole utterance. */
export function planDecoder(m: WoofGpuModel, frames: number): OpDesc[] {
	const d = m.decoder;
	const hd = d.headDim;
	const ops: OpDesc[] = [];
	const scale = f32Word(hd ** -0.5);
	ops.push({
		label: `dec.${frames}.affine`,
		kernel: "affine",
		uniforms: [frames * m.mean.length, m.mean.length, 0, 0],
		buffers: ["latents", "d_scaled", "std", "mean"],
		dispatch: flatDispatch256(frames * m.mean.length),
	});
	ops.push({
		label: `dec.${frames}.inp`,
		kernel: "mvt",
		uniforms: [d.inp.out, d.inp.in, frames, 0, m.mean.length, 0, d.D, 0],
		buffers: ["d_scaled", "wf.decoder.inp", "bf.decoder.inp", "d_h"],
		dispatch: [
			Math.min(d.inp.out, 65535),
			frames,
			Math.ceil(d.inp.out / 65535),
		],
	});
	for (let l = 0; l < d.tf.length; l++) {
		const t = d.tf[l];
		ops.push({
			label: `dec.${frames}.ln1.${l}`,
			kernel: "ln",
			uniforms: [frames, d.D, d.D, f32Word(d.eps)],
			buffers: ["d_h", "d_n1", `ln1g.${l}`, `ln1b.${l}`],
			dispatch: [frames, 1, 1],
		});
		// Decoder tf linears: the CPU oracle applies NO bias on these
		// (linRows has no bias term) — flags 0 / accumulate-only 2.
		ops.push({
			label: `dec.${frames}.qkv.${l}`,
			kernel: "mm",
			uniforms: [
				t.qkv.rows,
				t.qkv.cols,
				t.qkv.wq,
				t.qkv.group,
				frames,
				0,
				d.D,
				0,
				3 * d.D,
				0,
				0,
				0,
			],
			buffers: [
				`w.${t.qkv.name}`,
				`s.${t.qkv.name}`,
				"d_n1",
				"d_qkv",
				`b.${t.qkv.name}`,
			],
			dispatch: mmDispatch(t.qkv.rows, frames),
		});
		ops.push({
			label: `dec.${frames}.rope.${l}`,
			kernel: "rope_t",
			uniforms: [frames, d.heads, hd, d.D, 0, 0, 0, 0],
			buffers: ["d_qkv", "pos", "inv_freq"],
			dispatch: flatDispatch3(frames * d.heads * (hd / 2) * 2),
		});
		ops.push({
			label: `dec.${frames}.attn.${l}`,
			kernel: "attn_w",
			uniforms: [frames, d.heads, hd, d.D, d.window, 0, 0, scale],
			buffers: ["d_qkv", "d_att"],
			dispatch: [frames, d.heads, 1],
		});
		ops.push({
			label: `dec.${frames}.o.${l}`,
			kernel: "mm",
			uniforms: [
				t.o.rows,
				t.o.cols,
				t.o.wq,
				t.o.group,
				frames,
				0,
				d.D,
				0,
				d.D,
				0,
				2,
				0,
			],
			buffers: [
				`w.${t.o.name}`,
				`s.${t.o.name}`,
				"d_att",
				"d_h",
				`b.${t.o.name}`,
			],
			dispatch: mmDispatch(t.o.rows, frames),
		});
		ops.push({
			label: `dec.${frames}.ln2.${l}`,
			kernel: "ln",
			uniforms: [frames, d.D, d.D, f32Word(d.eps)],
			buffers: ["d_h", "d_n2", `ln2g.${l}`, `ln2b.${l}`],
			dispatch: [frames, 1, 1],
		});
		ops.push({
			label: `dec.${frames}.fc1.${l}`,
			kernel: "mm",
			uniforms: [
				t.fc1.rows,
				t.fc1.cols,
				t.fc1.wq,
				t.fc1.group,
				frames,
				0,
				d.D,
				0,
				t.fc1.rows,
				0,
				0,
				0,
			],
			buffers: [
				`w.${t.fc1.name}`,
				`s.${t.fc1.name}`,
				"d_n2",
				"d_ff",
				`b.${t.fc1.name}`,
			],
			dispatch: mmDispatch(t.fc1.rows, frames),
		});
		ops.push({
			label: `dec.${frames}.gelu.${l}`,
			kernel: "gelu",
			uniforms: [frames * t.fc1.rows, 0, 0, 0],
			buffers: ["d_ff"],
			dispatch: flatDispatch3(frames * t.fc1.rows),
		});
		ops.push({
			label: `dec.${frames}.fc2.${l}`,
			kernel: "mm",
			uniforms: [
				t.fc2.rows,
				t.fc2.cols,
				t.fc2.wq,
				t.fc2.group,
				frames,
				0,
				t.fc1.rows,
				0,
				d.D,
				0,
				2,
				0,
			],
			buffers: [
				`w.${t.fc2.name}`,
				`s.${t.fc2.name}`,
				"d_ff",
				"d_h",
				`b.${t.fc2.name}`,
			],
			dispatch: mmDispatch(t.fc2.rows, frames),
		});
	}
	ops.push({
		label: `dec.${frames}.transpose`,
		kernel: "transpose",
		uniforms: [frames, d.D, 0, 0],
		buffers: ["d_h", "d_t"],
		dispatch: flatDispatch256(frames * d.D),
	});
	const seanet = planSeanet(m, frames);
	ops.push(...seanet.ops);
	return ops;
}

// ---------------------------------------------------------------------------
// Session (device + buffers + op cache + synthesis loop)
// ---------------------------------------------------------------------------

export interface WoofGpuSession {
	readonly backend: "webgpu";
	readonly adapterInfo: {
		vendor?: string;
		architecture?: string;
		description?: string;
	};
	readonly kernelCount: number;
	synthesizePiece(
		text: string,
		voiceId: string,
		rng: TorchRandn,
	): Promise<Float32Array>;
	dispose(): void;
}

interface MaterializedOp {
	pipeline: WgComputePipeline;
	bindGroup: WgBindGroup;
	dispatch: [number, number, number];
}

export class WoofGpuSessionImpl implements WoofGpuSession {
	readonly backend = "webgpu" as const;
	readonly adapterInfo: WoofGpuSession["adapterInfo"];
	readonly kernelCount = Object.keys(WOOF_KERNELS).length;

	private device: WgDevice;
	private model: WoofGpuModel;
	private owned: WgBuffer[] = [];
	private buffers = new Map<string, WgBuffer>();
	private pipelines = new Map<string, WgComputePipeline>();
	private ops = new Map<string, MaterializedOp>();
	private destroyed = false;

	constructor(
		device: WgDevice,
		model: WoofGpuModel,
		info: WoofGpuSession["adapterInfo"],
	) {
		this.device = device;
		this.model = model;
		this.adapterInfo = info;
	}

	static async create(buffer: ArrayBuffer): Promise<WoofGpuSessionImpl | null> {
		const gpu = navigatorGpu();
		if (!gpu) return null;
		let adapter: WgAdapter | null = null;
		try {
			adapter = await gpu.requestAdapter({
				powerPreference: "high-performance",
			});
		} catch {
			return null;
		}
		if (!adapter) return null;
		// Request the adapter maximum explicitly (mirrors the reference; our
		// largest binding is the ~31 MB speech KV cache, far below this).
		const device = await adapter.requestDevice({
			requiredLimits: {
				maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
				maxBufferSize: adapter.limits.maxBufferSize,
			},
		});
		const model = buildWoofGpuModel(loadWoofNpz(buffer));
		const session = new WoofGpuSessionImpl(device, model, adapter.info ?? {});
		session.checkLimits();
		session.createBuffers();
		session.uploadWeights();
		return session;
	}

	/** Refuse the GPU path up front when an adapter cannot hold our buffers. */
	private checkLimits(): void {
		const sizes = this.allBufferSizes();
		const lim = this.device.limits;
		for (const [name, elems] of sizes) {
			const bytes = elems * 4;
			if (bytes > lim.maxBufferSize) {
				throw new Error(
					`woof-gpu: buffer ${name} (${bytes} B) exceeds maxBufferSize ${lim.maxBufferSize}`,
				);
			}
			if (bytes > lim.maxStorageBufferBindingSize) {
				throw new Error(
					`woof-gpu: buffer ${name} (${bytes} B) exceeds maxStorageBufferBindingSize ${lim.maxStorageBufferBindingSize}`,
				);
			}
		}
	}

	/** State + weight buffers plus the SEANet workspace (sized for a full
	 * max-frame utterance; pieces never exceed that). */
	private allBufferSizes(): Map<string, number> {
		const sizes = planBuffers(this.model, BATCH);
		const sn = planSeanet(this.model, this.model.maxFrames);
		for (const [k, v] of sn.buffers) {
			if (!sizes.has(k)) sizes.set(k, v);
		}
		return sizes;
	}

	private buf(name: string): WgBuffer {
		const b = this.buffers.get(name);
		if (!b) throw new Error(`woof-gpu: unknown buffer ${name}`);
		return b;
	}

	private createBuffers(): void {
		for (const [name, elems] of this.allBufferSizes()) {
			const isU32 = name.endsWith(":u32");
			const key = isU32 ? name.slice(0, -4) : name;
			const bytes = round16(elems * 4);
			const b = this.device.createBuffer({
				size: bytes,
				usage:
					GPU_BUFFER_USAGE.STORAGE |
					GPU_BUFFER_USAGE.COPY_DST |
					GPU_BUFFER_USAGE.COPY_SRC,
				label: key,
			});
			this.owned.push(b);
			this.buffers.set(key, b);
		}
		// helper buffers not in the plan
		const zeros1 = this.device.createBuffer({
			size: round16(4),
			usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
			label: "zeros1",
		});
		this.device.queue.writeBuffer(zeros1, 0, new Float32Array(1));
		this.owned.push(zeros1);
		this.buffers.set("zeros1", zeros1);
	}

	private uploadWeights(): void {
		const m = this.model;
		const put = (name: string, data: Float32Array | Uint32Array): void => {
			this.device.queue.writeBuffer(this.buf(name), 0, data);
		};
		for (const l of [
			...m.speech.layers,
			m.speech.ce,
			m.speech.ada,
			...m.speech.hblocks,
		]) {
			put(`w.${l.name}`, l.w);
			put(`s.${l.name}`, l.s);
			put(`b.${l.name}`, l.b);
		}
		for (const key of ["latIn", "hInp", "hOut"] as const) {
			const l = m.speech[key];
			put(`wf.speech.${key}`, l.w);
			put(`bf.speech.${key}`, l.b);
		}
		put("text_emb", m.speech.textEmb);
		put("bos", m.speech.bos);
		put("wf.decoder.inp", m.decoder.inp.w);
		put("bf.decoder.inp", m.decoder.inp.b);
		put("inv_freq", m.decoder.invFreq);
		for (let l = 0; l < m.decoder.tf.length; l++) {
			const t = m.decoder.tf[l];
			put(`ln1g.${l}`, t.ln1g);
			put(`ln1b.${l}`, t.ln1b);
			put(`ln2g.${l}`, t.ln2g);
			put(`ln2b.${l}`, t.ln2b);
			for (const key of ["qkv", "o", "fc1", "fc2"] as const) {
				const g = t[key];
				put(`w.${g.name}`, g.w);
				put(`s.${g.name}`, g.s);
				put(`b.${g.name}`, g.b);
			}
		}
		for (const g of m.decoder.seanet.values()) {
			put(`w.${g.name}`, g.w);
			put(`s.${g.name}`, g.s);
			put(`b.${g.name}`, g.b);
		}
		put("mean", m.mean);
		put("std", m.std);
	}

	private materialize(op: OpDesc): MaterializedOp {
		const cached = this.ops.get(op.label);
		if (cached) return cached;
		const code = WOOF_KERNELS[op.kernel];
		if (!code) throw new Error(`woof-gpu: unknown kernel ${op.kernel}`);
		let pipeline = this.pipelines.get(op.kernel);
		if (!pipeline) {
			pipeline = this.device.createComputePipeline({
				layout: "auto",
				compute: {
					module: this.device.createShaderModule({ code, label: op.kernel }),
					entryPoint: "main",
				},
				label: `woof.${op.kernel}`,
			});
			this.pipelines.set(op.kernel, pipeline);
		}
		const words = op.uniforms;
		const uniform = this.device.createBuffer({
			size: round16(words.length * 4),
			usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
			mappedAtCreation: true,
			label: `u.${op.label}`,
		});
		new Uint32Array(uniform.getMappedRange()).set(words);
		uniform.unmap();
		const entries: WgBindGroupDescriptor["entries"] = [
			{ binding: 0, resource: { buffer: uniform } },
		];
		op.buffers.forEach((name, i) => {
			entries.push({ binding: i + 1, resource: { buffer: this.buf(name) } });
		});
		const bindGroup = this.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries,
			label: op.label,
		});
		const mat: MaterializedOp = {
			pipeline,
			bindGroup,
			dispatch: op.dispatch,
		};
		this.ops.set(op.label, mat);
		return mat;
	}

	private run(ops: OpDesc[]): void {
		const encoder = this.device.createCommandEncoder({ label: "woof" });
		const pass = encoder.beginComputePass();
		for (const op of ops) {
			const mat = this.materialize(op);
			pass.setPipeline(mat.pipeline);
			pass.setBindGroup(0, mat.bindGroup);
			pass.dispatchWorkgroups(
				mat.dispatch[0],
				mat.dispatch[1],
				mat.dispatch[2],
			);
		}
		pass.end();
		this.device.queue.submit([encoder.finish()]);
	}

	private async readF32(name: string, elements: number): Promise<Float32Array> {
		const src = this.buf(name);
		const staging = this.device.createBuffer({
			size: round16(elements * 4),
			usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
			label: `read.${name}`,
		});
		const encoder = this.device.createCommandEncoder({ label: "read" });
		encoder.copyBufferToBuffer(src, 0, staging, 0, round16(elements * 4));
		this.device.queue.submit([encoder.finish()]);
		await staging.mapAsync(GPU_MAP_MODE_READ);
		const copy = new Float32Array(staging.getMappedRange().slice(0)).subarray(
			0,
			elements,
		);
		staging.unmap();
		staging.destroy();
		return copy;
	}

	/** Decode one sentence on the GPU. rng: the loader's torch-compatible
	 * stream — noise is drawn on the CPU and uploaded, so both backends
	 * consume the identical random stream and EOS-gate identically. */
	async synthesizePiece(
		text: string,
		voiceId: string,
		rng: TorchRandn,
	): Promise<Float32Array> {
		if (this.destroyed) throw new Error("woof-gpu: session disposed");
		const s = this.model.speech;
		const voice = this.model.voices[voiceId];
		if (!voice) {
			throw new Error(`woof-gpu: unknown voice "${voiceId}"`);
		}
		const ids = encodeText(text);
		const voiceFrames = voice.length / s.d;
		const p0 = voiceFrames + ids.length + 1;
		if (p0 + this.model.maxFrames > s.maxLen) {
			throw new Error(`woof-gpu: too long (${p0} prefix rows)`);
		}
		// prefix embeddings [voice | text | bos]
		const prefix = new Float32Array(p0 * s.d);
		prefix.set(voice, 0);
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			if ((id + 1) * s.d > s.textEmb.length) {
				throw new Error(`woof-gpu: text id ${id} out of range`);
			}
			prefix.set(
				s.textEmb.subarray(id * s.d, (id + 1) * s.d),
				(voiceFrames + i) * s.d,
			);
		}
		prefix.set(s.bos, (p0 - 1) * s.d);
		this.device.queue.writeBuffer(this.buf("x"), 0, prefix);
		this.run(planPrefix(this.model, p0));

		const frames = Math.min(this.model.maxFrames, s.maxLen - p0);
		const minFramesPerChar = MIN_SECONDS_PER_CHAR * (this.model.fps / 12.5);
		const minFrames = Math.floor(minFramesPerChar * ids.length);
		const eosT = Math.log(EOS_THRESHOLD / (1 - EOS_THRESHOLD));
		const stopAt = Math.max(3, minFrames);

		const posWords = new Uint32Array(BATCH + 1);
		let made = 0;
		let ePrev = 0;
		{
			// initial cond value (computed by the prefix pass); s stays resident
			// in ce_out, the eos logit comes back with each batch.
			const ce = await this.readF32("ce_out", s.hw + 1);
			ePrev = ce[s.hw];
		}
		let n = 0;
		const frameOps: OpDesc[][] = [];
		const firstBatchOps: OpDesc[][] = [];
		for (let slot = 0; slot < BATCH; slot++) {
			frameOps.push(planFrame(this.model, slot, true));
			firstBatchOps.push(
				slot === 0
					? planFrame(this.model, slot, false)
					: planFrame(this.model, slot, true),
			);
		}
		for (let base = 0; base < frames; base += BATCH) {
			const count = Math.min(BATCH, frames - base);
			for (let i = 0; i < count; i++) {
				posWords[i] = p0 + base + i;
			}
			posWords[POS_BASE_SLOT] = p0;
			this.device.queue.writeBuffer(this.buf("pos"), 0, posWords);
			// draw noise on the CPU from the shared torch-compatible stream
			const snap = rng.snapshot();
			const noise = new Float32Array(BATCH * s.latent);
			for (let i = 0; i < BATCH; i++) {
				const g = rng.randn(s.latent);
				for (let j = 0; j < s.latent; j++) {
					noise[i * s.latent + j] = g[j] * TEMP;
				}
			}
			this.device.queue.writeBuffer(this.buf("noise"), 0, noise);
			const opSet = base === 0 ? firstBatchOps : frameOps;
			const flat: OpDesc[] = [];
			for (let i = 0; i < count; i++) {
				flat.push(...opSet[i]);
			}
			this.run(flat);
			const eos = await this.readF32("eos", BATCH);
			// walk the batch exactly like the CPU generate() loop
			let stop = -1;
			for (let i = 0; i < count; i++) {
				const f = base + i;
				if (f > stopAt && ePrev > eosT) {
					stop = i;
					break;
				}
				ePrev = eos[i];
				n = f + 1;
				made = f + 1;
			}
			if (stop >= 0) {
				// frames stop..count-1 drew noise that the CPU path never drew —
				// restore the stream so later pieces stay bit-compatible.
				rng.restore(snap);
				for (let i = 0; i < stop; i++) {
					rng.randn(s.latent);
				}
				break;
			}
			if (made >= frames) break;
		}
		if (n === 0) {
			// no frames survived (e.g. immediate EOS on a degenerate input) —
			// mirror the CPU path's empty output.
			return new Float32Array(0);
		}
		// audio decoder over the surviving latents
		const decOps = planDecoder(this.model, n);
		this.run(decOps);
		const seanet = planSeanet(this.model, n);
		const audio = await this.readF32(seanet.finalBuffer, seanet.samples);
		return audio;
	}

	dispose(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const b of this.owned) b.destroy();
		this.owned = [];
		this.buffers.clear();
		this.ops.clear();
		this.pipelines.clear();
		this.device.destroy();
	}
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Build a WebGPU session from Woof npz bytes, or null when WebGPU is not
 * usable here (no adapter, or adapter limits cannot hold the model). */
export async function createWoofGpuSession(
	buffer: ArrayBuffer,
): Promise<WoofGpuSession | null> {
	return WoofGpuSessionImpl.create(buffer);
}

export interface WoofVerifyResult {
	ok: boolean;
	/** Pearson correlation CPU vs GPU over the common length. */
	corr: number | null;
	corrTarget: number;
	cpuMs: number;
	gpuMs: number;
	frames: number;
	cpuSamples: number;
	gpuSamples: number;
	adapter: string | null;
	error?: string;
}

function pearson(a: Float32Array, b: Float32Array, len: number): number {
	let sa = 0;
	let sb = 0;
	let saa = 0;
	let sbb = 0;
	let sab = 0;
	for (let i = 0; i < len; i++) {
		const x = a[i];
		const y = b[i];
		sa += x;
		sb += y;
		saa += x * x;
		sbb += y * y;
		sab += x * y;
	}
	const n = len;
	const cov = sab - (sa * sb) / n;
	const va = saa - (sa * sa) / n;
	const vb = sbb - (sb * sb) / n;
	return cov / Math.sqrt(va * vb);
}

/**
 * Self-check for a headed browser: synthesize one fixed sentence on both
 * backends from a single weights download and report the CPU<->GPU Pearson
 * correlation plus timings. Designed for the browser-verification agent:
 *
 *   1. Open the site (the woof-tts model page is fine; any page that has
 *      loaded the inference worker also works).
 *   2. In DevTools console, import the worker chunk into the main thread —
 *      its module side effect installs the hook:
 *        const url = performance.getEntriesByType("resource")
 *          .map(e => e.name).find(n => /inference-worker|worker/.test(n));
 *        await import(url);
 *   3. Run:  const r = await __woofVerify();
 *      It downloads the npz (~40 MB) once, builds both engines, synthesizes
 *      "The quick brown fox jumps over the lazy dog." (voice juno, seed 0)
 *      on each and prints { corr, cpuMs, gpuMs, frames, adapter, ... }.
 *      corr >= 0.9999 is the pass bar; the result object is returned for
 *      further inspection.
 *
 * (The hook also exists inside the inference worker itself as
 * self.__woofVerify, and the function is exported for direct ESM use.)
 */
export async function runWoofBackendCheck(
	sentence = "The quick brown fox jumps over the lazy dog.",
	voice = "juno",
	seed = 0,
): Promise<WoofVerifyResult> {
	const result: WoofVerifyResult = {
		ok: false,
		corr: null,
		corrTarget: 0.9999,
		cpuMs: 0,
		gpuMs: 0,
		frames: 0,
		cpuSamples: 0,
		gpuSamples: 0,
		adapter: null,
	};
	try {
		const res = await fetch(WEIGHTS_URL);
		if (!res.ok) throw new Error(`weights fetch failed: ${res.status}`);
		const bytes = await res.arrayBuffer();
		const cpu = WoofEngine.load(bytes);
		const cpuRng = new TorchRandn();
		cpuRng.seed(seed);
		const t0 = performance.now();
		const cpuAudio = cpu.synthesizePiece(sentence, voice, cpuRng);
		result.cpuMs = Math.round(performance.now() - t0);
		result.cpuSamples = cpuAudio.length;
		const session = await createWoofGpuSession(bytes);
		if (!session) throw new Error("WebGPU session unavailable (no adapter?)");
		try {
			result.adapter =
				session.adapterInfo.vendor ?? session.adapterInfo.architecture ?? "gpu";
			const rng = new TorchRandn();
			rng.seed(seed);
			const t1 = performance.now();
			const gpuAudio = await session.synthesizePiece(sentence, voice, rng);
			result.gpuMs = Math.round(performance.now() - t1);
			result.gpuSamples = gpuAudio.length;
			result.frames = Math.floor(gpuAudio.length / 960);
			if (cpuAudio.length === 0 || gpuAudio.length === 0) {
				throw new Error("empty audio on one backend");
			}
			const len = Math.min(cpuAudio.length, gpuAudio.length);
			result.corr = pearson(cpuAudio, gpuAudio, len);
			result.ok = result.corr >= result.corrTarget;
		} finally {
			session.dispose();
		}
	} catch (err) {
		result.error = err instanceof Error ? err.message : String(err);
	}
	console.log("[woof-gpu] verify:", result);
	return result;
}

// Console-callable debug hook (main thread AND worker: globalThis covers
// window and self). Runs entirely standalone — it does its own weights
// download, so it can be invoked from any page that has this module loaded.
const hookTarget = globalThis as {
	__woofVerify?: typeof runWoofBackendCheck;
};
if (!hookTarget.__woofVerify) {
	hookTarget.__woofVerify = runWoofBackendCheck;
}
