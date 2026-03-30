# WebGPU vs WASM Backend Compatibility for Browser TTS/STT Models

## Executive Summary

TTSLab runs TTS and STT models entirely in the browser via ONNX Runtime Web. Each model can use one of two backends: **WASM** (CPU-based, universally supported) or **WebGPU** (GPU-accelerated, faster for large models). Not all models support WebGPU. The root cause is a fundamental limitation in the WebGPU Shading Language (WGSL): **it has no 64-bit integer type**. Since the ONNX specification requires INT64 for many shape and metadata operations, models that rely on these ops cannot be lowered to WebGPU shaders. This document explains how backend selection works, which models are affected, and how to evaluate new models for WebGPU compatibility.

---

## How Backend Selection Works

Backend selection runs **inside the Web Worker** (not the main thread), because `navigator.gpu` is available in workers. The logic lives in `src/lib/inference/backend-select.ts` and is invoked by `src/lib/inference/inference-worker.ts` during the `load` command.

### Three-Layer Selection

The worker resolves the backend through three layers of preference:

```
1. Explicit user preference (from UI or API)
   └─ "wasm" → use WASM immediately, no probing
   └─ "webgpu" → probe GPU adapter, throw if unavailable
   └─ "auto" → fall through to layer 2

2. Model preferred backend (loader.getPreferredBackend())
   └─ e.g. Supertonic-2 returns "wasm" even though it supports WebGPU
   └─ If no preference or "auto" → fall through to layer 3

3. Auto-detect
   └─ If model supports WebGPU → probe navigator.gpu.requestAdapter()
   └─ If adapter available → use WebGPU
   └─ Otherwise → fall back to WASM
```

### Key Functions on ModelLoader

Each loader declares its backend capabilities:

- **`getSupportedBackends()`** — returns `["webgpu", "wasm"]` or `["wasm"]`. This is the hard constraint: if WebGPU is not listed, it will never be attempted.
- **`getPreferredBackend()`** — optional. Returns `"webgpu"`, `"wasm"`, or `"auto"`. Used when the user selects "auto" to override the default probe-based selection. Models with known WebGPU issues (precision artifacts, etc.) use this to default to WASM while still allowing explicit WebGPU selection.

### Worker Integration

In `inference-worker.ts`, the load handler resolves the backend before calling `loader.load()`:

```typescript
const supported = loader.getSupportedBackends?.() ?? ["wasm"];
const preferred = loader.getPreferredBackend?.() ?? "auto";
const effectivePreference = cmd.options.backend === "auto" ? preferred : cmd.options.backend;
const backend = await selectBackend(
  supported.includes("webgpu"),
  supported.includes("wasm"),
  effectivePreference,
);
```

The resolved backend is passed into `loader.load({ backend })` and reported back to the main thread in the `loaded` response.

---

## The WebGPU Compatibility Problem

### WGSL Has No INT64 Type

This is the root cause of most WebGPU incompatibilities in browser ML inference.

**The constraint chain:**

1. **WGSL** (the WebGPU Shading Language) only supports `i32` and `u32` integer types. There is no `i64` or `u64`.
2. **The ONNX specification** requires INT64 for many common operations: `Shape` outputs INT64 tensors, `Unsqueeze` and `Gather` use INT64 axes, `Cast` converts between INT64 and other types.
3. **ONNX Runtime's WebGPU Execution Provider** (JSEP-based) has no INT64 `Cast` kernel. When it encounters an INT64 operation, it cannot generate a WGSL shader for it.
4. **The result**: a catch-22. The ONNX model requires INT64 ops that physically cannot be expressed in WGSL.

This is not a temporary implementation gap — it is a language-level limitation. The WebGPU community is aware of this:

- **Tracking issue**: [gpuweb/gpuweb#5152](https://github.com/gpuweb/gpuweb/issues/5152) discusses adding 64-bit integer support to WGSL
- **Potential workaround**: Emulating INT64 via `vec2<u32>` (two 32-bit values), but ONNX Runtime has not adopted this approach

### Operator Coverage Gaps

Beyond INT64, the WebGPU EP only supports a subset of ONNX operators. The canonical list is maintained in the ONNX Runtime repo at `js/web/docs/webgpu-operators.md`. Models using unsupported operators will fail at session creation time. There is no partial fallback — if any operator in the graph is unsupported by the WebGPU EP, the entire model must use WASM.

Common unsupported patterns:
- Custom/contrib operators (some transformers.js v4 models use these)
- Certain attention variants and normalization layers
- Operations with dynamic shapes that can't be statically compiled to shaders

### WebGPU Precision Issues

Even when all operators are supported, WebGPU execution can produce different results than WASM due to floating-point precision differences:

- **FP16/FP32 mixing**: WebGPU may execute certain ops at reduced precision
- **Shader compilation differences**: GPU drivers may reorder or fuse operations differently than CPU execution
- **Quantization sensitivity**: Models quantized to Q8 or Q4 may amplify precision differences

Concrete examples in TTSLab:
- **Supertonic-2**: All ops are supported on WebGPU and inference runs without errors, but the output audio has audible artifacts (clicks, distortion). The loader defaults to WASM via `getPreferredBackend() → "wasm"`.
- **Whisper Large V3 Q8 decoder**: Produces gibberish transcriptions on WebGPU. The Q4 variant works correctly — the Q8 quantization interacts badly with WebGPU precision.

---

## Current Model Compatibility Matrix

| Model | Type | WebGPU | WASM | Preferred | Why |
|-------|------|--------|------|-----------|-----|
| Kokoro 82M | TTS | YES | YES | auto | Pure float ops, small model, all ops supported |
| Supertonic 2 | TTS | YES* | YES | wasm | Works but precision issues cause audio artifacts |
| SpeechT5 | TTS | NO | YES | wasm | Architecture uses ops unsupported by WebGPU EP |
| Piper | TTS | NO | YES | wasm | VITS architecture, piper-web framework is WASM-only |
| Chatterbox | TTS | NO | YES | wasm | INT64 Cast kernel missing — Shape/Unsqueeze need INT64 |
| Chatterbox Turbo | TTS | NO | YES | wasm | Same INT64 issue as Chatterbox |
| Whisper (all) | STT | YES | YES | auto | Encoder-decoder, float-heavy, well-supported ops |
| Moonshine (all) | STT | YES | YES | auto | Clean architecture, all ops supported |

\* Supertonic-2 technically supports WebGPU (listed in `getSupportedBackends()`), but `getPreferredBackend()` returns `"wasm"` to avoid audio artifacts. Users can still force WebGPU via explicit selection.

### Loader Source Reference

| Model | Loader file | `getSupportedBackends()` |
|-------|-------------|--------------------------|
| Kokoro 82M | `src/lib/inference/loaders/kokoro.ts` | `["webgpu", "wasm"]` |
| Supertonic 2 | `src/lib/inference/loaders/supertonic.ts` | `["webgpu", "wasm"]` |
| SpeechT5 | `src/lib/inference/loaders/speecht5.ts` | `["wasm"]` |
| Piper | `src/lib/inference/loaders/piper.ts` | `["wasm"]` |
| Chatterbox / Turbo | `src/lib/inference/loaders/chatterbox.ts` | `["wasm"]` |
| Whisper | `src/lib/inference/loaders/whisper.ts` | `["webgpu", "wasm"]` |
| Moonshine | `src/lib/inference/loaders/moonshine.ts` | `["webgpu", "wasm"]` |

---

## What Makes a Model WebGPU-Compatible?

Use this checklist when evaluating a new model for WebGPU support:

### 1. No INT64 Operations

Check the ONNX graph for INT64 usage:

```python
import onnx
model = onnx.load("model.onnx")
ops = {n.op_type for n in model.graph.node}
print("Operators:", ops)

# Check for INT64 in initializers and value_info
for vi in list(model.graph.value_info) + list(model.graph.input) + list(model.graph.output):
    if vi.type.tensor_type.elem_type == onnx.TensorProto.INT64:
        print(f"INT64 tensor: {vi.name}")
```

If `Shape`, `Unsqueeze`, `Gather` (on axes), or `Cast` (to/from INT64) appear, WebGPU is likely blocked.

### 2. All Operators in webgpu-operators.md

Cross-reference the model's operator set against the [supported operators list](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md). Any missing operator blocks the entire model.

### 3. No Custom or Contrib Operators

WebGPU EP does not support `com.microsoft` domain contrib ops. Some transformers.js v4 model conversions introduce these. Check:

```python
for n in model.graph.node:
    if n.domain and n.domain != "":
        print(f"Non-standard op: {n.domain}::{n.op_type}")
```

### 4. Float Precision Tolerance

The model must produce acceptable output at WebGPU's floating-point precision. This can only be verified empirically — run the model on both backends and compare output quality. For TTS, listen to the audio. For STT, compare transcription accuracy.

### 5. Model Size Within GPU Buffer Limits

WebGPU has per-buffer size limits (`maxBufferSize`, typically 256MB-1GB depending on the device). Very large models may exceed these limits or cause GPU OOM. The `getWebGPUDiagnostics()` function in `backend-select.ts` reports these limits.

### 6. ONNX Opset Version

Higher opset versions may introduce operators not yet supported by the WebGPU EP. Check the model's opset version and compare against what ONNX Runtime Web's current release supports.

---

## The Chatterbox WebGPU Investigation (Case Study)

This is a detailed account of the TTSL-5 investigation, which illustrates why E2E browser testing is non-negotiable.

### Timeline

**Phase 1: Initial Implementation**

Added WebGPU support to `chatterbox.ts` with a backend selector UI. The code compiled, unit tests passed, and the loader reported WebGPU as supported. At this point, the feature appeared complete.

**Phase 2: Browser Testing Reveals INT64 Errors**

Running the model in a real browser with WebGPU produced console errors:

```
Error: [WebGPU] Kernel not found: Cast (INT64 -> FLOAT)
Error: Unsupported data type: INT64
```

The Chatterbox architecture uses `Shape` nodes that output INT64 tensors, which are then consumed by `Unsqueeze` and `Gather` operations. These are fundamental to the model's dynamic shape handling.

**Phase 3: Attempted ONNX Graph Patching**

`scripts/fix-chatterbox-webgpu.py` was written to rewrite the ONNX graph:
- Clear stale `value_info` entries with INT64 annotations
- Upgrade the opset version to support INT32 `Shape` output via the `dtype` attribute
- Attempt to reroute INT64 tensors through INT32 paths

The script successfully modified the graph structure, but the fix was fundamentally insufficient. The ONNX specification **requires** INT64 for `Shape` output in opsets below 19, and even with opset 21's optional INT32 `Shape` output, downstream operations (`Unsqueeze` axes, `Gather` indices) still expect INT64.

**Phase 4: Resolution**

The investigation concluded that this is an unsolvable limitation of the current WebGPU EP:

- Chatterbox marked as WASM-only (`getSupportedBackends() → ["wasm"]`)
- Comment in loader explains the root cause and links to TTSL-5
- `CLAUDE.md` updated with the model compatibility matrix

### Lesson Learned

**Code compilation is not validation.** The WebGPU backend can be selected, the model can begin loading, and ONNX Runtime can start session creation — all without error. The INT64 kernel failure only surfaces when the execution graph is actually compiled to WGSL shaders. This is why every model integration requires E2E browser testing with actual audio output verification.

---

## Performance: WebGPU vs WASM

### When WebGPU Wins

- **Large encoder-decoder models** (Whisper, Moonshine): 2-10x speedup. The encoder's matrix multiplications and attention layers map well to GPU parallelism.
- **Batch processing**: GPU throughput scales better with batch size than CPU.
- **Models >100M parameters**: The overhead of GPU context setup is amortized by faster inference.

### When WASM Is Competitive

- **Small models** (<100M params, e.g. Kokoro 82M): The overhead of transferring data to/from GPU memory offsets any compute advantage.
- **First inference**: WASM benefits from the JIT warm-up pass (the worker runs a dummy inference after loading). WebGPU shader compilation happens on first use and cannot be pre-warmed the same way.
- **Sequential short inferences**: If each inference is very fast (sub-second), the GPU dispatch overhead dominates.

### Known WebGPU Performance Issues

- **Memory overhead**: WebGPU sessions consume more memory than WASM due to GPU buffer allocation. On devices with limited VRAM, this can cause OOM.
- **Tensor disposal**: ONNX Runtime Web's WebGPU tensor disposal is imperfect. Repeated inferences can leak GPU memory, eventually causing session failure. The worker `dispose` command attempts to clean up, but some leaks persist.
- **Cold start**: The first WebGPU inference includes shader compilation time, which can be significant (1-3 seconds for complex models). Subsequent inferences are faster due to shader caching.

### Benchmarks (from verified testing)

| Model | Backend | Load Time | Generation Time | Notes |
|-------|---------|-----------|-----------------|-------|
| Kokoro 82M | WASM | ~249s | ~2.4s | Includes download time |
| Chatterbox Turbo | WASM | ~181s | ~6.3s | ~720MB download |
| Kokoro 82M | WebGPU | Not benchmarked | Expected ~1-2s | Small model, marginal GPU benefit |
| Whisper Large V3 | WebGPU | Not benchmarked | Expected 2-5x faster | Large encoder benefits most from GPU |

---

## How to Add WebGPU Support to a New Model

### Step 1: Check ONNX Graph for INT64 Operations

```bash
python -c "
import onnx
m = onnx.load('model.onnx', load_external_data=False)
ops = {n.op_type for n in m.graph.node}
print('Operators:', sorted(ops))
int64_tensors = [vi.name for vi in m.graph.value_info
                 if vi.type.tensor_type.elem_type == onnx.TensorProto.INT64]
print(f'INT64 tensors: {len(int64_tensors)}')
for t in int64_tensors[:10]:
    print(f'  {t}')
"
```

If INT64 tensors are present in shape-related operations, stop here — WebGPU is blocked.

### Step 2: Cross-Reference Operators

Compare the model's operator set against [webgpu-operators.md](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md). Every op must be listed.

### Step 3: Declare Support in Loader

```typescript
getSupportedBackends(): ("webgpu" | "wasm")[] {
    return ["webgpu", "wasm"];
}
```

### Step 4: Test in Browser with Auto Backend

Run the model in a real browser (not headless — headless Playwright has no GPU adapter). Open the browser console and watch for:
- `[backend-select] WebGPU available:` — confirms GPU probe succeeded
- Any ONNX Runtime errors about unsupported kernels or data types
- `INT64`, `Cast`, `unsupported operator` in error messages

### Step 5: Compare Audio/Transcription Quality

Run the same input on both backends and compare output:
- **TTS**: Listen for artifacts, clicks, distortion, or unnatural prosody on WebGPU
- **STT**: Compare transcription accuracy (word error rate) between backends

### Step 6: Set Preferred Backend

If WebGPU works but has quality issues:

```typescript
getSupportedBackends(): ("webgpu" | "wasm")[] {
    return ["webgpu", "wasm"];  // keep WebGPU as an option
}

getPreferredBackend(): "webgpu" | "wasm" | "auto" {
    return "wasm";  // but default to WASM for quality
}
```

If WebGPU is completely broken (INT64 errors, unsupported ops):

```typescript
getSupportedBackends(): ("webgpu" | "wasm")[] {
    return ["wasm"];  // remove WebGPU entirely
}
```

### Step 7: Document the Decision

Add a comment in the loader explaining why WebGPU is supported/unsupported. Future developers should not have to re-investigate.

---

## Future Outlook

### WGSL INT64 Support

The [gpuweb/gpuweb#5152](https://github.com/gpuweb/gpuweb/issues/5152) proposal discusses adding 64-bit integer types to WGSL. If adopted, this would remove the primary blocker for models like Chatterbox. However:
- Timeline is unknown — WGSL spec changes move slowly
- Browser implementations would follow months after spec finalization
- ONNX Runtime would need to update its WebGPU EP to use the new types

### INT64 Emulation

ONNX Runtime could emulate INT64 via `vec2<u32>` (packing two 32-bit values). This approach:
- Does not require spec changes
- Has performance overhead (every INT64 op becomes multiple 32-bit ops)
- Has not been prioritized by the ONNX Runtime team as of early 2026

### Transformers.js v4 Improvements

`@huggingface/transformers` v4 includes an improved WebGPU runtime with more supported architectures. As the library matures, more model architectures will work out-of-the-box on WebGPU without custom loader workarounds.

### Practical Expectation

For the near term (2026), expect WASM to remain the reliable default for all models. WebGPU is a performance optimization for compatible models, not a replacement. The `auto` backend selection with per-model `getPreferredBackend()` overrides is the right architecture — it allows gradual WebGPU adoption as compatibility improves.

---

## References

| Resource | URL |
|----------|-----|
| ONNX Runtime WebGPU operators | [github.com/microsoft/onnxruntime/.../webgpu-operators.md](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md) |
| WGSL INT64 proposal | [github.com/gpuweb/gpuweb/issues/5152](https://github.com/gpuweb/gpuweb/issues/5152) |
| WGSL spec (type system) | [w3.org/TR/WGSL/#types](https://www.w3.org/TR/WGSL/#types) |
| Transformers.js v4 blog | [huggingface.co/blog/transformersjs-v4](https://huggingface.co/blog/transformersjs-v4) |

### TTSLab Source Files

| File | Purpose |
|------|---------|
| `src/lib/inference/backend-select.ts` | WebGPU/WASM probing and selection logic |
| `src/lib/inference/inference-worker.ts` | Worker event loop, backend resolution during load |
| `src/lib/inference/types.ts` | `ModelLoader` interface with `getSupportedBackends()` / `getPreferredBackend()` |
| `src/lib/inference/loaders/*.ts` | Per-model backend declarations and rationale |
| `scripts/fix-chatterbox-webgpu.py` | Failed attempt to patch Chatterbox ONNX graph for WebGPU |
