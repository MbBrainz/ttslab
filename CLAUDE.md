# ttslab

## Caching strategy (tag-only, deliberate)

All content pages, the sitemap, OG images, and `unstable_cache`-wrapped DB queries use `revalidate: false` — meaning **no time-based revalidation, ever**. Cache entries live until either:

1. A write handler calls `revalidateTag(...)` (e.g., `/api/upvote` busts `models` + `stats`).
2. A new deploy invalidates the build.

**Why:** Model metadata is seeded — it does not drift. Upvote counts already invalidate on POST. Time-based revalidation was waking ~200 functions/hour for no real freshness benefit and was the main contributor to Vercel Fluid Compute usage (~40% of account budget at one point).

**When to revisit:**
- If you start updating model rows directly in the DB outside the API routes (manual SQL, seed re-runs against prod, an admin panel) — those writes will NOT invalidate the cache. Either route them through a handler that calls `revalidateTag`, redeploy, or reintroduce a long time-based revalidate (e.g., 7d) as a safety net.
- If you add new write paths that affect rendered content, add the matching `revalidateTag` call to the route handler.
- If new tags are introduced in `unstable_cache` wrappers, mirror them in the relevant write handlers.

**Tags currently in use:** `models`, `comparisons`, `stats`. See `src/lib/db/queries/{models,comparisons,stats}.ts` and `src/app/api/upvote/route.ts`.

## E2E TTS Model Testing

### Why This Matters

Previous agents claimed models worked when they only verified code compiled — they never tested the actual browser flow. **Every model integration must be validated end-to-end in the browser** before being considered done.

### Automated Test via `frontend-functional-tester`

Use the `frontend-functional-tester` sub-agent to verify a TTS model loads, generates, and produces real audio. The dev server must be running first (`pnpm dev`).

**Prompt template** (customize `MODEL_SLUG` and `MODEL_NAME`):

```
You are testing the TTS Lab web app at http://localhost:3001. Perform an end-to-end functional test of a TTS model.

**Test target:** http://localhost:3001/models/{MODEL_SLUG}

**Steps:**
1. Navigate to the model page. Verify "{MODEL_NAME}" heading and demo section are visible.
2. Open browser console and monitor ALL output throughout.
3. Click "Download" to load the model. Wait for status to show "Ready" (check every 15s).
4. Enter text in the textarea (id: tts-text-{MODEL_SLUG}): "Hello, this is a test."
5. Click "Generate Speech" and wait for completion (up to 120s).
6. Verify: WaveformPlayer shows non-flat waveform, metrics are displayed, Download audio link exists.

**Report:** Step results (pass/fail), ALL console errors/warnings, time for download and generation, waveform assessment (flat vs real audio shapes).
```

### Known Limitations

- **WebGPU cannot be tested in headless Playwright** — the browser has no GPU adapter, so `selectBackend()` always falls back to WASM. WebGPU testing requires a real browser with GPU access.
- **Backend is auto-selected** — `tts-demo.tsx` hardcodes `backend: "auto"`. There is no UI for users to force WebGPU.
- **Large models take minutes** — Chatterbox Turbo (~720MB) takes ~3 minutes to download on broadband.

### Verified Model Behavior (2026-03-04)

| Model | WASM | WebGPU | Notes |
|-------|------|--------|-------|
| Kokoro 82M | PASS (249s load, 2.4s gen) | Not tested | Baseline reference |
| Chatterbox Turbo | PASS (181s load, 6.3s gen) | BLOCKED — WASM-only | Browser JSEP WebGPU EP has no INT64 Cast kernel; ONNX spec requires INT64 for Shape/Unsqueeze. Unsolvable by model patching. |

### WebGPU-Specific Debugging

When a model fails on WebGPU:
1. Check if `navigator.gpu.requestAdapter()` returns an adapter (not null)
2. Check console for INT64-related ONNX errors
3. Check console for "unsupported operator" or "execution provider" errors
4. Verify the model repo has WebGPU-compatible ONNX files (no INT64 ops)
5. Test on WASM first to isolate whether the issue is WebGPU-specific
