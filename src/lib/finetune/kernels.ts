/**
 * Finetune Lab WGSL kernels — a hand-written fp32 training kernel set over
 * the raw WebGPU API (no typegpu/onnxruntime dependency), following the
 * device + buffer + dispatch patterns of the site's Woof WebGPU backend but
 * written fresh for this module (nothing imported from it).
 *
 * The set is 9 kernels (`Object.keys(FT_KERNELS).length` — asserted in
 * plan.test.ts). They are dispatched 22 times per training step: 3 forward
 * matmuls + 2 tanh, 1 output delta, 6 weight/bias-grad reductions, 2
 * input-grad matmuls + 2 tanh backward, 6 Adam updates — real forward +
 * backprop + Adam, all on the GPU.
 *
 * All kernels are named ft_*; every entry point is `main`; binding 0 is a
 * plain u32/f32 scalar uniform (packed by plan.ts), storage buffers follow.
 * Uniform structs are plain scalar lists — plan.ts packs the words in exactly
 * this field order (u32 fields direct, f32 fields bit-cast).
 */

const COMMON = /* wgsl */ `
fn tanh1(x: f32) -> f32 {
  // Stable exp form — identical to the CPU reference in mlp.ts.
  let e = exp(-2.0 * abs(x));
  return select(-1.0, 1.0, x >= 0.0) * (1.0 - e) / (1.0 + e);
}
`;

/**
 * ft_mm — fp32 matmul y[t,o] = Σ_j x[t,j]·W[o,j] + b[o]. One workgroup
 * (64 lanes) per (output, token); lanes stride the input dim, then
 * tree-reduce in shared memory. Serves all three forward layers.
 */
const MM = /* wgsl */ `
struct P { out: u32, cols: u32, tokens: u32, pad0: u32 }
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
  var acc = 0.0;
  for (var j = li; j < p.cols; j += 64u) { acc += w[o * p.cols + j] * x[t * p.cols + j]; }
  part[li] = acc;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { part[li] += part[li + k]; }
    workgroupBarrier();
  }
  if (li == 0u) { y[t * p.out + o] = part[0] + b[o]; }
}
`;

/**
 * ft_wgrad — weight gradient gW[r,c] = Σ_t d[t,r]·a[t,c] (overwritten, not
 * accumulated: each gradient tensor is produced by exactly one dispatch per
 * step, so there is nothing to zero between steps). One workgroup per row;
 * lanes own columns and loop the batch serially. Also serves bias grads by
 * passing a ones-vector as `a` (cols = 1).
 */
const WGRAD = /* wgsl */ `
struct P { rows: u32, cols: u32, tokens: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> d: array<f32>;
@group(0) @binding(2) var<storage, read> a: array<f32>;
@group(0) @binding(3) var<storage, read_write> g: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let r = wg.x;
  if (r >= p.rows) { return; }
  for (var c = li; c < p.cols; c += 64u) {
    var acc = 0.0;
    for (var t = 0u; t < p.tokens; t++) { acc += d[t * p.rows + r] * a[t * p.cols + c]; }
    g[r * p.cols + c] = acc;
  }
}
`;

/**
 * ft_dgrad — backprop into the previous layer: y[t,i] = Σ_o d[t,o]·W[o,i].
 * One workgroup per token; lanes stride the previous layer's dim.
 */
const DGRAD = /* wgsl */ `
struct P { prevDim: u32, outDim: u32, tokens: u32, pad0: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> d: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  if (t >= p.tokens) { return; }
  for (var i = li; i < p.prevDim; i += 64u) {
    var acc = 0.0;
    for (var o = 0u; o < p.outDim; o++) { acc += d[t * p.outDim + o] * w[o * p.prevDim + i]; }
    y[t * p.prevDim + i] = acc;
  }
}
`;

/** ft_tanh — in-place tanh over n elements (forward activations). */
const TANH = /* wgsl */ `
struct P { n: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> x: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) { x[i] = tanh1(x[i]); }
}
`;

/**
 * ft_tanh_bwd — chain rule through tanh, in place: g[i] *= (1 - a[i]²)
 * where a is the forward activation of the same element.
 */
const TANH_BWD = /* wgsl */ `
struct P { n: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> g: array<f32>;
@group(0) @binding(2) var<storage, read> a: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) { g[i] = g[i] * (1.0 - a[i] * a[i]); }
}
`;

/**
 * ft_mse_delta — output delta and per-sample squared error in one pass:
 * delta[t] = (pred[t] - target_buf[t])·invN, err2[t] = (pred[t] - target_buf[t])².
 * (The binding is `target_buf`, not `target` — `target` is a WGSL reserved
 * keyword and made the whole pipeline invalid: shader parse error, silent
 * zero loss, no training.)
 * The loss itself is summed on the CPU from the err2 readback (the batch is
 * 128 floats — cheaper than a cross-workgroup reduction).
 */
const MSE_DELTA = /* wgsl */ `
struct P { n: u32, pad0: u32, pad1: u32, invN: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> pred: array<f32>;
@group(0) @binding(2) var<storage, read> target_buf: array<f32>;
@group(0) @binding(3) var<storage, read_write> delta: array<f32>;
@group(0) @binding(4) var<storage, read_write> err2: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) {
    let e = pred[i] - target_buf[i];
    delta[i] = e * p.invN;
    err2[i] = e * e;
  }
}
`;

/**
 * ft_sqnorm — Σ x[i]² into out[slot]: one 64-lane workgroup striding n,
 * shared-memory tree reduction. Dispatched once per gradient tensor (six
 * slots), so the CPU can sum the partials into a global gradient norm.
 */
const SQNORM = /* wgsl */ `
struct P { n: u32, outSlot: u32, pad0: u32, pad1: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
var<workgroup> part: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32) {
  var s = 0.0;
  for (var i = li; i < p.n; i += 64u) { let v = x[i]; s += v * v; }
  part[li] = s;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { part[li] += part[li + k]; }
    workgroupBarrier();
  }
  if (li == 0u) { out[p.outSlot] = part[0]; }
}
`;

/**
 * ft_adam — one Adam step over n parameters: β1/β2 exponential moving
 * averages with bias correction, then the update. bc1/bc2 = 1 - β^t are
 * computed on the CPU (exact, keeps the kernel free of pow). Dispatched once
 * per parameter tensor (6 ops, one uniform per segment — the kernel guards on
 * the segment's n, which lives in the uniform).
 */
const ADAM = /* wgsl */ `
struct P { n: u32, pad0: u32, pad1: u32, lr: f32, b1: f32, b2: f32, bc1: f32, bc2: f32, eps: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> params: array<f32>;
@group(0) @binding(2) var<storage, read> grads: array<f32>;
@group(0) @binding(3) var<storage, read_write> mom: array<f32>;
@group(0) @binding(4) var<storage, read_write> vel: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) {
    let g = grads[i];
    let m = p.b1 * mom[i] + (1.0 - p.b1) * g;
    let v = p.b2 * vel[i] + (1.0 - p.b2) * g * g;
    mom[i] = m;
    vel[i] = v;
    params[i] = params[i] - p.lr * (m / p.bc1) / (sqrt(v / p.bc2) + p.eps);
  }
}
`;

/**
 * ft_histogram — 32-bin weight histogram via atomicAdd on a u32 buffer.
 * Values below the window clamp into bin 0, above it into bin 31; NaN weights
 * (a diverged run) are skipped, so a histogram total below the parameter
 * count is itself the divergence signal. finv is precomputed on the CPU as
 * nbins / (max - min).
 */
const HISTOGRAM = /* wgsl */ `
struct P { n: u32, pad0: u32, pad1: u32, fmin: f32, finv: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> bins: array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < p.n) {
    let raw = (x[i] - p.fmin) * p.finv;
    if (raw == raw) { // NaN weights are never indexed (u32(NaN) is undefined)
      if (raw <= 0.0) {
        atomicAdd(&bins[0u], 1u);
      } else if (raw >= 31.0) {
        atomicAdd(&bins[31u], 1u);
      } else {
        atomicAdd(&bins[u32(raw)], 1u);
      }
    }
  }
}
`;

/** Kernel registry (name -> source). Order documents the kernel set. */
export const FT_KERNELS: Record<string, string> = {
	mm: COMMON + MM,
	wgrad: COMMON + WGRAD,
	dgrad: COMMON + DGRAD,
	tanh: COMMON + TANH,
	tanh_bwd: COMMON + TANH_BWD,
	mse_delta: COMMON + MSE_DELTA,
	sqnorm: COMMON + SQNORM,
	adam: COMMON + ADAM,
	histogram: COMMON + HISTOGRAM,
};

export const FT_KERNEL_COUNT = Object.keys(FT_KERNELS).length;
