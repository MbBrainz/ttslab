# Web Worker Infrastructure for In-Browser ML Inference

## Architecture Overview

All model loading, inference (TTS synthesis, STT transcription), and streaming runs inside a dedicated **Web Worker** — never on the main thread. This prevents ONNX Runtime WASM/WebGPU workloads from blocking the UI.

```
React component
  └─ useInferenceWorker() hook         [main thread]
       ├─ postMessage(WorkerCommand)  ──────────>  inference-worker.ts  [worker thread]
       │                                              ├─ registry.ts → getLoader(slug)
       │                                              ├─ loader.load() / synthesize() / transcribe()
       │                                              └─ loader.synthesizeStream()  [async generator]
       └─ onmessage(WorkerResponse)   <──────────  postMessage(WorkerResponse)
```

### Thread Boundary Rules

- **Worker thread**: model loading, ONNX session creation, inference, WebGPU adapter probing, backend selection
- **Main thread**: UI state, AudioContext/AudioQueue playback, blob URL management, `requestAnimationFrame` visualization
- **Transfer, not copy**: `Float32Array` audio buffers cross the boundary via `Transferable` for zero-copy performance

---

## Worker Lifecycle

### Creation

The worker is created **eagerly on component mount** (not lazily on first command) to eliminate cold-start latency:

```typescript
// use-inference-worker.ts
const getWorker = useCallback(() => {
  if (!workerRef.current) {
    workerRef.current = new Worker(
      new URL("./inference-worker.ts", import.meta.url),
    );
    // ... set up onmessage/onerror handlers
  }
  return workerRef.current;
}, []);

useEffect(() => {
  getWorker();  // eager — worker is ready before user clicks anything
  return () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  };
}, [getWorker]);
```

**Critical**: The worker URL uses `new URL("./inference-worker.ts", import.meta.url)`. Webpack detects this pattern and bundles the worker as a **separate chunk**. This is why `import.meta.url` must work correctly — see the ONNX section below.

### Termination

The worker is terminated in the hook's `useEffect` cleanup (component unmount). For parallel workloads (e.g. `tts-compare.tsx`), use **separate hook instances** — each hook manages one worker with a single `pendingRef` slot.

---

## Worker Protocol (Message Types)

Defined in `src/lib/inference/types.ts`. Commands flow main → worker, responses flow worker → main.

### Commands (`WorkerCommand`)

| Type | Purpose | Key fields |
|------|---------|------------|
| `load` | Download + initialize model | `modelSlug`, `options: { backend, quantization }` |
| `synthesize` | One-shot TTS | `modelSlug`, `text`, `voice`, `speakerEmbeddingUrl?` |
| `transcribe` | STT | `modelSlug`, `audio: Float32Array`, `sampleRate` |
| `synthesize-stream` | Streaming TTS (sentence-by-sentence) | `modelSlug`, `text`, `voice`, `speakerEmbeddingUrl?` |
| `cancel-stream` | Abort in-progress stream | _(no fields)_ |
| `extract-embedding` | Speaker embedding extraction | `audio: Float32Array`, `sampleRate` |
| `dispose` | Unload model, free WASM memory | `modelSlug` |

### Responses (`WorkerResponse`)

| Type | Purpose | Key fields |
|------|---------|------------|
| `progress` | Download progress updates | `data: { status, file, loaded, total }` |
| `loaded` | Model ready | `backend`, `loadTime`, `voices` |
| `audio` | One-shot synthesis result | `data: AudioResult` (audio + sampleRate + metrics) |
| `audio-chunk` | Single streaming chunk | `data: { audio, sampleRate, chunkIndex, totalChunks, sentenceText }` |
| `stream-end` | Stream finished | `data: { totalMs, sampleRate, totalChunks }` |
| `stream-cancelled` | Stream aborted by user | _(no fields)_ |
| `transcript` | STT result | `data: TranscribeResult` |
| `embedding` | Speaker embedding URL | `url` |
| `error` | Any failure | `code`, `message` |
| `disposed` | Model unloaded | _(no fields)_ |

### Two Communication Patterns

1. **Request-response** (`load`, `synthesize`, `transcribe`, `dispose`): The hook wraps these in a `Promise` via `pendingRef` — one pending command at a time.
2. **Callback-based streaming** (`synthesize-stream`): No Promise. Callbacks (`onChunk`, `onEnd`, `onError`) are stored in `streamCallbacksRef` and invoked as `audio-chunk` / `stream-end` / `error` messages arrive.

---

## Model Loader Registry

`src/lib/inference/registry.ts` maps model slugs to **lazy factory functions**. Each factory dynamically imports its loader module only when requested — this prevents bundling all frameworks upfront:

```typescript
loaders.set("kokoro-82m", async () => {
  const { KokoroLoader } = await import("./loaders/kokoro");
  return new KokoroLoader();
});
```

The worker calls `getLoader(slug)` which invokes the factory, creating a fresh loader instance. Loaders and their sessions are stored in module-level `Map`s inside the worker, persisting across commands for the worker's lifetime.

### ModelLoader Interface

```typescript
interface ModelLoader {
  slug: string;
  type: "tts" | "stt";
  framework: "transformers-js" | "kokoro-js" | "piper-web" | "sherpa-onnx";
  load(options: LoadOptions): Promise<ModelSession>;
  synthesize?(text: string, voice: string): Promise<AudioResult>;
  transcribe?(audio: Float32Array, sampleRate: number): Promise<TranscribeResult>;
  synthesizeStream?(text: string, voice: string): AsyncGenerator<
    { text: string; audio: Float32Array; sampleRate: number }, void, void
  >;
  getVoices?(): Voice[];
  getSupportedBackends(): ("webgpu" | "wasm")[];
  getPreferredBackend?(): "webgpu" | "wasm" | "auto";
}
```

`synthesizeStream` is optional. Models that implement it (Kokoro) get native sentence-level streaming. Models without it use the fallback path in the worker (sequential `synthesize()` per sentence).

---

## Streaming Architecture

### Two Strategies in the Worker

The `synthesize-stream` handler in `inference-worker.ts` has two code paths:

**1. Native streaming** (Kokoro via `synthesizeStream` async generator):

```typescript
if (loader.synthesizeStream) {
  const sentences = splitIntoSentences(cmd.text);
  totalChunks = Math.max(1, sentences.length);
  for await (const chunk of loader.synthesizeStream(cmd.text, cmd.voice)) {
    if (streamCancelled) { post({ type: "stream-cancelled" }); return; }
    post({ type: "audio-chunk", data: { audio, sampleRate, chunkIndex, totalChunks, sentenceText } },
         [chunk.audio.buffer]);  // Transferable
    chunkIndex++;
  }
}
```

**2. Fallback streaming** (any model with `synthesize`):

```typescript
else {
  const sentences = splitIntoSentences(cmd.text);
  for (const sentence of sentences) {
    if (streamCancelled) { post({ type: "stream-cancelled" }); return; }
    const result = await loader.synthesize(sentence, cmd.voice);
    post({ type: "audio-chunk", data: { ... } }, [result.audio.buffer]);
    chunkIndex++;
  }
}
```

Cancellation works because `self.onmessage` re-enters during `await` points — the `cancel-stream` command sets `streamCancelled = true`, and the next iteration checks it.

### Kokoro-js TextSplitterStream Bug and Fix

**Bug**: `tts.stream(string)` internally creates a `TextSplitterStream` and calls `push(...sentences)` but **never calls `close()`**. The `TextSplitterStream`'s async iterator only exits when `_closed === true`, so the last sentence hangs in the buffer forever.

**Fix**: Create your own `TextSplitterStream`, push the text, call `close()`, and pass the stream instance directly to `tts.stream()` (it accepts both `string` and `TextSplitterStream` as first argument):

```typescript
const splitter = new this.TextSplitterStream!();
splitter.push(text);       // push full text — splitter handles sentence boundaries
splitter.close();          // flush remaining buffer, signal end
for await (const chunk of tts.stream(splitter, { voice })) { ... }
```

The `TextSplitterStream` class is exported at runtime from kokoro-js but its TypeScript types don't resolve via dynamic import. Store the constructor at load time via `(kokoroModule as any).TextSplitterStream` and define a minimal interface inline:

```typescript
interface TextSplitterStream {
  push(...texts: string[]): void;
  close(): void;
  flush(): void;
  [Symbol.asyncIterator](): AsyncGenerator<string, void, void>;
}
```

**Key property of `push()`**: It accepts **incremental text fragments** — you can call `push("Hello ")` then `push("world.")` and the splitter accumulates and emits complete sentences. Call `close()` only when the entire input is done to flush the final buffer.

### kokoro-js v3.8.1 RawAudio Shape

kokoro-js nests `@huggingface/transformers@3.8.1` internally. Its `RawAudio` object has:
- `.audio` — `Float32Array` of PCM samples
- `.sampling_rate` — always 24000 for Kokoro

**NOT `.data`** — that's the v4 transformers.js API. Using `.data` silently yields `undefined`.

---

## WASM JIT Warm-Up

After model loading completes but before posting `loaded` to the main thread, the worker runs a silent dummy inference:

```typescript
if (loader.synthesize) {
  const warmupVoice = voices[0]?.id ?? "default";
  try { await loader.synthesize("warmup", warmupVoice); } catch {}
}
```

This forces the WASM JIT to compile hot paths during the load phase (when the user already expects a wait), eliminating a ~200-500ms cold-start penalty on the first real synthesis.

---

## AudioQueue (Gapless Streaming Playback)

`src/lib/inference/audio-queue.ts` manages real-time playback of audio chunks as they arrive from the worker.

**Signal chain**: `AudioBufferSourceNode` → `GainNode` → `AnalyserNode` → `AudioContext.destination`

Key behaviors:
- **Gapless scheduling**: Each chunk is scheduled to start at `Math.max(nextStartTime, context.currentTime)`, so chunks play back-to-back with no gaps
- **Auto-resume**: Calls `context.resume()` in `enqueue()` because Chrome suspends new AudioContexts by default
- **AnalyserNode**: `fftSize=256`, `smoothingTimeConstant=0.8` — exposed via `analyserNode` getter for the `StreamingVisualizer` component
- **`onAllEnded` callback**: Fires when all `AudioBufferSourceNode`s have finished playing (tracked via `source.onended`). Used to transition from "streaming" to "result" state only after all audio has been heard
- **Safety fallback**: The `useStreamingTts` hook also schedules a `setTimeout` based on `scheduledEndTime - currentTime` in case `onended` doesn't fire (browser tab backgrounding edge case)

A **new AudioQueue is created per streaming session** and destroyed (`.stop()`) when the stream ends or is cancelled. `stop()` disconnects all sources and closes the AudioContext.

---

## ONNX Runtime WASM Setup (Critical)

### The Problem

ONNX Runtime Web defaults to loading WASM files from `cdn.jsdelivr.net`. Browsers block cross-origin `Worker` construction, producing:

```
SecurityError: Failed to construct 'Worker': Script at 'https://cdn.jsdelivr.net/...'
cannot be accessed from origin '...'
```

### The Solution (Three Parts)

**1. Same-origin WASM files** (`scripts/copy-onnx-wasm.mjs`, runs on `postinstall`):

Copies 4 WASM files from `node_modules/onnxruntime-web/dist/` to `public/onnx/`:
- `ort-wasm-simd-threaded.asyncify.mjs`
- `ort-wasm-simd-threaded.asyncify.wasm`
- `ort-wasm-simd-threaded.mjs`
- `ort-wasm-simd-threaded.wasm`

**2. Override wasmPaths at runtime** (`src/lib/inference/onnx-config.ts`):

```typescript
export function configureOnnxWasmPaths(env: { backends: { onnx: any } }) {
  env.backends.onnx.wasm.wasmPaths = "/onnx/";
}
```

Called AFTER importing `@huggingface/transformers` (which sets CDN paths at module eval time) and BEFORE calling `pipeline()`. Each loader that uses transformers.js calls this in its `load()`.

**3. Webpack extern WASM condition** (`next.config.ts`):

```typescript
config.resolve.conditionNames = [
  "onnxruntime-web-use-extern-wasm",
  "import", "module", "require", "default",
];
```

This tells onnxruntime-web to use its non-bundle entry (`ort.webgpu.min.mjs` instead of `ort.webgpu.bundle.min.mjs`). The bundle variant embeds the WASM module inline, breaking `import.meta.url` resolution inside webpack chunks.

### Version Conflicts

Two separate `@huggingface/transformers` versions exist:
- **Top-level** `@huggingface/transformers@4.0.0-next.4` → `onnxruntime-web@1.25.0-dev` → `onnxruntime-common@1.25.0-dev`
- **Nested** (via kokoro-js@1.2.1) `@huggingface/transformers@3.8.1` → `onnxruntime-web@1.22.0-dev`

The Webpack resolve alias forces all imports of `onnxruntime-common` to resolve to the v1.25.0-dev version (which has the `location` getter). Without this alias, mixing versions causes `"invalid data location: undefined"` at inference time:

```typescript
// next.config.ts
config.resolve.alias = {
  "onnxruntime-common": ortCommonPath,  // dynamically resolved via createRequire chain
};
```

The path is resolved dynamically at build time (not hardcoded) so it survives pnpm store hash changes:

```typescript
const ortWebDir = path.dirname(
  require_.resolve("onnxruntime-web", {
    paths: [path.dirname(require_.resolve("@huggingface/transformers"))],
  }),
);
const ortCommonPath = path.dirname(
  require_.resolve("onnxruntime-common", { paths: [ortWebDir] }),
);
```

### Do NOT Suppress `import.meta`

Webpack emits "Critical dependency: Accessing import.meta directly is unsupported" warnings from transformers.js v4. The **correct** fix is:

```typescript
config.ignoreWarnings = [
  { message: /Accessing import\.meta directly is unsupported/ },
];
```

**NEVER use `parser.importMeta: false`** — it breaks `import.meta.url` resolution, causing ONNX Runtime to fall back to CDN URLs, which triggers the cross-origin Worker SecurityError.

---

## Webpack Configuration for Workers

In `next.config.ts`, three settings are critical for worker operation:

```typescript
config.experiments = { ...config.experiments, asyncWebAssembly: true };
config.output = { ...config.output, globalObject: "self" };
```

- `asyncWebAssembly: true` — enables WASM async compilation (required by ONNX Runtime)
- `globalObject: "self"` — ensures chunks use `self` instead of `window` (workers don't have `window`)

Server-side bundling of ONNX packages is prevented:

```typescript
serverExternalPackages: [
  "onnxruntime-node", "onnxruntime-web", "onnxruntime-common",
  "@huggingface/transformers", "kokoro-js", "sharp", "@huggingface/tokenizers",
],
```

COOP/COEP headers enable `SharedArrayBuffer` (needed for WASM threading):

```typescript
headers: [
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
],
```

### Build Command

**Always use `--webpack`**: `pnpm dev` runs `next dev --webpack`. Turbopack does not support the resolve alias configuration needed for ONNX version deduplication.

---

## Backend Selection

`src/lib/inference/backend-select.ts` runs **inside the worker** (WebGPU `navigator.gpu` is available in workers):

1. If user chose `"wasm"` → use WASM
2. If user chose `"webgpu"` and model supports it → probe `navigator.gpu.requestAdapter()`
3. If user chose `"auto"` → check model's `getPreferredBackend()` first, then probe WebGPU
4. Fallback to WASM

Some models override preferred backend (e.g. Supertonic-2 defaults to WASM because WebGPU has precision issues causing audio artifacts).

---

## Main Thread Hook API

`useInferenceWorker()` returns:

```typescript
{
  loadModel(slug, { backend, quantization?, onProgress? }): Promise<LoadedResult>
  synthesize(slug, text, voice, speakerEmbeddingUrl?): Promise<AudioResult>
  synthesizeStream(slug, text, voice, speakerEmbeddingUrl?, callbacks): void
  cancelStream(): void
  transcribe(slug, audio, sampleRate): Promise<TranscribeResult>
  extractEmbedding(audio, sampleRate, onProgress?): Promise<string>
  dispose(slug): Promise<void>
  isLoading: boolean
  isGenerating: boolean
  isStreaming: boolean
}
```

### Streaming Orchestration (`useStreamingTts` hook)

`src/lib/hooks/use-streaming-tts.ts` wraps `useInferenceWorker`'s streaming primitives into a higher-level hook:

- Creates/disposes `AudioQueue` per streaming session
- Accumulates chunks in a ref for WAV concatenation at the end
- Tracks elapsed time via `setInterval(100ms)` during streaming
- Tracks TTFA (time-to-first-audio) on the first `onChunk` callback
- On `onEnd`: concatenates all chunks into one `Float32Array`, converts to WAV blob via `float32ToWav()`, creates blob URL, waits for `AudioQueue.onAllEnded` before transitioning to result state
- On error/cancel: stops AudioQueue, resets state

Returns: `{ startStream, stopStream, isStreaming, analyser, streamProgress }`

---

## Data Flow: Complete Streaming Session

```
1. User clicks "Stream"
2. useStreamingTts.startStream(text, voice)
   ├─ Creates new AudioQueue (fresh AudioContext)
   ├─ Sets isStreaming=true, resets chunksRef, starts elapsed timer
   └─ Calls worker.synthesizeStream(slug, text, voice, callbacks)

3. Worker receives "synthesize-stream"
   ├─ Gets loader from Map
   ├─ Kokoro: creates TextSplitterStream, push(text), close()
   │   └─ for await (chunk of tts.stream(splitter, { voice }))
   │       └─ post("audio-chunk", { audio, sampleRate, chunkIndex, ... }, [audio.buffer])
   └─ Other: splitIntoSentences(text), sequential synthesize() per sentence
       └─ post("audio-chunk", ...) after each

4. Main thread receives each "audio-chunk"
   ├─ onChunk callback fires
   ├─ AudioQueue.enqueue(audio, sampleRate) → plays immediately (gapless)
   ├─ AnalyserNode feeds StreamingVisualizer (canvas frequency bars)
   ├─ Chunk stored in chunksRef for WAV assembly
   └─ ModelState updated to "streaming" with progress

5. Worker finishes all chunks → post("stream-end", { totalMs, ... })

6. Main thread receives "stream-end"
   ├─ Stops elapsed timer
   ├─ Concatenates all chunks → Float32Array → float32ToWav() → Blob → URL
   ├─ Sets AudioQueue.onAllEnded = finalize (waits for playback to finish)
   └─ onAudioReady(blobUrl) → WaveformPlayer appears with download

7. AudioQueue.onAllEnded fires
   └─ ModelState → "result" with metrics (totalMs, audioDuration, RTF, TTFA)
```

---

## File Reference

| File | Purpose |
|------|---------|
| `src/lib/inference/types.ts` | `WorkerCommand`, `WorkerResponse`, `ModelLoader` interface |
| `src/lib/inference/inference-worker.ts` | Worker event loop: load, synthesize, stream, cancel, dispose |
| `src/lib/inference/use-inference-worker.ts` | React hook: worker lifecycle, command dispatch, response routing |
| `src/lib/inference/registry.ts` | Lazy model loader registry (dynamic imports) |
| `src/lib/inference/backend-select.ts` | WebGPU/WASM backend probing (runs in worker) |
| `src/lib/inference/audio-queue.ts` | Gapless audio playback with AnalyserNode |
| `src/lib/inference/onnx-config.ts` | Same-origin WASM path override |
| `src/lib/inference/streaming.ts` | `splitIntoSentences()` fallback for non-streaming models |
| `src/lib/inference/loaders/kokoro.ts` | Kokoro-82M loader with native `synthesizeStream` |
| `src/lib/hooks/use-streaming-tts.ts` | Streaming orchestration (AudioQueue + state + TTFA) |
| `src/components/streaming-visualizer.tsx` | Canvas frequency bar visualization from AnalyserNode |
| `src/lib/audio-utils.ts` | `float32ToWav()` PCM → WAV conversion |
| `scripts/copy-onnx-wasm.mjs` | Postinstall: copy WASM files to `public/onnx/` |
| `next.config.ts` | Webpack aliases, WASM experiments, COOP/COEP headers |

---

## Common Pitfalls

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| `parser.importMeta: false` in webpack config | `import.meta.url` breaks, ONNX falls back to CDN, Worker SecurityError | Use `ignoreWarnings` instead |
| Missing `onnxruntime-common` alias | `"invalid data location: undefined"` at inference time | Resolve alias dynamically via `createRequire` chain |
| Missing `globalObject: "self"` | Worker chunks reference `window` which doesn't exist | Set `config.output.globalObject = "self"` |
| Using `.data` on kokoro-js RawAudio | `undefined` — v3.8.1 uses `.audio` | Always use `chunk.audio.audio` and `chunk.audio.sampling_rate` |
| Passing string to `tts.stream()` | Last sentence hangs forever (TextSplitterStream never closed) | Create own TextSplitterStream, `push()` + `close()`, pass instance |
| Missing `"credentialless"` COEP header | SharedArrayBuffer unavailable, WASM threading fails | Set both COOP and COEP headers in next.config.ts |
| Using Turbopack (`next dev` without `--webpack`) | Resolve alias for onnxruntime-common may not work | Always use `--webpack` flag |
| Running ONNX inference on main thread | UI freezes for seconds during synthesis | All inference must run in the Web Worker |
| Calling `configureOnnxWasmPaths` before importing transformers | No-op — paths aren't set yet | Call after import, before `pipeline()` |
| Not transferring `Float32Array.buffer` in `postMessage` | Audio data is copied (slow) instead of transferred (zero-copy) | Pass `[audio.buffer]` as second arg to `postMessage` |
