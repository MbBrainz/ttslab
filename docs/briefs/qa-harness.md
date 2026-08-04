# Brief: QA harness — make the verdict trustworthy, then automate it

You are working in `/Users/mauritsbos/code/ttslab` on branch `main`.

**A second Claude session is working in this same repo at the same time**, on the
STT demo (`src/components/stt-demo.tsx`, `src/lib/hooks/use-live-transcription.ts`).
Rules that follow from that are non-negotiable:

- **Only touch files in your scope list below.** If you believe you need a file
  outside it, stop and report instead of editing.
- **Never `git add -A`, `git add .`, or `git commit -a`.** Stage explicit paths
  only.
- **Never** `git rebase`, `git reset --hard`, `git checkout <branch>`,
  `git stash`, or force-push. The main folder stays on `main`.
- If `git status` shows changes to files outside your scope, they belong to the
  other session. Leave them completely alone.

## Your scope

Owned (you may edit / create):
- `src/lib/testing/*` (audio-analysis.ts, wer.ts, tts-quality-runner.ts, types.ts)
- `src/lib/audio-qa/*` (new)
- `scripts/model-qa.mjs` (new)
- `src/app/internal/tts-quality/page.tsx`
- Test files you add for the above

Read-only (understand, do not edit):
- `src/lib/inference/*`
- `docs/model-qa-harness.md` — **this is your spec. Read it in full first.**

## Context: verified findings, do not re-investigate

All of these were checked against the current code:

- `phraseVerdict()` (`tts-quality-runner.ts:100`) is **dead code** — the only
  occurrence of that identifier in the repo is its own definition.
- `overallVerdict()` (`:106-111`) reads only `t.sttRoundTrip.verdict`. It never
  touches `t.audioAnalysis`. **Consequence: every acoustic detector that exists
  — echo, silence, clipping, energy — runs but cannot fail a test.** The only
  thing gating pass/fail is WER.
- WER is capped: `Math.min(totalErrors / refWords.length, 1)` at `wer.ts:92`. So
  a 2x-looped output and total garbage both score exactly 1.000 and are
  indistinguishable. `computeWER` does compute S/D/I at `:94`, but `PhraseResult`
  (`types.ts:39-49`) discards them.
- The WER normalizer false-fails *correct* output — `DIGIT_WORDS` covers only
  0–10, so `$42.50`, `Dr.`, and contractions all score WER 1.000 FAIL.
- **Voice cloning is never tested.** `testPhrase` (`:115-145`) calls
  `worker.synthesize(modelSlug, phrase.text, voice)` with no
  `speakerEmbeddingUrl`, even though `InferenceWorkerAPI.synthesize` supports it.
  Streaming is never exercised either.
- **There is no automation surface.** `window.__modelQA`, `src/lib/audio-qa/`,
  and `scripts/model-qa.mjs` do not exist. The page is button-driven only.
- **There is no improvement loop of any kind.** Nothing retries, tunes a
  threshold, or changes config. It is a report generator.

This matters right now: the voice-cloning feature was just committed
(`d5e1bd1`), and the harness structurally cannot verify it.

## Work order — one commit per step, verified before moving on

The user's instruction was "slowly but safely and surely". Do not batch these.
Steps 1–3 are small and remove actively misleading behaviour — they are the
priority. Do not start step 5 until 1–4 are committed and green.

1. **Wire `phraseVerdict` into `overallVerdict`** so the acoustic detectors
   actually gate. (`tts-quality-runner.ts:100-111`)
2. **Uncap WER and surface S/D/I** through `PhraseResult`. Add insertion rate
   `I/N` as the primary non-termination signal — per the spec, WER saturates and
   `I/N` does not. (`wer.ts:90-94`, `types.ts:39-49`)
3. **Fix the normalizer** — currency, abbreviations, contractions, digits beyond
   10. (`wer.ts:4-20`)
4. **Unit tests for the metrics, against synthetic signals.** Per the spec, this
   calibration *is* the harness's own acceptance test — a detector nobody has
   tested cannot be trusted to gate anything. Check whether a test runner is
   already configured; if none is, report before adding one.
5. **Tier-1 DSP metrics**, in the spec's order: cepstral peak prominence
   (replacing `detectEcho`, whose 50–500ms lag window cannot see the 1–5s
   duplication it exists to catch), duration ratio, frame-RMS silence pre-gate,
   consecutive-run clipping, NaN/Inf/DC. Each with unit tests.
6. **Thread `speakerEmbeddingUrl` and streaming through `testPhrase`** so the
   cloned-voice path — the known-broken one — becomes testable at all.
7. **Automation:** expose `window.__modelQA = { run, listModels }` on the
   internal page, add `scripts/model-qa.mjs` (puppeteer) driving it, dump WAV +
   metadata artifacts per case, emit `report.json` + `report.md`. The point is
   that failures become listenable and re-scorable without regenerating audio.

**Out of scope — do not attempt.** STT-standalone QA, voice-agent QA, and any
actual "automatic improvement" feedback loop are all undesigned. They are not in
`docs/model-qa-harness.md` and need their own spec first. If you finish 1–7,
stop and report rather than inventing a design for these.

## Verification — required before you claim any step is done

- `npx tsc --noEmit --pretty` must be clean.
- `./node_modules/.bin/next build --webpack` must succeed, and the route table
  must still show `○`/`●` for all pages and OG images with only `/api/*` as `ƒ`.
  (Use the binary directly; `pnpm build` triggers a TTY-gated dep check.)
- Biome currently reports ~91 pre-existing errors repo-wide, **including some in
  `wer.ts`. Do not fix unrelated ones**; just don't add new ones in your files.
- For steps 1–3, prove the change with a before/after on a real case: a looped
  output and a garbage output must now score differently, and `$42.50` must stop
  false-failing. **Show the actual numbers.** Do not claim a scoring fix works
  because it compiles.

## Report back

After each commit, report: what changed, the tsc/build result, the concrete
before/after numbers for any scoring change, and anything you found that
contradicts this brief. Contradicting the brief is a valid and useful outcome —
say so plainly rather than working around it.
