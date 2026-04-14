---
name: tts-quality-test
description: Run the TTS quality test suite against all or specific models. Tests audio quality (echo, silence, clipping, energy) and correctness (STT round-trip, WER). Use when adding new models, debugging audio issues, or validating model integrations.
---

# TTS Quality Test

Automated quality validation for TTS models. Loads each model in-browser, generates speech, runs STT transcription, and computes quality metrics.

## When to Use

- After integrating a new TTS model
- After changing a loader (sample rate, buffer handling, quantization)
- When users report echo, garbled output, or silence issues
- As a pre-commit check before merging model changes
- Periodically to catch regressions

## Prerequisites

Dev server must be running. Check ALL common ports — Next.js auto-increments if a port is taken:

```bash
# Check ports 3000-3005
for port in 3000 3001 3002 3003 3004 3005; do
  lsof -ti:$port 2>/dev/null && echo "port $port: running" || true
done

# Start in tmux if needed
if [ -n "$TMUX" ]; then
  tmux new-window -n "dev-server" "pnpm dev"
fi
```

**IMPORTANT:** The dev server may run on port 3001 OR 3003 (or others). If one port returns 404, try the next. The functional tester should try `localhost:3001` first, then `localhost:3003` as fallback.

## Running Tests

### Option A: Full Suite (All Models, ~25 min)

Use the `frontend-functional-tester` agent with this prompt:

```
You are testing the TTS quality test suite. Try http://localhost:3001/internal/tts-quality first. If that returns 404, try http://localhost:3003/internal/tts-quality.

Steps:
1. Navigate to the page. Verify "TTS Quality Test Suite" heading loads.
2. Leave the model filter empty (tests all models).
3. Click the "Run All" button (data-testid="run-all-btn").
4. Monitor console for errors throughout.
5. Wait for data-testid="status" to show "complete" — check every 30s, timeout after 25 minutes.
   Large models (chatterbox ~16min, chatterbox-turbo ~6min) take a long time. Be patient.
6. Click "Raw JSON Report" to expand it.
7. Read the full JSON from data-testid="results-json".
8. Report: the full JSON, any console errors, and a summary table of model → verdict.
```

Expected timing per model:
- kokoro-82m: ~1s load (WebGPU), ~300ms/phrase
- supertonic-2: ~1s load (WASM), ~500ms/phrase
- speecht5: ~1.3s load (WASM), ~1s/phrase
- piper-en-us-lessac-medium: ~60-90s load (WASM), ~1s/phrase
- chatterbox: ~15-16min load (WASM), ~25s/phrase
- chatterbox-turbo: ~5-6min load (WASM), ~12s/phrase

### Option B: Single Model

Use the `frontend-functional-tester` agent (replace MODEL_SLUG):

```
You are testing a single TTS model. Try http://localhost:3001/internal/tts-quality first, fallback to http://localhost:3003/internal/tts-quality.

Steps:
1. Navigate to the page.
2. Type "MODEL_SLUG" in the model filter input.
3. Click "Run All" (data-testid="run-all-btn").
4. Wait for data-testid="status" to show "complete" — check every 30s, timeout 20 minutes.
5. Click "Raw JSON Report" to expand, read JSON from data-testid="results-json".
6. Report: full JSON, console errors, verdict.
```

### Option C: Test → Fix → Retest Loop

For investigating and fixing failing models:

1. Run Option A or B to identify failures
2. For each failing model, investigate the loader at `src/lib/inference/loaders/<model>.ts`
3. Apply fix (see "Common Fixes" below)
4. Re-run Option B for the fixed model only
5. Repeat until PASS

When dispatching parallel fix agents, give each agent:
- The full JSON result for their model
- The loader file path
- The specific failure mode (high WER, echo, silence, etc.)
- Instructions to run `pnpm tsc --noEmit` after changes

### Option D: Direct Browser (Manual)

Navigate to `http://localhost:3001/internal/tts-quality` in a browser with GPU access.

## Interpreting Results

### Pass/Warn/Fail Thresholds

| Check | Pass | Warn | Fail |
|-------|------|------|------|
| Echo (autocorrelation) | < 0.3 | 0.3-0.5 | > 0.5 |
| WER (word error rate) | < 15% | 15-30% | > 30% |
| Silence ratio | < 30% | 30-50% | > 50% |
| Clipping | < 0.1% | 0.1-1% | > 1% |
| RMS energy | > -40 dB | -40 to -50 dB | < -50 dB |

### What Each Metric Means

- **Echo detected**: Audio has repeated signal pattern (autocorrelation spike at 50-500ms delay). Usually means duplicate buffer concatenation in loader.
- **High WER**: STT can't understand the output. Garbled audio, wrong sample rate, encoding issue, or missing model-specific text preprocessing.
- **High silence ratio**: Model generating mostly silence. Check if model loaded correctly.
- **Clipping**: Samples hitting ±1.0. Volume normalization issue. Minor clipping (<0.03%) is normal for chatterbox variants.
- **Low energy**: Audio is extremely quiet. Check gain/amplitude in loader.

### Verified Baseline (2026-04-14)

| Model | Verdict | Avg WER | Load Time | Notes |
|-------|---------|---------|-----------|-------|
| kokoro-82m | PASS | 0% | 970ms | WebGPU, fastest model |
| supertonic-2 | PASS | 0% | 1.1s | Requires `<en>` language tags |
| speecht5 | PASS | 0% | 1.3s | Stable |
| piper-en-us-lessac-medium | PASS | 0% | 82s | Uses clause-level text splitting |
| chatterbox | PASS | 0% | 955s | Minor clipping (0.02%), peak slightly >0dB |
| chatterbox-turbo | PASS | 0% | 329s | Minor clipping (0.02%), same saturation pattern |

### STT Judge Limitations

- Default judge: `moonshine-tiny` (English only, ~390MB, fast)
- STT has its own error rate (~5-10% on clean speech)
- WER threshold of 15% accounts for STT noise
- WER normalizer converts digits to words (e.g., "5" → "five") to avoid false positives
- **Avoid test phrases that are pure number sequences** — STT transcribes spoken "one two three" as "123" causing 100% WER false positives. Use embedded numbers in natural sentences instead (e.g., "She bought five apples").

## Common Fixes (Learned from Past Runs)

### Garbled/Repetitive Output (supertonic-2 pattern)

**Symptom:** STT transcribes "quick, quick, quick, quick" or similar repetitive phonemes. WER ~75-100%.

**Root cause:** Missing model-specific text preprocessing. Some models require language tags, phoneme conversion, or specific tokenization.

**Fix checklist:**
1. Check the model's HuggingFace card for inference examples
2. Look for required text wrapping (e.g., `<en>text</en>` for Supertonic-2)
3. Check `num_inference_steps` — use the model's documented default, not arbitrary values
4. Compare with HuggingFace JS example code for exact parameter names

**Example fix (supertonic-2):** Text must be wrapped in language tags: `<en>Hello world</en>`

### Truncated Output (piper pattern)

**Symptom:** Audio cuts off mid-sentence. STT gets first half of phrase, rest missing. WER 30-40%.

**Root cause:** VITS attention mechanism loses alignment on long phoneme sequences. Single long utterances get truncated.

**Fix:** Split long text into shorter chunks before synthesis, synthesize each chunk, concatenate audio buffers. Split on clause-level punctuation (commas, semicolons) when segments exceed ~8 words.

**Example fix (piper):** Added `splitForVits()` in loader that breaks text on clause boundaries.

### Echo Detected

1. Check loader's `synthesize()` — is it concatenating audio buffers incorrectly?
2. Check if `Float32Array` is being reused/shared between calls
3. Look for duplicate `audio.data` copies in the return path
4. Fix location: `src/lib/inference/loaders/<model>.ts`

### High WER (General)

1. Check sample rate — does the loader declare the correct output sample rate?
2. Check audio encoding — is the PCM data actually Float32 normalized to [-1, 1]?
3. Try listening to the audio manually on the model page (`/models/<slug>`)
4. If WER is 100%, model may have failed silently (returned silence or noise)
5. Check if model needs specific text preprocessing (language tags, phonemization)

### High Silence

1. Check if model warm-up is working (first inference may be blank)
2. Check leading/trailing silence values — some padding is normal (200-500ms)
3. If ratio > 80%, model may not be generating speech at all

### Minor Clipping (chatterbox variants)

Chatterbox and chatterbox-turbo produce peak dB slightly above 0 dB (+1.0 to +1.2 dB). This causes ~0.02% clipping (12-19 samples out of ~80k). This is within normal range and does not affect audio quality. Do not "fix" this — it's inherent to the model's output amplitude.

## Files

| File | Purpose |
|------|---------|
| `src/app/internal/tts-quality/page.tsx` | Test page UI |
| `src/lib/testing/tts-quality-runner.ts` | Orchestration (load STT judge, loop models) |
| `src/lib/testing/audio-analysis.ts` | Echo, silence, clipping, energy detection |
| `src/lib/testing/wer.ts` | Word Error Rate computation (with digit normalization) |
| `src/lib/testing/types.ts` | Report types, thresholds, test phrases |

## Test Phrases

Current default phrases in `src/lib/testing/types.ts`:

```typescript
{ text: "The quick brown fox jumps over the lazy dog.", category: "pangram" }
{ text: "Hello, my name is Alice and I live in New York.", category: "natural" }
{ text: "She bought five apples and three oranges at the market.", category: "embedded-numbers" }
```

**Design principles for test phrases:**
- Keep under 12 words (VITS models struggle with longer utterances)
- Embed numbers in natural sentences, never as bare sequences
- Use common words STT handles well — avoid abbreviations, acronyms, rare proper nouns
- Each phrase should test something different (variety of phonemes, natural speech, numbers)

## Extending to Non-English

For multilingual models, pass `whisper-tiny` as STT judge:

```typescript
// In tts-quality-runner.ts, change:
const DEFAULT_STT_MODEL = "whisper-tiny"; // multilingual, ~1.7GB
```

Or override via `TestConfig.sttModel` when calling `runQualityTests()`.
