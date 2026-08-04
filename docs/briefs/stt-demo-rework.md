# Brief: STT demo rework — live transcription + real waveform

You are working in `/Users/mauritsbos/code/ttslab` on branch `main`.

**A second Claude session is working in this same repo at the same time**, on the
QA harness (`src/lib/testing/`, `src/lib/audio-qa/`, `scripts/model-qa.mjs`,
`src/app/internal/tts-quality/`). Rules that follow from that are non-negotiable:

- **Only touch files in your scope list below.** If you believe you need a file
  outside it, stop and report instead of editing.
- **Never `git add -A`, `git add .`, or `git commit -a`.** Stage explicit paths
  only.
- **Never** `git rebase`, `git reset --hard`, `git checkout <branch>`,
  `git stash`, or force-push. The main folder stays on `main`.
- If `git status` shows changes to files outside your scope, they belong to the
  other session. Leave them completely alone.

## Your scope

Owned (you may edit):
- `src/components/stt-demo.tsx`
- `src/lib/hooks/use-live-transcription.ts` (new, you create it)
- A new waveform/level component if you decide one is warranted

Read-only (understand, do not edit):
- `src/lib/hooks/use-vad.ts`
- `src/lib/hooks/use-voice-agent.ts`
- `src/lib/inference/*` (worker, types, loaders)
- `src/components/hero-demo.tsx`

## Context: what's already been established

Do not re-investigate these; they were verified against the code already.

1. **The recording visualizer is fake.** `stt-demo.tsx:350` renders
   `Math.max(4, Math.min(64, audioLevel * 64 * (0.5 + Math.random() * 0.5)))`
   across 20 bars. Every bar is one scalar times a fresh random number, so it
   carries no per-frequency or per-time information — there is no audio pattern
   to display even when it "works". It also re-randomizes on unrelated React
   re-renders. This is the user's reported bug.

2. **The level scalar is fragile.** `audioLevel` is the mean of
   `getByteFrequencyData` over all 128 bins of a 256-point FFT (0–24kHz), while
   speech energy sits in roughly the bottom 20 bins. Combined with the
   `Math.max(4, …)` floor, `audioLevel` must exceed ~0.125 for any bar to leave
   the floor. Whether it actually pins at 4px depends on room noise floor — it
   was not measured. **Do not tune this. Replace it** with a time-domain
   waveform (`getByteTimeDomainData`), which sidesteps the question entirely.

3. **Two AudioContexts leak per record→transcribe cycle.** Neither
   `stt-demo.tsx:122` (`new AudioContext()`) nor `:231`
   (`new AudioContext({ sampleRate: 16000 })`) is ever `close()`d. Chrome caps
   around 6 per page, after which construction starts failing or returning
   suspended contexts — so the bug compounds the more you record. Fix both.

4. **`source` and `audioCtx` at `:122-123` are locals.** Only `analyser` is kept
   in a ref, leaving the `MediaStreamAudioSourceNode` unreferenced — a known
   Chrome GC hazard. Retain them.

5. **Ruled out, do not chase:** the new `recording-mime.ts` work (the analyser
   reads the raw MediaStream, independent of MediaRecorder); model-specific
   behaviour (`startRecording` never branches on slug — this is global to all
   STT models, not just Moonshine Tiny).

6. **An earlier analysis claimed the AnalyserNode must be connected to
   `destination` to receive data. That is wrong** — an analyser pulls from its
   input connection regardless. Do not add a zero-gain-to-destination node.

## Context: live transcription

Real-time STT here means **VAD-segmented**: text appears a few hundred ms after
each pause, not word-by-word. This matches Hugging Face's own official
`moonshine-web` reference app, which VAD-gates a non-streaming Moonshine.

True streaming Moonshine (`moonshine-streaming-tiny`) exists but is PyTorch-only
with no ONNX export — out of scope, do not attempt.

**The primitive already exists and is in production here:**
- `src/lib/hooks/use-vad.ts` wraps Silero VAD (`@ricky0123/vad-web`) and calls
  `onSpeechEnd(audio: Float32Array)`.
- `src/lib/hooks/use-voice-agent.ts:321` calls
  `sttWorker.transcribe(sttModel, audio, 16000)` on exactly that callback.

Your job is to extract the STT-only slice of that into
`use-live-transcription.ts`, without the LLM/TTS coupling, and drive the demo
from it. **No changes to `inference-worker.ts` or `types.ts` should be needed** —
the existing stateless per-utterance `transcribe` command is already the right
shape. If you think you need to change them, stop and report.

Two known constraints:
- `WorkerTransport` has a single pending slot (see the comment at
  `use-voice-agent.ts:80-82`). Two utterances arriving faster than transcription
  completes will queue or clobber. Handle it explicitly — a small queue.
- `use-voice-agent.ts:104-111` deliberately loads STT on `"wasm"`, not `"auto"`,
  to avoid WebGPU cold-start jank. Do the same, and say so in the PR notes.
- VAD tuning at `use-vad.ts:30-32` is tuned for conversational barge-in, not
  dictation. Mid-sentence pauses may split one thought into two segments. Tune
  in your new hook's own config, **do not edit `use-vad.ts`** (the voice agent
  depends on those values).

## Work order — one commit per step, verified before moving on

The user's instruction was "slowly but safely and surely". Do not batch these.

1. **Waveform + leaks.** Replace the random-bar visualizer with a real
   time-domain waveform; close both AudioContexts; retain `source`/`audioCtx` in
   refs. Guard against double-`close()` (closing an already-closed context
   throws). Keep the existing record→stop→transcribe flow working. Commit.
2. **Extract `use-live-transcription.ts`.** Hook only, not yet wired into the UI.
   Include the transcribe queue. Commit.
3. **Wire the demo to it.** "Start Listening" toggle alongside (not replacing)
   the existing record button if that's cleanly possible — otherwise replace,
   but say so. Append each utterance to a running segment list instead of
   overwriting the single `transcript` string. Per-segment status
   (listening → transcribing → done). Commit.

## Verification — required before you claim any step is done

- `npx tsc --noEmit --pretty` must be clean.
- `./node_modules/.bin/next build --webpack` must succeed, and the route table
  must still show `○`/`●` for all pages and OG images with only `/api/*` as `ƒ`.
  (Use the binary directly; `pnpm build` triggers a TTY-gated dep check.)
  See CLAUDE.md — a single time-based server `fetch` can silently un-static the
  whole site.
- Biome currently reports ~91 pre-existing errors repo-wide. **Do not fix
  them**; just don't add new ones in your files.
- **A real browser test is mandatory** for steps 1 and 3 — per CLAUDE.md,
  previous agents claimed models worked when they had only verified compilation.
  Start the dev server and use the `frontend-functional-tester` sub-agent. Note
  that mic-driven VAD is hard to automate headlessly; Chrome needs
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, which
  injects a synthetic tone. If you cannot get real verification, **say so
  explicitly rather than claiming success** — report exactly what you did and
  did not verify.

## Report back

After each commit, report: what changed, the tsc/build result, what you
verified in a browser and what you couldn't, and anything you found that
contradicts this brief. Contradicting the brief is a valid and useful outcome —
say so plainly rather than working around it.
