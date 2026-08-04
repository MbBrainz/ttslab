# TTSLab Relaunch Plan (2026-07-17)

Synthesized from a 5-agent review: architecture, security/perf/caching, product/UX/SEO, model-catalog research, voice-cloning deep-dive. Goal: a task list to execute before re-publishing TTSLab on LinkedIn.

## Headline verdict

- **Strengths (verified):** worker-isolated inference architecture, zero-copy audio transfer, fully compliant tag-only caching (build shows all pages static), clean bundle hygiene, good OG images + per-page metadata, auto-playing hero demo.
- **Ship-blockers:** two unauthenticated/unthrottled API endpoints (upvote = forgeable ranking, subscribe = email-bomb relay); voice-clone "clear/default" bugs make the existing feature visibly broken; Safari recording broken (hardcoded `audio/webm`); `WorkerTransport` concurrent-command hang.
- **Biggest missed opportunity:** per-model sample WAVs exist in `public/audio-samples/` but are wired nowhere — every model page is a 300MB+ download wall. And Chatterbox's ONNX pipeline already includes an unused `speech_encoder.onnx` that does true zero-shot voice cloning (MIT) — dramatically better than the current SpeechT5 cloning.
- **Catalog staleness:** transformers.js 4.1.0 → 4.2.0 available (adds tool-calling), KittenTTS Nano (15M, real WebGPU) missing, Parakeet TDT 0.6B (SOTA STT) missing, OuteTTS (WebGPU cloning, but NC license) missing, chatterbox-multilingual got a fixed upstream re-export (2026-03-31) worth re-testing.

---

## P0 — Ship-blockers (do first, all S/M)

| # | Task | Size | Source |
|---|------|------|--------|
| 1 | Rate-limit + bot-gate `/api/upvote` (Turnstile or IP bucket); stop trusting client fingerprint (`src/app/api/upvote/route.ts:41`) | S/M | security |
| 2 | Rate-limit + Turnstile `/api/subscribe` before the Resend send | S/M | security |
| 3 | Fix voice clearing: worker skips `setSpeakerEmbedding(null)` (`inference-worker.ts:87,124`); "Default" dropdown passes stale embedding (`tts-demo.tsx:229,303`) | S | voice-clone |
| 4 | Fix `WorkerTransport` single-slot `pending` overwrite → reject prior pending like `LlmTransport` (`worker-transport.ts:163-168`) | S | arch |
| 5 | MediaRecorder mime feature-detect (Safari) in voice-clone-upload + stt-demo; then commit the two in-flight files (both judged sound) | S | arch + voice-clone |
| 6 | Delete dead/wrong 768-dim `last_hidden_state` fallback in `speaker-embedding.ts:88-114`; assert `output.embeddings`; decide L2-norm explicitly | S | voice-clone |
| 7 | Dispose WavLM `cachedModel` on worker dispose (~100MB leak) | S | arch |
| 8 | Bump Next 16.1.6 → 16.2.10; remove unused `ai` + `@ai-sdk/openai` deps | S | security |
| 9 | Repo hygiene: delete/relocate 4 untracked scripts; move research doc under `docs/`; commit the two good docs; fix stale CLAUDE.md backend-UI note | S | arch |

## P1 — Relaunch headline features

| # | Task | Size | Why |
|---|------|------|-----|
| 10 | **Wire existing sample WAVs into model pages** ("hear it before you download") — files already in `public/audio-samples/`; extend to all models with a generation script | S–M | Kills the #1 bounce driver |
| 11 | **Chatterbox zero-shot voice cloning**: wire `speech_encoder.onnx` (reference audio → speaker_embeddings/features → generate). MIT, no new download, WASM (WebGPU still INT64-blocked). Reference: Resemble's transformers.js demo | M | THE LinkedIn hero demo |
| 12 | Voice-clone capture quality: mic constraints (`echoCancellation:false, noiseSuppression:false, autoGainControl:false`), silence-trim + normalize + energetic-window before 10s truncate, min-duration guard, reference-audio preview/playback | M | Cloning quality + trust |
| 13 | Voice persistence: named voices in IndexedDB, multiple voices, A/B | M | Turns toy into product |
| 14 | Promote cloning: nav entry + home section + `/voice-clone` landing page with pre-generated before/after sample | M | Feature currently invisible |
| 15 | Hide `/benchmark` + `/contribute` from nav until real | S | Removes "unfinished" signal |
| 16 | Homepage order: newsletter below Featured Models + Voice Agent | S | Lead with product |
| 17 | Cancellation (AbortController) for load/synthesize/transcribe — users can't abort a 700MB download today | M | Demo-day resilience |
| 18 | Error boundary / `global-error.tsx` around demo routes | S | Demo-day resilience |

## P2 — Model catalog refresh

| # | Task | Size | Notes |
|---|------|------|-------|
| 19 | transformers.js 4.1.0 → 4.2.0 (tool-calling); onnxruntime-web dev-pin → stable 1.26.0; retest all loaders | S–M | |
| 20 | Add **KittenTTS Nano v0.8** (`onnx-community/KittenTTS-Nano-v0.8-ONNX`, 15M, FP32 WebGPU, Apache-2.0) — StyleTTS2, loader shape ≈ Kokoro | S | Smallest model in catalog, real WebGPU |
| 21 | Re-test **chatterbox-multilingual** against 2026-03-31 re-export — may flip from "broken" to shippable (WASM) | S | Free 23-lang win, also multilingual cloning |
| 22 | Add **Parakeet TDT 0.6B v2** STT (`onnx-community/parakeet-tdt-0.6b-v2-ONNX`, via parakeet.js patterns) — SOTA accuracy+speed | M–L | v3 (25 langs) is a drop-in after |
| 23 | Voice agent LLM: evaluate **LFM2.5-350M / LFM2-1.2B** (native tool-calling, pairs with 4.2.0) vs Qwen3.5 0.8B | M | |
| 24 | Spike (S each): **F5-TTS** — only cloning model with *proven in-browser WebGPU* (~200MB fp16, working reference app `nsarang/voice-cloning-f5-tts`, via DakeQQ ONNX) but **CC-BY-NC** ❌ — verify license posture before product use. **OpenVoice V2** — **MIT** ✅, ~300MB (tone extractor + converter + MeloTTS), cacheable 256-d tone embedding, ONNX exists but no in-browser demo yet (WebGPU unverified) | S+S | Two evaluated cloning upgrade paths beyond Chatterbox |
| 24b | Watch list (don't build yet): OuteTTS 1.0 (WebGPU cloning but CC-BY-NC ❌), Orpheus Nano (ONNX pending, tfjs #1252), Voxtral Realtime (3B streaming STT). Confirmed dead ends: Dia (fp32-only 6.45GB), CSM-1B/XTTSv2/Zonos (no usable ONNX; Zonos Mamba-blocked in ORT-web), SparkTTS (NC + no JS pipeline) | — | |

## P3 — Quality, SEO, hardening

| # | Task | Size |
|---|------|------|
| 25 | FAQPage + BreadcrumbList JSON-LD + visible FAQ block; AggregateRating from upvote counts; escape `<` in all 3 JSON-LD injections | S |
| 26 | Fix thin combinatorial `/compare/*` pages: substantive generated copy (verdict, when-to-use, spec deltas) or prune to curated set | M |
| 27 | Security headers: nosniff + HSTS global; CSP `frame-ancestors 'self'` but keep `/embed` frameable; `noindex` on `/internal/*` | S |
| 28 | Remove `seo-report.ai` footer badge | S |
| 29 | Shareable generated clips (artifact/permalink, not regenerate-from-URL) | M |
| 30 | Comparison matrix / sortable all-models spec table + voice sample gallery page | M |
| 31 | `BaseTransformersLoader` — deduplicate ~7 loaders (progress plumbing, dispose, WAV decode) | L |
| 32 | Minimal test harness: vitest for utils + 1 Playwright smoke; extract `useTtsGeneration` + `<MetricsGrid>` from the 600–750-line demo components; remove dead metrics (`firstByteMs`, `PerformanceTimer`), gate Supertonic debug loop | M |
| 33 | Subscribe route: PG error `code === '23505'` for dupes; validate `comparisonSlug`; drop dead `{expire:0}` arg on `revalidateTag` | S |
| 34 | PWA/offline model caching (models re-download every hard reload today) | L |

## LinkedIn post angles (pick 1–2)

1. **"Clone your voice in 30 seconds — nothing leaves your browser."** Needs: #11–14. Strongest hook (privacy + magic).
2. **"Full voice AI stack (STT→LLM→TTS), zero servers."** Needs: voice agent out of Preview + demo clip + architecture blurb (pairs with #19/#23 tool-calling).
3. **"Hear 25+ speech models side by side, instantly."** Needs: #10 + #20–22 + gallery (#30). Smallest lift.

## Suggested sequencing

1. **Week 1:** P0 (all small) + #10 + #15/#16 → site is safe and doesn't bounce visitors.
2. **Week 2:** Chatterbox cloning (#11–14) + E2E browser test via frontend-functional-tester → hero demo.
3. **Week 3:** Catalog refresh (#19–22) + SEO quick wins (#25, #27, #28) → "25+ models" claim + freshness.
4. **Then post.** P3 long-tail (#26, #29–34) continues after launch.
