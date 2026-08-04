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

## STT demo: the capture claim, and the frozen-UI trade (2026-08-04)

`stt-demo.tsx` has two capture paths — the one-shot recorder and live
VAD-segmented transcription (`use-live-transcription.ts`) — and **they share one
inference worker**. `WorkerTransport` keeps a single pending slot and overwrites
it unconditionally, so two overlapping `transcribe()` calls resolve each other's
promises: the first response settles the *second* caller's promise (wrong text
in a segment) and the first hangs forever.

Mutual exclusion is therefore enforced by `captureClaimRef` — a **synchronous**
ref taken at the top of `startRecording` and of the live toggle, before any
await. It cannot be `isRecording` / `live.isListening`: both only flip once
their async startup resolves, leaving a window where both buttons are still
enabled and both handlers run. The claim is held until *transcription* finishes,
not just until the mic is released, because it guards the worker too; live
`stop()` awaits its queue drain for the same reason.

**Rules if you touch this:**
- Every path that takes the claim must release it from a `finally`. A stranded
  claim disables both capture paths until a page reload.
- Anything that can throw during teardown goes through `releaseVad()`, which
  never rethrows (it is called from inside `finally` blocks) but does
  `console.warn` — a failed `destroy()` means the mic is still hot.
- Do not "fix" this in `worker-transport.ts`. Its single-slot design is a
  broader latent hazard tracked separately; the demo handles it locally.

### Known behaviour change — frozen UI if `onstop` never fires

`stopRecording` awaits `recorder.onstop` unbounded. If it never fires (recorder
error, device yanked), the failure mode is now **different from before the claim
existed**:

- **Before:** the record button stayed enabled. A user could click again and get
  a second overlapping `MediaRecorder` and `MediaStream` — a live UI, but
  silently corrupting data.
- **Now:** `modelState` never reaches `processing` or `error` and the claim
  never releases, so *both* buttons stay permanently disabled with no error
  shown. Honest-but-frozen, deliberately chosen over confusable-but-corrupting.

This is a real regression in recoverability and should not be rediscovered as a
surprise. **Tracked follow-up, deliberately not implemented:** put a timeout
around the `onstop` promise that on expiry surfaces a `TRANSCRIBE_FAILED`-shaped
error and calls `teardownCapture()` / `releaseCapture()`, instead of awaiting
forever. (`recorder.stop()` itself sitting outside the try/finally is a related
but unreachable gap — no await separates it from the `state === "inactive"`
guard above it.)

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

### Insertion rate `I/N` is the non-termination gate, not WER (2026-08-04, verified)

`computeWER` was clamped to 1.0 and `PhraseResult` discarded the S/D/I breakdown it already computed. Both fixed: WER is uncapped, and `substitutions`/`deletions`/`insertions`/`refWords`/`insertionRate` are surfaced on `PhraseResult.sttRoundTrip`. Uncapping regressed no verdict — the clamp only touched values ≥ 1.0, which already failed.

Reference `"The quick brown fox jumps over the lazy dog."` (9 words):

| case | WER before | WER after | S | D | I | I/N |
|---|---|---|---|---|---|---|
| exact | 0.000 | 0.000 | 0 | 0 | 0 | 0.000 |
| 2 benign ASR insertions | 0.222 | 0.222 | 0 | 0 | 2 | 0.222 |
| truncated (half) | 0.556 | 0.556 | 0 | 5 | 0 | 0.000 |
| LOOPED x2 | 1.000 | **1.000** | 0 | 0 | 9 | **1.000** |
| LOOPED x3 | 1.000 | 2.000 | 0 | 0 | 18 | 2.000 |
| LOOPED x5 | 1.000 | 4.000 | 0 | 0 | 36 | 4.000 |
| total garbage | 1.000 | **1.000** | 9 | 0 | 0 | **0.000** |

**Do not re-derive this: uncapping WER does NOT separate `LOOPED x2` from total garbage.** A 2×-looped 9-word reference has exactly 9 insertions, so it scores 1.000 uncapped — bit-identical to garbage. `I/N` is what separates them, **1.000 vs 0.000**. The earlier brief (`docs/briefs/qa-harness.md`) claimed uncapping fixed that case; it does not, and that line is wrong. The spec's *"uncapped they separate (1.0 vs 2.0)"* refers to **x2 vs x3 severity ranking among loops**, not x2 vs garbage.

So `I/N` is the primary non-termination signal and WER is the severity ranking on top of it. `I/N` also names the mode: **I ≫ S,D = loop/non-termination; D ≫ = truncation; S ≫ = mispronunciation.** Against the ground-truth SpeechT5 cloned-voice stutter (looped real words from its own reference): `S=0 D=0 I=8`, `I/N=0.889` → FAIL as non-termination, where WER 0.889 alone only says "bad".

`I/N` thresholds (warn 0.3 / fail 0.5) are **provisional pending real-ASR calibration** — rationale is in the `THRESHOLDS.insertionRate` comment. Benign ASR filler words on the 8–10 word `DEFAULT_PHRASES` cost 0.111–0.222; one full repeat costs 1.0.

**Score a defect against its own reference sentence.** Scoring the stutter transcript against an unrelated reference reports `S=9` "mispronunciation" and turns a harness bug into an apparent metric bug. Mismatched ref/hyp pairs make S/D/I meaningless.

### Tier-1 DSP metrics (`src/lib/audio-qa/`, 2026-08-04, verified)

`CHECK_RULES` now gates on: `integrity` (NaN/Inf), `cepstral_repeat`, `duration`, `silence` (peak-relative frame RMS), `clipping` (consecutive runs), `dc_offset`, `energy`, `wer`, `insertion_rate`. `detectEcho` / `measureSilence` / `detectClipping` in `audio-analysis.ts` are **superseded and no longer gate anything** — they are kept only so the audio-qa tests can demonstrate the improvement. Do not add them back to `CHECK_RULES`.

Measured through the real `runQualityTests()` against the committed `hero-demo-1.wav`:

| scenario | before | after |
|---|---|---|
| healthy real Kokoro render | PASS | PASS |
| duplicated x2 (concat) | PASS | **FAIL** `cepstral=876` |
| overlap @1.2s | PASS | **FAIL** `cepstral=629` |
| overlap @2.5s | PASS | **FAIL** `cepstral=679` |
| rate relabel 24k→44.1k | PASS | **FAIL** `duration=0.803` |
| truncated to 40% | WARN | **FAIL** `duration=1.247` |
| time-stretched x2 | PASS | **FAIL** `cepstral=1213` |
| NaN sample injected | PASS | **FAIL** `integrity=1` |
| variable-speed overlap | PASS | PASS ← still blind, see below |

All three real clean hero-demo renders PASS with zero failures (`cepstral` 68.7 / 122.2 / 32.6, `duration log2` 0.075 / 0.098 / −0.140).

### Three spec values that were wrong — do not "restore" them

1. **Cepstral band is half-duration, NOT the spec's fixed 0.15–3.0 s.** A duplicated utterance repeats at a lag equal to its original length, so a duplicated 5.2 s clip peaks at 5.2 s — outside a 3.0 s band. Band 0.15–3.0 s gives clean max 118.9 vs defect min 33.3 (**margin 0.28× — defects score BELOW clean, so no threshold works at all**). Band 0.15–dur/2 gives clean max 122.2 vs defect min 446.6 (margin 3.66×).
2. **Cepstral fail threshold is 300, NOT the spec's 50.** At 50, **three of the six committed clean samples FAIL** (kokoro 68.7, hero-demo-1 68.7, hero-demo-2 122.2).
3. **Frame-RMS uses a peak-relative gate (peak−40 dB), NOT the spec's absolute −45 dBFS.** An absolute gate is *more* level-dependent than the per-sample test it replaces — identical speech reads 0.235 / 0.470 / 0.990 / 1.000 at 0/−20/−34/−46 dB. Peak-relative reads 0.235 at every level. An absolute −60 dBFS floor still catches genuinely dead audio.

### REFERENCE CASE: the live SpeechT5 cloning defect (2026-08-04, real model)

Run under the spec's repro conditions — real SpeechT5, >10s prompt, **mic-captured** embedding (`--clone-mic`, Chrome's fake device fed a real WAV so the getUserMedia AGC chain runs). Artifacts committed in `test-fixtures/`, asserted by `known-defects.test.ts`.

Two mic sources produced **two different failure modes**, so the defect is embedding-dependent:

| | stock (control) | cloned, kokoro source | cloned, piper source |
|---|---|---|---|
| duration | 16.64s (log2 +0.291) | 6.18s (**log2 −1.139 FAIL**) | 10.98s (log2 −0.309 pass) |
| cepstral | 9.5 | 13.3 | **19.3** (warn 200) |
| silence | 0.242 | 0.162 | 0.153 |
| clipping / DC | 0 / −67.6dB | 0 / −65.4dB | 0 / — |
| WER | **0.000** | **0.706 FAIL** (S=7 D=17 I=0) | **0.706 FAIL** (S=12 D=12 I=0) |
| I/N | 0.000 | 0.000 | 0.000 |
| verdict | PASS | FAIL | FAIL |
| mode | — | truncation | **stutter — the canonical defect** |

The piper-source transcript: *"…and after consciously **sophisticated sophisticated sophisticated sophisticated sophisticated sophisticated sophisticated**…"* — this is the loop the spec describes.

### THE DETECTOR GAP — read this before trusting an acoustic PASS

**Every acoustic detector misses the stutter. Only the ASR round-trip catches it.**

- `cepstral_repeat` = **19.3** against a 200 warn — an order of magnitude below, and silent in *every* 4s window (11.2–19.6). It is the detector built for repetition and it does not see the repo's actual repetition defect.
- `insertion_rate` = **0.000**. I/N was adopted as "the primary non-termination signal" on the premise that a loop *adds* words. This loop **substitutes** them — the decoder still stops near the right length, emitting repeated words instead of the remaining text (S=12 D=12 I=0). The premise does not hold for this failure mode.
- `duration` = −0.309, **passes**. The stutter does not lengthen the output.
- `silence`, `clipping`, `dc_offset`, `integrity` — all pass.
- Envelope autocorrelation does not rescue it either: defective 0.214 vs clean 0.182.

**Why cepstral is blind:** the cepstrum finds *constant-lag* periodicity. Per the spec's own analysis these repeats are **re-synthesized each pass, not spliced**, so no two utterances of the word are acoustically identical and there is no fixed lag to find. The detector catches splices and overlaps; it does not catch a decoder saying a word again. This is structural, not a threshold problem — lowering the threshold to 20 would fire on the clean control at 9.5.

**Consequence:** the verdict on this defect rests entirely on the STT judge. Lose the judge, mis-transcribe, or shorten the prompt enough to dilute WER, and audibly broken audio returns PASS. A future repetition detector (the spec's sustained MFCC repeat-similarity is the candidate) should be calibrated against `test-fixtures/speecht5-cloned-STUTTER-known-bad.wav`, not synthetic overlap. `known-defects.test.ts` encodes the current misses as assertions so that target is executable.

### Live blind spots — do not trust a PASS as proof of these

- **A cepstral PASS is NOT proof that there is no overlap.** Variable-speed overlap is **invisible**: a time-warped copy has no single lag, so no fixed-lag metric can see it. Measured 7.9 vs a clean 8.7 — no separation whatsoever. This is structural, not a tuning problem, and it is asserted as a test in `cepstrum.test.ts` so it cannot quietly regress into looking solved. `pauseFraction` is the only partial cover, and it is weak (clean 0.315 vs overlapped 0.242, a 23% drop versus the 2× the spec claims), which is why it is **reported but deliberately not gated** — any threshold between those two numbers would false-fail a model that simply pauses less.
- **The 300 cepstral threshold rests on a 6-sample, 3-model clean population** (max observed 122.2). That is a small basis for a false-positive bound. Clean speech with regular prosodic rhythm scores high — the kokoro sample peaks at exactly 2.000 s and hero-demo-2 at 0.500 s, both genuinely clean (raw waveform xcorr 0.02 and −0.003; it is their *syllable envelopes* that correlate, 0.60 and 0.53). A rhythmic new model could plausibly clear 200 and warn. **Re-measure this population as models are added** rather than assuming the threshold holds.
- **The duration prior (2.2 words/sec) is calibrated against ONE model** — all three hero demos are Kokoro. A model speaking 1.3× off it lands at log2 0.38, right at the 0.4 warn. Override via the `wordsPerSecond` argument per model rather than moving the threshold.
- **A 24k→16k relabel only WARNS** (measured log2 0.660 against a 0.7 fail). A duration warn must be investigated, never ignored. 24k↔22.05k is undetectable acoustically (0.197) — assert on `sampleRate` directly, which `PhraseResult` now carries.
- **WER dilutes numeric misreadings** — see the normalizer section above.
- **Voice cloning and streaming are untested.** `testPhrase()` calls `synthesize(slug, text, voice)` with no `speakerEmbeddingUrl`, so the known-broken cloned path is structurally untestable.

### Running the harness (`scripts/model-qa.mjs`)

```bash
./node_modules/.bin/next build --webpack
lsof -ti:3005 | xargs -r kill -9        # pkill does NOT reliably free it — see below
./node_modules/.bin/next start -p 3005
node scripts/model-qa.mjs --models kokoro-82m --phrases 3
node scripts/model-qa.mjs --embedding /audio-samples/kokoro-82m.wav --streaming
```

Writes `qa-artifacts/<run>/report.json`, `report.md` and `wav/<slug>__<variant>__NN.wav` (gitignored). Exits 1 on FAIL. The page exposes `window.__modelQA = { run, listModels }`; the driver installs `window.__qaEmitAudio` and each buffer is streamed out **as it is produced**, so a run that dies halfway still leaves artifacts for the cases that finished.

**Offline re-scoring works and is the point** — `decodeWav` + `analyzeAudioQa` on a saved artifact reproduces the in-browser numbers to **0.007%** (16-bit quantization). A threshold change costs nothing to re-evaluate; no model download, no browser.

Two operational traps, both hit during development:
- **`pkill -f "next start"` does not reliably kill the server.** A stale process keeps port 3005, the new one dies with `EADDRINUSE`, and the old process then serves HTML referencing chunk hashes the rebuild deleted → the page 500s on its JS chunk, never hydrates, and `window.__modelQA` never appears. Use `lsof -ti:3005 | xargs -r kill -9` and check the server log.
- **Do not wait on `networkidle2`.** The page holds connections open (inference worker, analytics retries) so navigation times out even though the harness is ready. Wait for `window.__modelQA` instead.

### The duration prior is calibrated against real runs — and is the weakest check

`WORDS_PER_SECOND = 2.5`, the geometric mean of six real Kokoro renders (three committed hero demos, three from an actual harness run on WebGPU):

| render | words / duration | rate |
|---|---|---|
| hero-demo-1 | 13 / 6.22s | 2.09 w/s |
| hero-demo-2 | 13 / 6.33s | 2.05 w/s |
| hero-demo-3 | 12 / 4.95s | 2.42 w/s |
| qa pangram | 9 / 3.30s | 2.73 w/s |
| qa alice | 11 / 3.48s | **3.16 w/s** |
| qa oranges | 10 / 3.67s | 2.72 w/s |

**Thresholds are 0.45/0.65, NOT the spec's 0.4/0.7.** The "alice" phrase measured **log2 −0.399 against a 0.40 warn** — 0.001 from warning on perfectly correct output. That is what forced the recalibration; it is now −0.340 against 0.45.

Within *one* model the rate spans 2.05–3.16 w/s — a **1.54× spread, log2 0.62**, larger than the whole warn budget. Legitimate phrase-to-phrase variation is the same order as the thing being detected. A slower or faster model **will** warn: pass `wordsPerSecond` for it rather than widening the threshold for everyone.

**Do not trust duration for sample-rate errors.** Detection is asymmetric because the clean baseline is not at zero, so which relabel fails depends on the prior — at 2.2 w/s the 24k→44.1k case failed and 24k→16k only warned; at 2.5 it is the other way round. Currently 48k/16k/8k fail, 44.1k warns (−0.619), 22.05k is invisible (0.381). **Assert on `PhraseResult.sampleRate` directly.**

### Verifying a change to the harness

`pnpm test` (vitest, 131 tests). Prove scoring changes with real before/after numbers — drive the real `runQualityTests()` against a fake `InferenceWorkerAPI` and the committed WAVs, not a reimplementation. "It compiles" is not evidence; that failure mode is exactly why this harness exists.

Calibrate thresholds against **real** output, not synthetic fixtures alone. Every threshold that turned out wrong here was wrong because it had only been checked against synthetic signals: the cepstral 50, the absolute silence gate, and the duration 0.4 all survived synthetic testing and failed on real audio.

A fixture can be the bug. The first `speechLike()` was a fixed-f0 harmonic stack, which is perfectly periodic and measured `detectEcho` **0.9999 while clean** — it would have made a working detector look broken. Check a new fixture against the committed real WAVs before trusting a result derived from it.

## WebGPU-Specific Debugging

When a model fails on WebGPU:
1. Check if `navigator.gpu.requestAdapter()` returns an adapter (not null)
2. Check console for INT64-related ONNX errors
3. Check console for "unsupported operator" or "execution provider" errors
4. Verify the model repo has WebGPU-compatible ONNX files (no INT64 ops)
5. Test on WASM first to isolate whether the issue is WebGPU-specific
