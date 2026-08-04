# QA harness fixtures

## Real SpeechT5 cloned-voice defects (committed)

Captured 2026-08-04 by `scripts/model-qa.mjs` against the real SpeechT5 model
on a >10s prompt with a **mic-captured** speaker embedding — the spec's repro
conditions. All three are 16kHz mono.

| file | what it is |
|---|---|
| `speecht5-stock-known-good.wav` | control: stock voice, same phrase, 16.6s, WER 0.000 |
| `speecht5-cloned-STUTTER-known-bad.wav` | **the canonical defect**: decoder loops "sophisticated" ~7x. 10.98s |
| `speecht5-cloned-TRUNCATED-known-bad.wav` | second failure mode: truncates to 6.18s of 17s expected |

The prompt for all three:

> The committee reviewed the sophisticated proposal at length, and after
> considerable discussion about the department budget, the union representatives
> agreed that the computer systems would need replacing before the end of the
> financial year.

**These exist because no acoustic detector in the harness catches the stutter.**
See `known-defects.test.ts`, which asserts that gap explicitly so a future
repetition detector has a real target instead of synthetic overlap. Do not
delete them without replacing the calibration basis.

## Regenerable mic sources (gitignored)

`--clone-mic` feeds a WAV into Chrome's fake microphone, so the getUserMedia
capture chain (AGC, noise suppression, resampling) is genuinely exercised.
Rebuild them with:

```bash
ffmpeg -y -i public/audio-samples/kokoro-82m.wav \
  -filter_complex "[0:a]aloop=loop=2:size=2e9[out]" -map "[out]" \
  -ar 48000 -ac 1 -acodec pcm_s16le test-fixtures/mic-voice-source.wav

ffmpeg -y -i public/audio-samples/piper-lessac.wav \
  -filter_complex "[0:a]aloop=loop=3:size=2e9[out]" -map "[out]" \
  -ar 48000 -ac 1 -acodec pcm_s16le test-fixtures/mic-voice-source-2.wav
```

`mic-voice-source-2.wav` (piper voice) is the one that produced the stutter.
The two sources produce *different* failure modes, so the defect is
embedding-dependent — keep both.
