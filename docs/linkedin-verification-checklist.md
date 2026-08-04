# LinkedIn Claims — Manual Verification Checklist

Run every check on the **production build** (`./node_modules/.bin/next build --webpack && ./node_modules/.bin/next start`), not dev mode. Do one full pass in Chrome (WebGPU) and one in Safari (worst-case). Keep DevTools console open for the entire session — any red error during a happy path is a fail.

## Claim 1 — "Runs 100% in your browser, nothing leaves your device"

- [ ] 1.1 Open DevTools → Network. Load a model (Kokoro), wait for Ready. Clear the network log. Generate speech. **Pass:** zero new network requests during generation (analytics beacons excepted — note if any fire).
- [ ] 1.2 After model is Ready, toggle DevTools → Network → Offline. Generate again. **Pass:** audio still generates.
- [ ] 1.3 Voice clone: upload a voice sample, extract, generate. With Network tab open. **Pass:** the uploaded audio never appears in any outgoing request.

## Claim 2 — "Hear 20+ TTS/STT models" (core demo works)

- [ ] 2.1 Homepage hero: samples autoplay/play on click, typewriter + waveform animate, no console errors.
- [ ] 2.2 Kokoro (`/models/kokoro-82m`): Download → Ready → enter text → Generate. **Pass:** non-flat waveform, metrics displayed, download-audio link works, generated file plays outside the app.
- [ ] 2.3 One heavyweight model (Chatterbox Turbo): full download completes with live progress %, generation succeeds. Note total time — this is what a LinkedIn visitor experiences.
- [ ] 2.4 One STT model (whisper-tiny): mic transcription of a spoken sentence is accurate. Also test file upload path.
- [ ] 2.5 A compare page (`/compare/...`): both demos load and generate independently, side by side.
- [ ] 2.6 Embed (`/embed/kokoro-82m`) inside an iframe on a scratch HTML page: renders and generates.

## Claim 3 — "WebGPU accelerated"

- [ ] 3.1 In Chrome console: `await navigator.gpu.requestAdapter()` returns an adapter (not null).
- [ ] 3.2 Backend selector: force WebGPU on Kokoro, generate. **Pass:** generation works, backend badge/metric says WebGPU, no fallback warning in console.
- [ ] 3.3 Force WASM, generate again. **Pass:** works; compare generation times (WebGPU should be faster — if not, don't claim acceleration numbers).
- [ ] 3.4 On a machine/browser without WebGPU (Safari or `--disable-features`), auto-select silently falls back to WASM with no user-facing error.

## Claim 4 — "Clone your voice in the browser"

- [ ] 4.1 Upload path: upload a 10–30s clean voice WAV/MP3 → processing succeeds → generate → output audibly resembles the reference (honest ear test; get a second opinion).
- [ ] 4.2 Record path: record ~10s via mic → same as above. Test in Chrome AND Safari (Safari is the known-broken one pre-fix).
- [ ] 4.3 Select "Default" voice after cloning → generation returns to the stock voice (pre-fix known bug: it doesn't).
- [ ] 4.4 Clear (X) the cloned voice → next generation uses stock voice without a page reload (pre-fix known bug).
- [ ] 4.5 Garbage input: upload a 1-second silent clip → get a graceful error, not a crash or `std::bad_alloc` shown raw.
- [ ] 4.6 Generate 5+ times in a row with a cloned voice → no memory crash (watch DevTools → Memory / task manager).

## Claim 5 — "Real-time voice agent, zero servers"

- [ ] 5.1 Voice agent page: all three models (STT+LLM+TTS) load with progress; total load time noted.
- [ ] 5.2 Speak a question → spoken answer returns; measure end-of-speech → first-audio latency. Only claim "real-time" if this is ~<3s.
- [ ] 5.3 Interrupt/ask a second question — no wedged state, no reload needed.

## Claim 6 — Resilience under a traffic spike (post day)

- [ ] 6.1 Mid-download of a big model, click away / cancel — UI recovers (pre-fix: no cancel exists; verify behavior at minimum).
- [ ] 6.2 Two tabs generating simultaneously — no cross-tab corruption.
- [ ] 6.3 Upvote a model: count increments once, second click doesn't double-count, page data updates after refresh.
- [ ] 6.4 Mobile (real phone or 375px viewport): homepage, one model page, generation all usable; no horizontal scroll.
- [ ] 6.5 Lighthouse on homepage: performance + SEO ≥ 90 on the prod build.

## Automated baseline (2026-07-17, headless Chrome 150 + WebGPU "adapter:apple", prod build w/ uncommitted voice-clone diffs)

PASS: homepage, Kokoro E2E (WebGPU, 5s gen), backend override (WASM + WebGPU both verified via metrics), privacy (zero external requests during generation — only blob:), SpeechT5 clone via upload, compare page, embed page. SKIP: STT (mic-only UI, no mic headless — 4.2/2.4 mic checks remain manual). NOT reproduced: the "Default voice returns stale embedding" bug (output changed when selecting Default — possibly fixed by the uncommitted diff; re-verify manually, check 4.3). Known weak points: SpeechT5 download 560MB ≈ 10 min and NOT resumable (one network blip restarts from 0); Kokoro first load ~5 min. Benign noise: /_vercel/insights 404 locally, AudioContext autoplay warning, ONNX EP-assignment warnings on WebGPU.

## Fail policy
Any FAIL in claims 1, 2.2, 3.2, or 4.1–4.4 blocks the post (they're the literal promises). Claims 5–6 failures downgrade wording, not the launch.
