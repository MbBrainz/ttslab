# TTSLab Development Learnings

Hard-won lessons from building browser-based TTS/STT inference with ONNX Runtime.

## ONNX Runtime Version Conflicts (Critical)

### Problem

When multiple packages depend on different versions of `onnxruntime-common`, webpack may resolve to the wrong one. In our case:

- `@xenova/transformers@2.17.2` brings `onnxruntime-common@1.14.0`
- `kokoro-js@1.2.1` → `@huggingface/transformers@3.8.1` → `onnxruntime-web@1.22.0-dev` → `onnxruntime-common@1.22.0-dev`

The v1.14.0 `Tensor` class stores data as `this.data` with **no** `location` getter. The v1.22.0-dev `Tensor` class stores data as `this.cpuData` with a `get location()` returning `this.dataLocation`. When onnxruntime-web's session handler calls `tensor.location`, the old Tensor returns `undefined`, causing:

```
Error: invalid data location: undefined for input 'input_ids'
```

### Fix

Webpack resolve alias that dynamically walks the dependency chain to find the correct version:

```typescript
// next.config.ts
const require_ = createRequire(import.meta.url);
const ortWebDir = path.dirname(
  require_.resolve("onnxruntime-web", {
    paths: [path.dirname(require_.resolve("@huggingface/transformers", {
      paths: [path.dirname(require_.resolve("kokoro-js"))],
    }))],
  }),
);
const ortCommonPath = path.dirname(
  require_.resolve("onnxruntime-common", { paths: [ortWebDir] }),
);

// Then in webpack config:
config.resolve.alias["onnxruntime-common"] = ortCommonPath;
```

### Why not simpler alternatives?

- **pnpm overrides**: Would force all packages to use one version, potentially breaking `@xenova/transformers` which expects the old API.
- **Hardcoded pnpm store path**: Breaks on `pnpm update`, different machines, or CI — the store hash changes with each version.
- **`require.resolve` from project root**: pnpm's strict isolation resolves to v1.14.0 (most commonly depended version) rather than the one we need.

## Next.js Bundler Configuration

### Turbopack vs Webpack

- Next.js 16 uses Turbopack by default. The `--webpack` flag is **required** for custom webpack config (resolve aliases, experiments).
- Removing `--turbopack` is not enough — you must explicitly pass `--webpack`.
- Turbopack does not support webpack `resolve.alias`. If switching to Turbopack, use `turbopack.resolveAlias` in next config.

### Required webpack settings for WASM inference

```typescript
config.experiments = { ...config.experiments, asyncWebAssembly: true };
config.output = { ...config.output, globalObject: "self" }; // For web workers
```

### `serverExternalPackages`

ONNX packages must be excluded from server-side bundling to prevent Node.js/browser API conflicts:

```typescript
serverExternalPackages: [
  "onnxruntime-node", "onnxruntime-web", "onnxruntime-common",
  "@huggingface/transformers", "kokoro-js"
]
```

## Cross-Origin Headers for SharedArrayBuffer

ONNX Runtime WASM uses `SharedArrayBuffer` for multi-threaded execution. Browsers require these headers:

```
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

Using `credentialless` instead of `require-corp` allows loading external resources (HuggingFace CDN model files) without CORP headers.

## React Concurrency Guards

Browser-based ML inference is long-running (1-15+ seconds). Without guards:

- Double-clicking "Download" can create duplicate model instances, leaking hundreds of MB of WASM memory.
- Rapid "Generate" clicks can queue overlapping inference calls on the same ONNX session.

Fix: Use `useRef` guards (not state — refs are synchronous):

```typescript
const generatingRef = useRef(false);
const handleGenerate = useCallback(async () => {
  if (generatingRef.current) return;
  generatingRef.current = true;
  try { /* ... */ } finally { generatingRef.current = false; }
}, []);
```

## Blob URL Lifecycle

- `URL.createObjectURL()` creates session-scoped URLs. They **do not survive page reloads**.
- Always revoke previous blob URLs before creating new ones.
- Add `useEffect` cleanup to revoke on unmount.
- Never persist blob URLs to `localStorage` — they become invalid after reload. Use an in-memory cache for same-session playback.

## Debugging ONNX Tensor Issues

When you see `invalid data location: undefined`, check which version of `onnxruntime-common` is actually loaded at runtime:

```javascript
const ortCommon = await import("onnxruntime-common");
const src = ortCommon.Tensor.toString();
console.log("Has 'cpuData':", src.includes("cpuData"));       // true = v1.22+
console.log("Has 'dataLocation':", src.includes("dataLocation")); // true = v1.22+
```

If both are `false`, you have the old v1.14.0 Tensor — check your webpack alias.

## Performance Expectations (Kokoro-82M, WASM, q8)

| Input Length | Generation Time | Audio Duration | RTF |
|-------------|----------------|----------------|-----|
| ~1 word | ~1.0s | ~1.3s | ~0.8x |
| ~14 words | ~4-5s | ~6s | ~0.7-0.8x |
| ~52 words | ~14s | ~18s | ~0.76x |

RTF (Real-Time Factor) below 1.0x means faster-than-realtime generation.
