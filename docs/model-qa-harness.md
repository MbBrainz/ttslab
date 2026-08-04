# Automated Model QA Harness — Design (2026-07-20)

Goal: an agent can integrate a new TTS/STT model and then determine **autonomously, locally, programmatically** whether its output is correct — no human listening. Derived from an audit of the existing harness plus an empirical sweep of candidate detectors.

## Why this is needed

Audio correctness is currently only checkable by ear. Agents can't hear, so every model integration is validated by "it produced a waveform and compiled." Defects like superimposed/repeated speech ship until a human notices weeks later.

## What already exists (and why it didn't catch anything)

`src/lib/testing/` has a real harness: `audio-analysis.ts` (echo/silence/clipping/energy), `wer.ts`, `tts-quality-runner.ts`, and the `/internal/tts-quality` page. Four structural blind spots:

1. **The DSP layer is dead code.** `phraseVerdict()` (tts-quality-runner.ts:100) is never called. `overallVerdict()` reads only `sttRoundTrip.verdict`. Nothing `audio-analysis.ts` computes can fail a test.
2. **`detectEcho` scans lags 50–500ms** — autoregressive duplication happens at 1–5s utterance offsets. Measured: clean 0.044 vs duplicated 0.048 vs overlapped-at-1.2s 0.049. It cannot see the failure it exists for.
3. **WER is clamped to 1.0** (wer.ts:92), so `LOOPED x2`, `LOOPED x3`, and `total garbage` all score exactly 1.000. Uncapped they separate (1.0 vs 2.0). `computeWER` computes S/D/I and `PhraseResult` discards it.
4. **The cloned-voice path is never tested.** `testPhrase` calls `worker.synthesize(slug, text, voice)` — no `speakerEmbeddingUrl`. The broken configuration is structurally untestable. The streaming path is likewise never exercised.

Also: the WER normalizer false-fails 6/10 *correct* outputs (`DIGIT_WORDS` covers only 0–10; `$42.50`, `Dr.`, contractions all → WER 1.000 FAIL).

## Architecture

**Generate in browser, analyze in Node, keep the artifacts.**

```
scripts/model-qa.mjs            puppeteer → prod build → drives window.__modelQA
   ↓ writes                     per case: WAV + metadata to qa-artifacts/<run>/
src/lib/audio-qa/*.ts           pure TS metrics — no browser, unit-testable
   ↓                            scored offline; re-scorable without regenerating
qa-artifacts/<run>/report.json  machine verdict for agents
qa-artifacts/<run>/report.md    human summary + links to the failing WAVs
```

Three properties this buys:
- **Failures are listenable.** A verdict points at a file you can play.
- **Metrics are unit-testable** against synthetic signals — the detector itself gets tested, so it can be trusted.
- **Re-scoring is free.** Threshold changes don't require re-downloading 500MB of models.

Prerequisite unlock: expose `window.__modelQA = { run, listModels }` on the internal page (~5 lines). Today it's button-driven only, so automation must scrape the DOM.

## Metric stack

Tier 1 — pure DSP, no new dependencies, no model downloads:

| # | Check | Catches | Threshold |
|---|---|---|---|
| 1 | **Cepstral peak prominence** (real cepstrum, peak/median over lags 0.15–3.0s) | repeats, echo, looping, **additive overlap** | ratio > 50 |
| 2 | **Duration ratio** vs expected-from-text | doubling, truncation, **sample-rate relabel** — pre-ASR, no model | `\|log2(ratio)\| > 0.7` FAIL, `> 0.4` WARN. Report the ratio — it names the bug (0.5 slow, 2.0 fast, 1.5 = 24k↔16k) |
| 2b | **F0 median** (YIN, ≥50 voiced frames, log2 domain) — *confirmation only* | confirms a duration failure is a rate error | <65Hz or >350Hz confirms; otherwise inconclusive (~50% of the time) |
| 2c | **Bandwidth** `f_max = max{f \| 10log₁₀(P(f)/P_peak) ≥ −50dB}` — a **quality/provenance** metric, never a rate check | model rendering below its claimed native rate | flag `f_edge < 0.85 × claimed_Nyquist` |
| 3 | **Insertion rate `I/N`** + S/D/I breakdown, uncapped WER | *which* failure mode: I≫S,D = loop; D≫ = truncation; S≫ = mispronunciation. Use `I/N` (unbounded) not WER (saturates) as the primary non-termination signal | — |
| 8 | **Dual-threshold energy VAD** (frame energy + zero-crossing rate, noise floor from quietest frames) | babbling, fragmentation, segment counting | ~40 lines pure DSP |
| 4 | **ΔWER vs pinned reference TTS** | intelligibility regression, ASR-floor-independent | Δ>2pp warn |
| 5 | **Frame-RMS silence** (20ms frames, −45 dBFS gate) — runs as a **pre-gate before WER** | trailing babble, dead audio | level-independent |
| 6 | **Consecutive-run clipping** (runs ≥3 samples ≥0.99) | overdrive | any run |
| 7 | **NaN/Inf/DC offset** | catastrophic | any NaN = instant fail |

Tier 2 — worth the download, add after Tier 1:

| Check | Model | Size | Note |
|---|---|---|---|
| Artifact score | DNSMOS P.835 | 1.16MB, CC-BY-4.0 | Uniquely browser-viable: graph has **no STFT/DFT/LSTM** — raw waveform in, 3 scores out |
| Cloned-voice similarity | WeSpeaker ResNet34-LM | 25MB | 15× smaller than WavLM-SV (384MB) but needs Kaldi fbank in JS |

### Why cepstral for #1
Swept three candidates on synthesized speech: cepstral 32/32 duplicates caught, 0/8 false positives, 4.2× margin. Envelope autocorrelation and MFCC lag-SSM each 9/11 and both blind to additive overlap. Envelope-only also false-positives when two different sentences share rhythm.

### Known blind spot: variable-speed overlap
Measured 2026-07-20 against `public/audio-samples/speecht5.wav`: clean = cepstral 8.3, envelope-autocorr 0.231. Synthetic **constant-delay** overlap = cepstral 280–352; duplicate concatenation = 226. Excellent separation. But synthetic **different-speed** overlap (1.35×) = cepstral 8.6, autocorr 0.184 — **indistinguishable from clean**. Both metrics assume a fixed lag; a time-warped copy has none.

A third metric partially covers it: **pause fraction** (−35 dBFS) — clean 0.17 vs overlapped 0.07–0.10, since superimposed speech fills each other's gaps. Ship all three, and treat "clean on cepstral" as *not* proof of no overlap when speeds may differ.

### Why not Silero VAD
It looks free (2.2MB already vendored) but doesn't measure what we need. `NonRealTimeVAD` loads `silero_vad_legacy.onnx`, not the vendored v5; and `redemptionMs: 1400` merges every internal pause on a 2–3s utterance into a single segment — destroying exactly the segment-count signal the check exists for. Reconfiguring it down to ~100–200ms means tuning an ML model to behave like an energy gate. Its size earns its keep on noisy mic input; our task is clean synthetic audio versus silence. A dual-threshold energy VAD is ~40 lines and composes with check #5. This keeps the stack model-free except DNSMOS.

### Why frame-RMS for #5
The current per-sample test is level-dependent, and TTS output levels vary per model. Same clean speech, zero silence present: at −12 dBFS the repo metric reports 0.018, at −40 dBFS it reports 0.420 — crossing the warn threshold on nothing.

## Two framing corrections that matter

**Don't gate on absolute WER.** Browser-sized Whisper has a 5–8% WER floor on pristine human audio, so a 10% gate sits ~2pp above noise, and good TTS routinely *beats* its ground truth (over-articulation). Gate on **ΔWER vs a pinned reference TTS** (Kokoro) run in the same pass, plus a floor check against committed WAVs that short-circuits when the ASR/audio pipeline changed rather than the TTS.

**Energy-gate before WER, or silence scores as a pass.** Whisper hallucinates on silent input — "Thank you.", "Thank you for watching", "❤️ Translated by Amara.org Community" (50+ catalogued in openai/whisper#928). Measured: against Harvard-length references (8–10 words) every hallucination scores WER 1.00 and correctly fails, but against a 2-word reference "Thank you." scores **0.00 — a perfect pass on dead audio**. So: gate on frame-RMS energy plus Whisper's `no_speech_prob` *before* computing WER, keep a hallucination denylist, and never use test prompts under ~6 words. Note larger Whisper models hallucinate on silence *more*, not less — a bigger judge is not a safer judge.

**Absolute catastrophe gate belongs in 35–50%, start at 40%.** Legitimate models hit 6.8–10.3% WER on hard text without failing, so a gate below ~30% false-fires on hard input; a collapsed autoregressive baseline measures 34.16% (MaskGCT, Seed test-hard). Below 30% you catch healthy models, above ~50% you miss real collapse. This is the backstop; ΔWER is the regression gate.

**Don't report mean WER.** It's word-weighted, so one garbage sentence in 50 moves it ~2pp and hides a 2% failure rate. Report median, P95, max, and fraction above 20%/50%.

**Test corpus:** Harvard/IEEE sentences (720, phonetically balanced, no digits or abbreviations). Not SUS — Whisper rewrites nonsense into fluent-but-wrong English, inflating WER for ASR reasons. Not LJSpeech — full of dates and currency, so its WER measures your text normalizer.

## Repro conditions that matter (from the user, 2026-07-21)

The SpeechT5 cloned-voice instability is **length- and source-dependent** — earlier short-clip tests under-triggered it:
- **Use test text that generates >10 seconds of audio.** Instability appears in long generations; short clips truncate but don't stutter.
- **Microphone-recorded clones trigger it worse than uploaded WAVs.** Mic capture (with the browser's default AGC/noise-suppression, and whatever room noise) produces a further-out-of-distribution embedding than a clean file.
- Ground-truth artifact: `speecht5-1784627372628.wav` (16kHz, 12.64s, sustained energy throughout, mic-cloned) — stutters from ~4s. This is a **stutter/repeat**, not the earlier truncation and not the reference clips' behavior. Keep it as the canonical known-bad.

### Ground-truth defect characterization (analyzed 2026-07-21, 4 methods agree)
The failure is an **autoregressive decoder repetition loop**, not superposition or babble:
- **Transcript** (Whisper): coherent intro then looping real words — "sophisticated, sophisticated", "Union and Union and Union", "computer and computer and". EOS never fires; decodes to the max-length cap.
- **MFCC repeat-similarity** (300ms template, best match at lag 0.15–1.5s): 0.37–0.78 while clean, then a **razor-sharp jump to 0.80–0.98 at 3.8s, locked high to the end**. This is the primary stutter detector — threshold ~0.85 sustained over >1s of frames. Onset time matches the user's ear ("from 4s") to the second.
- **Self-similarity matrix**: off-diagonal stripes only after 3.8s, repeat lags ~0.4–0.75s (word/syllable cadence).
- **Superposition ruled out**: single pitch track (the "2nd voice" is its /2 subharmonic); envelope modulation *drops* in the repeat region (would rise if summed); raw-waveform xcorr low (0.16–0.40) where MFCC sim is 0.90+ → repeats are **re-synthesized each pass, not a buffer splice**.

This validates the harness thesis: a human "something's wrong" became a precise thresholdable verdict — repetition, word-level, onset 3.8s, single voice — with no listening. **Add sustained MFCC repeat-similarity as a detector** alongside the cepstral check; the cepstral peak targets constant-delay overlap, this targets re-synthesized word-level stutter (which cepstral partially sees but MFCC-similarity nails).

### Root cause (mechanism, not yet fixed)
OOD speaker embedding: the mic-cloned WavLM x-vector (L2≈5.65) lies far from the CMU-ARCTIC/SpeechBrain x-vectors SpeechT5 was trained on. This destabilizes (i) attention alignment over text-encoder states and (ii) stop-token/EOS confidence. Once alignment stalls the decoder re-attends spoken text and loops to the length cap. Longer text = more room to enter/stay in the loop. Candidate fixes to evaluate (separate work): L2-normalize the embedding (necessary, proven insufficient alone); project/whiten WavLM x-vectors toward the SpeechBrain space; cap `maxlenratio` and/or add a repetition penalty at decode; or switch the cloning path to a model whose speaker space matches its decoder (Chatterbox's native speech_encoder — see relaunch plan).

Implication for the harness fixtures: the SpeechT5-cloned known-bad case must use a >10s prompt and, ideally, a mic-captured reference embedding — otherwise the detector calibrates against a symptom milder than the real one.

## Calibration = the harness's own acceptance test

Thresholds are only trustworthy if proven to discriminate. Two fixtures:
- **Known-good:** Kokoro, stock voice.
- **Known-bad:** SpeechT5 + cloned voice (the current live defect).

The harness is not done until it passes the first and fails the second, for the right reason and with margin.

## Coverage matrix

Each model × {stock voice, cloned voice} × {non-streaming, streaming} × {WASM, WebGPU}. The cloned and streaming axes are exactly what's untested today.

## Skill surface

`/qa-model <slug>` → runs the harness, returns a verdict an agent can branch on:
```json
{ "slug": "speecht5", "verdict": "FAIL",
  "failures": [{ "check": "cepstral_repeat", "value": 187.3, "threshold": 50,
                 "case": "cloned/non-streaming",
                 "artifact": "qa-artifacts/2026-07-20T.../speecht5-cloned-03.wav" }] }
```
Agent loop becomes: integrate model → `/qa-model` → read failures → fix → re-run.

## Build order

1. Wire `phraseVerdict` into `overallVerdict` — make the existing DSP layer actually gate
2. Replace `detectEcho` with the cepstral detector
3. Uncap WER; surface S/D/I in `PhraseResult`
4. Frame-RMS silence **as a pre-gate ahead of WER** (+ `no_speech_prob` + hallucination denylist); consecutive-run clipping
5. Duration band as a pre-ASR filter
6. Thread `speakerEmbeddingUrl` + streaming through `testPhrase` — close the coverage hole
7. `window.__modelQA` hook + `scripts/model-qa.mjs` + WAV artifact dumping
8. Harvard fixture; reference-TTS control; ΔWER gating
9. Vitest unit tests for every metric against synthetic signals
10. Then, optionally: DNSMOS, Silero VAD segments, WeSpeaker similarity

Steps 1–6 are pure TypeScript with no new dependencies and fix every bug listed above.

## Sample-rate mismatch: what is and isn't detectable

Two distinct failure modes, routinely conflated:

| | **Mode 1 — RELABEL** (the bug) | **Mode 2 — RESAMPLED CONTAINER** (benign) |
|---|---|---|
| What happened | 24k samples, buffer claims 44.1k | 24k audio correctly resampled to 44.1k |
| Sounds like | **Chipmunk / slow-motion** | Fine |
| Duration & F0 | **Wrong by ratio r** | Correct |
| Spectrum | Full to Nyquist — looks normal | Brickwalled (−90dB vs −31dB genuine) |

**Nyquist-edge detection cannot find Mode 1 — structurally, not just weakly.** A relabel changes no sample; DFT magnitudes are bit-identical and only the frequency labels `f_k = k·Fs/N` scale. Verified: the same buffer claimed at 16k/24k/44.1k gives edge bin 280 in all three cases, ratio-to-Nyquist 0.5469 identically. No threshold can ever separate them. **Duration ratio is the detector**; a rate error is a time-base error.

F0 alone catches only ~half of 2× errors on unknown-gender voices: the male→female F0 gap is 8.98 semitones and a 2× error is 12.00 — only 3 semitones apart, so a male voice at 2× speed (262Hz) reads as a 96th-percentile woman. But F0 becomes excellent **against a pinned reference render of the same voice**, which the ΔWER design already produces — that removes the gender bimodality and makes even 1.5× (7 st) trivial against a within-speaker prosodic SD of 2.7 st.

**48k↔44.1k and 24k↔22.05k are undetectable acoustically** — ratio 1.088 is 1.47 semitones and 8.8% duration error, inside the ±10% that standard ASR speed augmentation treats as in-distribution. Assert on `AudioBuffer.sampleRate` directly instead.

Also skip: **spectral centroid** as a rate detector (relabel moves it 7–18%, but normal spectral-tilt variation moves it 2.85× — confound 15× larger than signal); **pYIN** (10–25 cent precision for a 700–1200 cent decision, ~100× slower than plain YIN); **AMDF** (documented bias toward longer lags, i.e. toward halving F0 — fatal in a halving detector).

Note: Whisper hardcodes 16kHz and will not fail loudly on wrong-rate input — it returns a plausible wrong transcript, so "the ASR errored" is not available as a signal.

## Implementation landmines

- **Spectral flatness: floor the spectrum with an epsilon.** A single empty bin makes the geometric mean zero, so *noisy* output reports as *perfectly tonal* — the metric inverts rather than degrades.
- **Per-model exemptions are required.** Bark generates music, laughter, and crying by design; a checker treating non-speech as failure would flag it working correctly. The config needs per-model opt-outs for specific checks.
- **Never gate on prompts under ~6 words** (see the hallucination trap above). Current `DEFAULT_PHRASES` are 8–10 words and fine.
- **Compute spectral measures on power, not magnitude, and remove DC first.** DC at −10dB drags a linear-magnitude centroid from 1550→1178 Hz; a −40dB noise floor inflates a magnitude-weighted centroid 89% versus 13% power-weighted. Energy-gate frames at ~peak−40dB.
- **The duration prior has no academic citation — don't invent one.** No published TTS evaluation uses a duration-plausibility gate. Defensible band is 11–19 chars/s (ACX's 155 WPM trade norm × 5.7 chars/word), but prefer **word counts on normalized text**: "$1,234,567.89" is 13 characters and ~5 seconds of speech.
- **Recalibrate every threshold against real model output before shipping.** The separation figures here assume idealized brickwall filters; real vocoder resamplers have finite stopband attenuation.

## Prior art

VERSA (Apache-2.0, 90+ metrics) is Python/Slurm — research, not CI. A GitHub search for TTS regression/quality-gate harnesses returns zero repos. There is no browser-based prior art to copy, and nothing to stay compatible with.
