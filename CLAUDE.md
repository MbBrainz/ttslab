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

### Verified Model Behavior (2026-11-08) — new integrations, browser pass (kitten VERIFIED; distil render-only; LLM engines PENDING)

The 2026-11-08 upgrade (transformers.js 4.3.2 + ORT 1.31.1, kitten-tts-nano, woof-tts, distil-whisper-small-en, the 3-engine LLM tier — see the Runtime pins / LLM sections at the bottom of this file) is **compile-verified (`tsc` clean) and unit-tested (vitest, 242 tests at the time)**. Browser runs that DID happen (2026-11-08, headed Chromium against `next start`): the Kitten TTS Nano synthesis path, the Underdog Woof synthesis path, and the Woof WebGPU backend (`__woofVerify()` corr 0.9999998, 31x over CPU — see the table below). Browser-verified 2026-11-09: **the webllm and wllama LLM engines load via the voice-agent picker** (default 0.8B ready ~40s, wllama switch ready 20s, WebLLM 2B switch ready 40s, zero cancel errors) — after fixing the self-cancelling loadEpoch guard, see the LLM section below; **the /finetune WebGPU training loop** (loss 1.6e-5 → 5.0e-6 over ~5s, see the Finetune section) — also after fixing a WGSL reserved-keyword shader bug. What is still NOT verified end-to-end: distil-whisper STT inference (page render + zero console errors only), the webllm 4B entry, and actual LLM *generation* on any tier (mic-only conversation; load/readiness verified, generation not).

| Model | WASM | WebGPU | Notes |
|-------|------|--------|-------|
| Kitten TTS Nano | **PASS — browser-verified 2026-11-08** (load 9s incl. q8 ONNX + eSpeak worker + voice bin; synthesis 661 ms for 5.37 s audio, RTF 0.123x, 16-bit peak ~24k, zero console errors; deterministic across two runs) | N/A — WASM-only | 15M params, ~24 MB q8, 8 voices `expr-voice-{2..5}-{f,m}`, 24 kHz. The repo (onnx-community/kitten-tts-nano-0.1-ONNX) ships a single q8 ONNX file — **no fp32 exists**, so there is no WebGPU variant at all. NOT loadable via the standard `pipeline("text-to-speech")`; `loaders/kitten-tts.ts` ports the webml-community/KittenTTS-web custom pipeline: eSpeak NG phonemization via vendored `public/espeak/espeakng.worker.js` (pinned to xenova/phonemizer.js@6835144b), `StyleTextToSpeech2Model` with 256-dim style + speed tensors, 2000-sample edge trim, sentence chunking at 512 phoneme tokens. **Load bug fixed 2026-11-08:** the vendored eSpeak file ends in `export default Module`, so importing gives a sealed ES-module namespace — assigning `onRuntimeInitialized` on the namespace threw `Cannot add property onRuntimeInitialized`. The loader now unwraps `.default` (with a plain-module fallback) before hooking. |
| Underdog Woof | **PASS — browser-verified 2026-11-08** (load 6s for the 40 MB npz; 10.1s for 5.00 s audio from the hand-ported typed-array path, peak ~11k, zero console errors; UI re-verified 2026-11-08: backend forced to WASM renders audio via the demo, metric label "wasm", zero console errors) | **PASS — browser-verified 2026-11-08** (`__woofVerify()` in headed Chromium: hand-written 22-kernel WGSL set (`Object.keys(WOOF_KERNELS).length` = 22; Underdog's reference bundle ships 19) vs the typed-array CPU path, same sentence / voice juno / seed 0 → **Pearson corr 0.9999998** (target 0.9999), 78 frames both backends, **CPU 6094 ms vs GPU 194 ms ≈ 31x**; adapter apple metal-3; UI path backend "auto" selects webgpu and renders audio in 191 ms; no WGSL compile errors, no device-lost, no OOM). Four real bugs were found and fixed during verification: a wrong grouped-scale validation in `gpuGrouped`, `queue.submit()` given a bare command buffer instead of an array, `rope_t` never reading its `pos` binding (stripped from the auto layout → invalid bind groups), a SEANet residual add aliasing one buffer read-only + read-write (now a dedicated `acc` kernel), and the cond head missing its RMS-norm (plus `ada` consuming pre-silu cond in decode frames) — all covered by the 242-test gate. | NC license: presets and seed copy carry the "Voice by Underdog Woof" credit; demo text is spelled-out prose (number normalizer not ported — see `loaders/woof.ts`). |
| DistilWhisper Small (en) | page renders clean (h1 + demo, zero console errors, 2026-11-08); **STT inference pass pending** (~172 MB q8) | compile+unit verified; **browser pass pending** (~665 MB fp32) | English-only, 166M params. Runs through the existing `WhisperLoader` — repo `onnx-community/distil-small.en_timestamped` has the standard file layout (q8/int8 + q4 for WASM, fp32 for WebGPU). |

Two more roster facts from this round:

- **Supertonic 3 was evaluated and skipped**: no official full ONNX export exists — only `text_encoder` and `duration_predictor` are published. Do not re-attempt without a full export.
- The DB roster is now **28 models / 164 comparisons** (queried 2026-11-08: 25 supported — 8 TTS + 17 STT — plus 2 unsupported TTS and 1 planned TTS; C(8,2) + C(17,2) = 164 supported same-type pairs). The old *planned* `kitten-tts` row was replaced by the *supported* `kitten-tts-nano`; `woof-tts` joined the supported TTS tier; **`chatterbox` stays supported** (WASM works; its WebGPU INT64 block is core to the limits story). `seed-models.ts` only inserts comparisons, so `scripts/cleanup-models.ts` also prunes rows whose models lost `supported` status — run it before re-seeding when a model's status changes (it removed 5 stale `chatterbox-multilingual-vs-*` rows on 2026-11-08).

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

### Voice cloning verified in a browser (2026-08-04) — and SpeechT5 is NONDETERMINISTIC

`scripts/verify-voice-clone.mjs` drives the real UI in headless Chrome. Full numbers in `qa-artifacts/voice-clone/RESULTS.md` (gitignored; re-runnable).

**Read this before comparing any two SpeechT5 renders:** five stock renders of the *identical* sentence with the *identical* voice gave **6.176 / 6.016 / 6.208 / 6.240 / 5.920 s**. Output is not reproducible run to run, so "these two renders differ" proves nothing on its own. Measure the nondeterminism band first (|log2 duration| max **0.0759** over 10 control pairs) and compare against it. Two subagents' worth of effort went into this question; without the control the result is unreadable.

Verified with that band anchored:
- **The embedding reaches the model.** Cloned vs stock: |log2 dur| **0.742** and **0.459** across two runs — 9.8× and 6.0× the band.
- **The stale-embedding fix holds.** After switching the dropdown back to a stock voice, that render sits *inside* the stock cluster (|log2 dur| 0.0078–0.0838 vs the five controls) and 8–10× away from the clone. Mechanism: `tts-demo.tsx:133` passes an explicit `null`, and `inference-worker.ts:87` gates on `!== undefined`, so `null` reaches `setSpeakerEmbedding(null)` and clears it. **Passing `undefined` there would silently skip the call and leak the previous embedding** — do not "simplify" that null.
- **WavLM is 101.69 MB, measured on the wire** (`onnx/model_quantized.onnx`; `model.onnx` at 402.5 MB is never requested). `device: "wasm"` with no `dtype` resolves to q8 via `DEFAULT_DEVICE_DTYPE_MAPPING`. Any earlier 350–400 MB figure was fp32 and does not apply unless someone sets `dtype`. `cachedModel` (`speaker-embedding.ts:43`) is never released — `dispose` at `inference-worker.ts:218` clears a different registry — so ~100 MB stays resident after the first clone.
- **But the clone does NOT resemble the reference speaker.** Independent judge (WeSpeaker ResNet34-LM via `scripts/speaker-similarity.mjs` — deliberately not WavLM-base-plus-sv, which produced the conditioning embedding and would only measure whether SpeechT5 honored its own input vector). Anchors: same speaker **0.946–0.950**, different speaker **0.161–0.228**, unrelated **0.006–0.036**, self 1.0000. Result: cloned-vs-reference **0.167 / 0.123** against a stock-vs-reference baseline of **−0.011 / 0.012**. A real shift, but it lands *inside the different-speaker band*. The cloned render is even **more similar to the stock voice (0.292) than to the reference (0.167)**. On the mic fixtures the supplied reference has no detectable effect at all — both score higher against the *wrong* source (0.094 / 0.106) than their own (0.051 / 0.071). **Cloning changes the voice; it does not clone the speaker.**
- **Resemblance and correctness are separable — report both, never one instead of the other.** `TRUNCATED` vs `STUTTER` scores **0.8846**, near the same-speaker band, while one truncates to 36% length and the other loops "sophisticated" seven times. An SV-similarity gate would call them the same speaker and flag neither defect.
- **Malformed uploads fail cleanly.** Text-renamed-`.wav`, zero-byte, and truncated-RIFF all show "Unable to decode audio data" in 54–611 ms; page and Generate stay usable.

**No file-size limit exists.** `handleFile` (`voice-clone-upload.tsx:157`) forwards straight to `decodeAudioToPCM`, which calls `await audioBlob.arrayBuffer()` (`speaker-embedding.ts:23`) unbounded. `accept="audio/*"` is a picker filter, not enforcement — drag-drop bypasses it.

Harness notes: use a **persistent `--user-data-dir`** or every run re-downloads ~560 MB of SpeechT5 (with it, a full pass is ~30 s). Set the textarea **before** waiting on the Generate button — `text` starts `""` and the button is `disabled={!text.trim() || ...}`, so waiting first deadlocks.

### The STUTTER defect is NOT acoustic repetition — five methods agree (2026-08-04)

An MFCC self-similarity detector was built specifically to close the cepstral gap, in two formulations, and **both fail with several statistics INVERTED** — clean speech scores *higher* than the defect:

| metric | clean max | STUTTER | margin |
|---|---|---|---|
| fixed-lag stripe, longest run | 0.37–0.54s | 0.18–0.28s | 0.35–0.65× |
| template match, median | 0.574 | 0.625 | 1.09× |
| template match, frac ≥ 0.85 | 0.072 | 0.009 | 0.12× |
| template match, run ≥ 0.85 | 0.720s | 0.060s | 0.08× |

**Do not build a third repetition detector for this fixture.** The reason it fails is that the artifact contains no acoustic repetition to find. Five independent methods concur: cepstral (19.3 vs a 200 threshold), envelope autocorrelation (0.214 vs clean 0.182), both MFCC formulations, and speaker similarity (0.071 against its own reference). Per-second analysis shows why — spectral flatness runs **0.010–0.236** against **0.0004–0.068** for clean speech, with ZCR ~2× higher. **The output degenerates into noise-like, poorly-voiced audio.** Whisper's looping "sophisticated sophisticated …" transcript is its decoding of that degradation, not evidence of clean word repeats.

This refines the earlier "detector gap" claim: the acoustic detectors are not missing a repetition that is present — they are correctly silent about a property this audio does not have. The spec's canonical artifact (`speecht5-1784627372628.wav`, **not in this repo**) may genuinely contain the word-level repeats the spec describes; if it is ever recovered, re-run `measureRepeatSimilarity` against it before concluding anything.

**The single most useful thing anyone learns from this fixture:** the transcript looked like repetition, and that misled three separate detectors into chasing the wrong property. The mechanism is **voicing collapse**, not a decoder loop. Check what the audio *is* before building a detector for what the transcript *implies*.

### `voicing_flatness` — WARN-ONLY, and must stay that way

Shipped in `CHECK_RULES` as `voicing_flatness` (`src/lib/audio-qa/voicing.ts`). Median spectral flatness over energy-gated frames, peak-relative spectral floor, so it is level-invariant. **Threshold 0.017, warn only — `THRESHOLDS.spectralFlatness` has NO `fail` key, and `CheckRule.fail` is optional precisely so that adding one is a deliberate edit rather than a tweaked number.**

Measured populations:

| population | median flatness |
|---|---|
| negatives — 9 clean real renders + **2 working file-upload clones** | max **0.00900** |
| TRUNCATED fixture (weaker positive) | 0.03081 |
| STUTTER fixture (stronger positive) | 0.05579 |

0.017 is the geometric midpoint of the negative ceiling and the weaker positive: **1.89× headroom above the negatives**, **1.81× margin below TRUNCATED**, 3.28× below STUTTER. Both error directions are balanced by construction.

**The evidence base and its weakness, together:** there is exactly **ONE** strong positive example, and the 11 negatives span **0.00008–0.00900 — a 110× internal spread**. The false-positive tail is therefore **unbounded**: a differently-voiced model (breathier, noisier, a different vocoder) could plausibly exceed 0.017 while being perfectly fine. That is why it warns and cannot fail.

**DO NOT promote this to a fail gate without substantially more positive examples.** A warn costs a reader a glance; a fail on this basis would break someone's run over a voice the threshold never saw. `voicing.test.ts` asserts the no-fail-tier property structurally so the constraint survives refactors.

`src/lib/audio-qa/repeat-similarity.ts` keeps the rejected MFCC measurements and is wired into nothing.

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

`pnpm test` (vitest, 253 tests across 22 files as of 2026-11-08). Prove scoring changes with real before/after numbers — drive the real `runQualityTests()` against a fake `InferenceWorkerAPI` and the committed WAVs, not a reimplementation. "It compiles" is not evidence; that failure mode is exactly why this harness exists.

Calibrate thresholds against **real** output, not synthetic fixtures alone. Every threshold that turned out wrong here was wrong because it had only been checked against synthetic signals: the cepstral 50, the absolute silence gate, and the duration 0.4 all survived synthetic testing and failed on real audio.

A fixture can be the bug. The first `speechLike()` was a fixed-f0 harmonic stack, which is perfectly periodic and measured `detectEcho` **0.9999 while clean** — it would have made a working detector look broken. Check a new fixture against the committed real WAVs before trusting a result derived from it.

## WebGPU-Specific Debugging

When a model fails on WebGPU:
1. Check if `navigator.gpu.requestAdapter()` returns an adapter (not null)
2. Check console for INT64-related ONNX errors
3. Check console for "unsupported operator" or "execution provider" errors
4. Verify the model repo has WebGPU-compatible ONNX files (no INT64 ops)
5. Test on WASM first to isolate whether the issue is WebGPU-specific

## Runtime pins: transformers.js 4.3.2 + ONNX Runtime Web 1.31.1 (2026-11-08)

- `@huggingface/transformers` is pinned **exact 4.3.2** (no `^`), up from 4.1.0.
- The `onnxruntime-web` override moved **1.25.0-dev.20260212 → 1.31.1 stable**. It is declared in TWO places, and both matter:
  - `pnpm-workspace.yaml` `overrides:` — the one pnpm 11 actually honors (it ignores package.json `pnpm.overrides`);
  - a direct `onnxruntime-web: "1.31.1"` dependency in package.json.
- **Why 1.31.1 specifically:** transformers 4.3.2 declares an onnxruntime-web `1.31.0-dev` branch as its dependency; **1.31.1 stable is the closest released pairing**. The pin must preserve two invariants:
  1. the `onnxruntime-web-use-extern-wasm` export condition (first entry of `conditionNames` in `next.config.ts`) — selects the non-bundled entry so the `wasmPaths` override stays authoritative;
  2. the six `ort-wasm-simd-threaded*` files `scripts/copy-onnx-wasm.mjs` copies to `public/onnx/` — ORT requires the JS glue and the `.wasm` binary to be the same version, and one binary set serves all nested ORT consumers (transformers.js, kokoro-js, vits-web, vad-web).
- **The Qwen revision pin is kept:** `HF_REVISIONS` in `llm-worker.ts` still pins `onnx-community/Qwen3.5-0.8B-Text-ONNX` to `c76a8add…`. Newer ORT only *adds* kernels, so the pre-re-export graph stays safe — a runtime bump is not a reason to drop a weights pin.
- `tsconfig.json` target bumped **ES2017 → ES2020**: `@wllama/wllama` ships TypeScript with BigInt literals, which ES2017 cannot parse.
- **Self-hosted WASM assets (both wired into `postinstall`, in order):**
  - `scripts/copy-onnx-wasm.mjs` → `public/onnx/` (pre-existing);
  - `scripts/copy-wllama-wasm.mjs` → `public/wllama/` — wllama must fetch its `.wasm` same-origin (cross-origin worker fetches SecurityError, same as ONNX). Also copies the `@wllama/wllama-compat` Asyncify build so Safari needs no CDN at runtime.
- `public/espeak/espeakng.worker.js` is **vendored** (from xenova/phonemizer.js, pinned `6835144b`) for kitten-tts phonemization — see the README inside that folder.

## LLM: 3-engine tier system (2026-11-08)

`src/lib/inference/llm-types.ts` is now a discriminated union on `engine` with three tiers of the same Qwen3.5 family:

| id | engine | weights | download | VRAM | backend |
|---|---|---|---|---|---|
| `qwen3.5-0.8b` | transformersjs (default) | onnx-community/Qwen3.5-0.8B-Text-ONNX — q4f16 on WebGPU, q4 on WASM | ~490 MB | — | WebGPU or WASM |
| `qwen3.5-2b-webllm` | webllm | `Qwen3.5-2B-q4f16_1-MLC` via @mlc-ai/web-llm 0.2.87 | ~1.08 GB | ~2.2 GB | WebGPU + shader-f16 only |
| `qwen3.5-4b-webllm` | webllm | `Qwen3.5-4B-q4f16_1-MLC` | ~2.39 GB | ~3.9 GB | WebGPU + shader-f16 only |
| `qwen3.5-0.8b-wllama` | wllama | unsloth/Qwen3.5-0.8B-GGUF `Q4_K_M` via @wllama/wllama 3.8.1 (+ wllama-compat for Safari) | ~533 MB | — | pure CPU/WASM |

Facts that must stay true when touching this code:

- **All engines are context-pinned to 4096 tokens** (`LLM_CONTEXT_TOKENS`). That is the honest limit — KV-cache memory and real-time voice latency, not the model. **Never advertise the 262k window** the models nominally support.
- **webllm** runs inside a dedicated worker (`webllm-worker.ts`, `WebWorkerMLCEngineHandler`); generation cancellation goes through `interruptGenerate`. Capability gating (WebGPU adapter **+ shader-f16**) is `probeLlmCapability()` in `llm-engine-select.ts` — entries with `requiresWebGPU`/`requiresShaderF16` are hidden or flagged when the probe fails.
- **wllama** forces `n_gpu_layers: 0` — it exists deliberately as the no-WebGPU exhibit. **Multi-thread is deliberately NOT enabled** — and the rationale for that is NOT COOP/COEP (that reasoning is backwards): the site already sets COOP `same-origin` + COEP `credentialless` site-wide in `next.config.ts`, so SharedArrayBuffer is available. The real reason is the build choice — `scripts/copy-wllama-wasm.mjs` vendors the package's **single-threaded** `wllama.wasm` (plus the Asyncify compat build for Safari), and the tier is the deterministic pure-CPU contrast exhibit, so the multi-thread speedup is out of scope by design.
- **Engine-shared behavior:** every tier gets the same system prompt via `buildVoiceMessages`/`SYSTEM_PROMPT` (`llm-prompt.ts`) and the same streaming `<think>` stripping via `ThinkTagFilter` (`think-filter.ts`), so switching tiers changes quality/size, not conduct.

### Engine-switch load guard — bug fixed + browser-verified (2026-11-09)

**The bug:** selecting the wllama or webllm tier on `/voice-agent` in the production build *always* failed with `Error: wllama load cancelled by a newer load` / `Error: WebLLM load cancelled by a newer load` — after the download had fully completed (observed: wllama died at 94%+, warm retries died in ~3.3s; the default transformers.js tier was unaffected because it has its own transport). **Root cause:** both `WllamaTransport.load()` and `WebLlmTransport.load()` captured `const epoch = ++this.loadEpoch`, then called `await this.dispose()` to free the previous engine — but `dispose()` itself does `this.loadEpoch++`. The post-load staleness check `epoch !== this.loadEpoch` was therefore **unconditionally true**: every load cancelled itself the moment it finished. (The review-fix "concurrent-load guard" had the right goal and a self-defeating implementation.)

**The fix** (both `src/lib/inference/webllm-transport.ts` and `wllama-transport.ts`): split teardown into a private `disposeCore()` that does NOT bump the epoch (used by `load()` between attempts) while the public `dispose()` bumps the epoch first and then delegates. The captured epoch is now only invalidated by a *genuinely newer* `load()` or `dispose()`, so rapid A→B→C switching still cancels superseded in-flight loads with full self-teardown (no orphan workers/VRAM — covered by tests). `WebLlmTransport` additionally assigns `this.client` only after the epoch check and cleans up through local refs, so a superseded load can no longer stomp a newer load's engine. The rejection is now an `LlmLoadSupersededError` (`llm-types.ts`), which `use-voice-agent.ts` treats as an expected cancellation (like the transformers "Cancelled by new command") instead of flashing "failed". The hook's auto-reload effect is also hardened: `loadLlm` reads the model from a ref (identity-stable, keyed on the model **id string**, not the object) and an `LlmLoadGuard` (`llm-load-guard.ts`) dedupes concurrent triggers so one selection starts at most one load.

**Tests:** `webllm-transport.test.ts` + `wllama-transport.test.ts` (6 + 6) reproduce the bug at transport level against mocked `@mlc-ai/web-llm` / `@wllama/wllama/esm` — all 12 failed with the exact production error before the fix, all pass after; `llm-load-guard.test.ts` (5) covers the dedupe semantics. Suite total: **340 tests (31 files) as of 2026-11-09**.

**Browser verification (2026-11-09, headed Chromium against the production build, `next start`):** default transformers.js tier ready ~40s after Power On; **wllama switch → READY in 20s**; **WebLLM 2B switch → READY in 40s** (533 MB / 1.1 GB downloads); zero `cancelled by a newer load` errors, zero page errors (only the known-benign localhost `_vercel` 404 and the ONNX Runtime "Some nodes were not assigned" worker warning). Both screenshots show the agent armed ("Ready" + mic). Mic-only conversation (no text input path), so generation was not exercised; the 4B webllm entry remains unverified.

## Finetune Lab (`/finetune`, 2026-11-09)

`src/app/(main)/finetune/page.tsx` + `src/components/finetune/finetune-lab.tsx` + `src/lib/finetune/*` — a real in-browser training loop (from-scratch MLP, 5,313 params) on hand-written WGSL compute kernels (`src/lib/finetune/kernels.ts`, 9 pipelines): forward, backprop, Adam, per-frame diagnostics readbacks. Purely a pipeline proof — nothing on TTSLab fine-tunes a production TTS model yet.

**WGSL reserved-keyword bug found and fixed 2026-11-09:** the `ft_mse_delta` shader declared its binding as `var<storage, read> target: array<f32>` — **`target` is a WGSL reserved keyword**, so `CreateShaderModule` failed to parse it and the whole `ft.mse_delta` pipeline was invalid. The training loop *kept running* (steps incremented, no page errors — only per-frame WebGPU "Invalid ComputePipeline" console warnings) but every step was a no-op: loss read back as a flat `0` and the loss chart never moved. Fixed by renaming the binding to `target_buf` (kernels.ts; the JS-side `buf("target")` cache key in `session.ts` is name-only bookkeeping and unaffected). **Browser-verified 2026-11-09** (headed Chromium, production build): device initializes, Train → loss **1.6e-5 at ~5s → 5.0e-6 at ~10s**, best loss 1.8e-8, curve-fit canvas renders, zero WGSL errors, zero page errors.

## Security headers (2026-11-08)

`next.config.ts` sets site-wide, on top of the unchanged COOP/COEP pair (`same-origin` / `credentialless`):

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), geolocation=(), microphone=(self), interest-cohort=()` — the mic is same-origin-only because the STT demos need it; camera and geolocation are denied outright
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `/internal/:path*` additionally gets `X-Robots-Tag: noindex, nofollow`

## API rate limiting (2026-11-08)

`src/lib/rate-limit.ts` — dependency-free in-memory fixed-window limiter (`RateLimiter.check(key, now?)`, injectable clock, unit-tested with a fake clock). Wired into three routes:

| Route | Buckets | Response when blocked |
|---|---|---|
| `POST /api/upvote` | per-IP 30/min **then** per-fingerprint 10/min (fingerprint is client-supplied and spoofable — the IP bucket is the backstop) | 429 + `Retry-After` (seconds) |
| `POST /api/subscribe` | per-IP 5/min **and** 3/hour (the hourly bucket is the real email-bomb cap on the Resend send; 3 < 5 so it always binds first) | 429 + `Retry-After` |
| `GET /api/subscribe/verify` | per-IP 3/hour (gates token guessing; a 5/min bucket here would be dead code under the 3/hour cap, so it is deliberately absent) | 429 + `Retry-After` |

**Honest limitation:** state is a per-process `Map`. On serverless each instance counts independently (effective ceiling = limit x instances) and a cold start resets every window. This is a spam brake for the launch threat model (one client, one instance), not a hard quota — a durable limiter (Redis/Upstash) is the follow-up if abuse outgrows it. Upvote GET (status read) and 400/404 paths are intentionally unthrottled.

**Audit-only findings from the 2026-11-08 hardening pass (no code change):**
- **Safari MediaRecorder mime** — already fixed, not a residual blocker: `pickRecordingMimeType()` (`src/lib/recording-mime.ts`) feature-detects and falls through `audio/webm` to `audio/mp4`; wired into both `stt-demo.tsx` and `voice-clone-upload.tsx`. Residual: the 2026-11-08 browser pass was Chromium-only, so the Safari recording path itself remains unexercised end-to-end.
- **`WorkerTransport` single-slot hazard** — known and deliberately managed, see the 2026-08-04 STT section above: UI-level synchronous claim (`captureClaimRef`) enforces mutual exclusion instead of changing the transport; the tracked-but-not-implemented follow-up is a timeout around the unbounded `recorder.onstop` await (a stuck `onstop` strands the claim and freezes both capture buttons until reload).

## Pages & SEO surface (2026-11-08)

- **`/blog`** (added 2026-11-09) — lab-notebook blog driven by `src/lib/blog-posts.ts` (4 posts, `BlogPostMeta[]`); dynamic `/blog/[slug]` prerendered (incl. `underdog-woof-deep-dive`). Nav entry `{ href: "/blog", label: "Blog" }` in `src/lib/constants.ts`. Browser-verified 2026-11-09: index + deep-dive render with correct h1; the OG image serves as a real 1200x630 PNG from the page's own `og:image` URL — note Next 16 builds the metadata route under a hash (`/blog/[slug]/opengraph-image-x8nqxr`), so the bare `/opengraph-image` path 404s by design; always cite the URL from the rendered meta tag.
- **`/finetune`** (added 2026-11-09) — Finetune Lab (see its section above). Nav entry `{ href: "/finetune", label: "Finetune" }` in `src/lib/constants.ts`.
- **`/limits`** — the WebGPU/WASM limits thesis as a dated (Nov 2026), externally cited report.
- **`/faq`** — 12 FAQs + `FAQPage` JSON-LD.
- **`/benchmark`** — reworked to external, cited measurements only; no self-measured leaderboard.
- **`public/llms.txt` + `public/llms-full.txt`** — GEO content for LLM crawlers. They name individual models, sizes, and the LLM tier system; keep them in sync when the roster or engine table changes.
- **Structured data:** `serializeJsonLd` helper (`src/lib/jsonld.ts`, script-tag-safe serialization), `BreadcrumbList` JSON-LD on model and compare pages, `src/app/icon.svg`, and `src/app/manifest.ts` (PWA manifest).

Upgrade-wide verification status: `tsc` clean, **340 vitest tests passing (31 files, as of 2026-11-09)**. Browser passes completed 2026-11-08: **kitten-tts synthesis** (after the eSpeak `.default` loader fix), **woof-tts synthesis**, and **woof-tts WebGPU backend** (`__woofVerify()` corr 0.9999998 vs CPU, GPU 194 ms vs CPU 6094 ms; UI demo renders audio with backend auto→webgpu and forced wasm). Browser passes completed 2026-11-09: **webllm + wllama LLM engines load via the voice-agent picker** (after the loadEpoch guard fix — see the LLM section) and **/finetune real WebGPU training** (after the WGSL `target` reserved-keyword fix — see the Finetune section). Still **pending a manual/E2E browser pass**: distil-whisper STT inference, LLM generation on any tier, and the webllm 4B entry.

**Local-build cache trap (hit on 2026-11-08):** `unstable_cache` entries persist in `.next/cache/fetch-cache` across local builds, and DB writes (seed, cleanup, SQL) do not bust the tags. A build after re-seeding therefore prerendered the OLD roster (26 model pages, 156 compare pages, no `woof-tts.html`/`chatterbox.html`) from stale cached slug lists. After any DB mutation, `rm -rf .next/cache` before `next build`, and verify the route table (or count `.next/server/app/models/*.html`) before shipping.
