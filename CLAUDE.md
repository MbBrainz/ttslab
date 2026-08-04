# ttslab

## Caching strategy (tag-only, deliberate)

All content pages, the sitemap, OG images, and `unstable_cache`-wrapped DB queries use `revalidate: false` — meaning **no time-based revalidation, ever**. Cache entries live until either:

1. A write handler calls `revalidateTag(...)` (e.g., `/api/upvote` busts `models` + `stats`).
2. A new deploy invalidates the build.

**Why:** Model metadata is seeded — it does not drift. Upvote counts already invalidate on POST. Time-based revalidation was waking ~200 functions/hour for no real freshness benefit and was the main contributor to Vercel Fluid Compute usage (~40% of account budget at one point — see TTSL-25).

**When to revisit:**
- If you start updating model rows directly in the DB outside the API routes (manual SQL, seed re-runs against prod, an admin panel) — those writes will NOT invalidate the cache. Either route them through a handler that calls `revalidateTag`, redeploy, or reintroduce a long time-based revalidate (e.g., 7d) as a safety net.
- If you add new write paths that affect rendered content, add the matching `revalidateTag` call to the route handler.
- If new tags are introduced in `unstable_cache` wrappers, mirror them in the relevant write handlers.

**Tags currently in use:** `models`, `comparisons`, `stats`. See `src/lib/db/queries/{models,comparisons,stats}.ts` and `src/app/api/upvote/route.ts`.

### Gotcha: a single server fetch can silently un-static the whole site

A route's effective `revalidate` is the **minimum** of the page's setting and every server-side `fetch()` inside it (and its layouts). One `fetch(url, { next: { revalidate: 3600 } })` in a component rendered by `app/(main)/layout.tsx` (e.g. the GitHub-stars badge) overrode `revalidate = false` on **every** page, reverting the entire site to hourly ISR. With crawlers hitting ~150 model+comparison paths, that was the source of ~2–2.5 min/day of Vercel Fluid compute (TTSL-25 follow-up, fixed 2026-05-29).

Rules to keep compute at ~zero:
- **Never do a time-based `fetch` in a server component that renders inside a layout.** Cosmetic third-party data (star counts, etc.) must be fetched **client-side** (see `src/components/github-stars.tsx`) or with `cache: "force-cache"` and no `revalidate`. Default Next 15/16 fetch is `no-store` (dynamic) — omitting options makes it *worse*, not static.
- **Dynamic segments are pinned with `export const dynamicParams = false`** on `models/[slug]`, `compare/[slug]`, `embed/[slug]`, and both `[slug]/opengraph-image.tsx`. Every real slug is prerendered via `generateStaticParams`; unknown paths return a static 404 instead of spawning an on-demand render. If you add a route whose `generateStaticParams` does NOT enumerate all valid slugs, do not set `dynamicParams = false` (it would 404 real pages).
- **OG images need their own `generateStaticParams`** — they are separate routes from the page. Without it they satori-render on demand (the most CPU-expensive function here) on every social/crawler hit. A multi-child `<div>` in an OG image must have explicit `display: flex`, or satori throws a 500 at render time (500s are never cached → re-render every hit). Verify by running `next build` and confirming OG routes show `●` not `ƒ`.
- **Verify after any caching/layout change:** `./node_modules/.bin/next build --webpack` and confirm the route table shows `○`/`●` for all pages and OG images; only `/api/*` should be `ƒ`. (Use the binary directly — `pnpm build` triggers a TTY-gated dep check.)

**Idle dynamic routes:** `/api/models`, `/api/models/[slug]`, `/api/stats` are `ƒ` but unreferenced by the frontend — they cost compute only if hit directly. Left in place as a public API surface; delete or cache them if they ever show up in runtime logs.

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

## Automated Model QA Harness (`src/lib/testing/`)

Full design: `docs/model-qa-harness.md`. Build order and scope: `docs/briefs/qa-harness.md`.

### Acoustic checks now gate the verdict (2026-08-04, verified)

`phraseVerdict()` was dead code and `overallVerdict()` read only `sttRoundTrip.verdict`, so every detector in `audio-analysis.ts` ran but **could not fail a test** — WER was the sole gate. Fixed: `phraseVerdict()` returns `{verdict, failures}`, is called from `testPhrase()`, and `overallVerdict()` reads the combined phrase verdict.

Checks are a rule table in `tts-quality-runner.ts` (value getter + warn/fail threshold + direction). Each breach is reported as `CheckFailure {check, value, threshold, severity}` on `PhraseResult.failures` — not a bare `"fail"` — which is the shape `report.json` needs. Add a check by appending to `CHECK_RULES`, not by editing verdict logic.

Verified through the real `runQualityTests()` with a fake worker (before = old STT-only logic):

| scenario | before | after |
|---|---|---|
| healthy speecht5 / kokoro / piper / hero-demo | PASS | PASS |
| overlap @0.4s, transcript perfect | PASS | **FAIL** `echo=0.527` |
| dead audio (zeros) + Whisper hallucination | PASS | **FAIL** `silence=1.000`, `energy=-Inf` |
| too quiet (−60 dB), transcript perfect | PASS | **FAIL** `silence=1.000`, `energy=−89.7` |
| clipped (12× overdrive) | PASS | **FAIL** `clipping=0.076` |
| garbage transcript | FAIL | FAIL `wer=1.000` |

**False-fail margins measured on the committed `public/audio-samples/*.wav`** — re-check these before changing any threshold: echo `0.023–0.072` vs 0.3 warn; silence `0.191–0.272` vs 0.3; clipping `0.00000` vs 0.001; rms `−22…−27 dB` vs −40.

### Live blind spots — do not trust a PASS as proof of these

- **`detectEcho` cannot see long-lag duplication.** It scans 50–500 ms. Measured on `speecht5.wav`: clean `0.072`, duplicated-concat `0.070`, overlap @1.2 s `0.073` — indistinguishable. It caught the 0.4 s case only because that lag is inside its window. Autoregressive looping happens at 1–5 s. Cepstral peak prominence replaces it (spec Tier 1 #1).
- **The silence check is level-dependent**, per-sample not frame-RMS, and its margin is thin (0.272 vs a 0.3 warn). Same clean speech at a lower output level crosses the threshold on nothing. Frame-RMS replacement is load-bearing, not cosmetic.
- **Voice cloning and streaming are untested.** `testPhrase()` calls `synthesize(slug, text, voice)` with no `speakerEmbeddingUrl`, so the known-broken cloned path is structurally untestable.

### Verifying a change to the harness

There is **no test runner configured** in this repo (no vitest/jest). Until there is, prove scoring changes with `npx tsx` against a fake `InferenceWorkerAPI` and the committed WAVs — drive the real `runQualityTests()`, not a reimplementation, and report actual before/after numbers. "It compiles" is not evidence; that failure mode is exactly why this harness exists.

## WebGPU-Specific Debugging

When a model fails on WebGPU:
1. Check if `navigator.gpu.requestAdapter()` returns an adapter (not null)
2. Check console for INT64-related ONNX errors
3. Check console for "unsupported operator" or "execution provider" errors
4. Verify the model repo has WebGPU-compatible ONNX files (no INT64 ops)
5. Test on WASM first to isolate whether the issue is WebGPU-specific
