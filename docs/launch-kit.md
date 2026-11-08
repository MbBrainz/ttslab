# TTSLab Launch Kit — Woof TTS (2026-11-09)

Internal playbook for the Woof TTS launch. Copy-paste drafts are in fenced blocks — rewrite anything that doesn't sound like you before posting (see pitfall 9). Disclosure rules in section 1 are non-negotiable in every channel.

## Status — shipped and verified

Woof exhibit shipped + browser-verified 2026-11-08/09 (commits `74f35c8..72689d6`), all live on ttslab.dev.

Verified numbers (quote these exactly, don't paraphrase into approximations):

- CPU port: Pearson corr **+1.00000000** vs the numpy reference, stage-by-stage.
- GPU backend: **22 hand-written WGSL kernels**; corr **0.9999998** CPU-vs-GPU on a fixed seed; ~6.1s CPU vs ~0.19s GPU per sentence (**~31x** — one Apple Silicon machine, qualify everywhere).
- Same text + voice + seed ⇒ identical audio on both backends.
- Load times: wllama ready ~20s; WebLLM 2B ready ~40s.
- `/finetune` trains a real 5,313-param MLP with 9 WGSL kernels (loss 1.6e-5 → 5e-6 in ~10s).

Production URLs (all live): `https://ttslab.dev/models/woof-tts`, `https://ttslab.dev/blog/underdog-woof-deep-dive`, `https://ttslab.dev/finetune`, `https://ttslab.dev/limits`, `https://ttslab.dev/faq`.

Underdog announcement to reply under: https://x.com/UnderdogAI/status/2118921155713372212 (Nov 7, 87K views) + founder QT https://x.com/0xSigil/status/2118924469549056109. Their register: hype + concrete numbers + playful dog persona, short posts.

## 1. Preflight (do before posting anything)

- Confirm production pages return 200: `https://ttslab.dev/models/woof-tts`, `https://ttslab.dev/blog/underdog-woof-deep-dive`, `https://ttslab.dev/finetune`, `https://ttslab.dev/limits`, `https://ttslab.dev/faq`.
- Record the two network clips FIRST (section 5) — posts without the proof clip underperform.
- Disclosure rules:
  - Never claim "no network requests" — weights fetch from HF CDN once, then cached. The accurate claim is "no server-side inference; weights cached after first download".
  - WER 1.42–2.06% is ALWAYS "per Underdog's evals".
  - Pair every correlation claim with "bit-exactness not expected — parallel reductions change accumulation order".
  - Feed spelled-out text ("twenty-five dollars", not "$25") — the normalizer isn't ported and this WILL be the first gotcha commenters hit.
  - WebGPU browser caveats upfront: Chrome/Edge 113+, Safari 26, Firefox 141; typed-array fallback otherwise.
  - License one-liner everywhere: Woof weights+code are Underdog Non-Commercial 1.0 (credit "Voice by Underdog Woof" shown on the page; commercial via license@conway.tech); the lab itself is MIT.
- HN repost etiquette: ttslab was posted twice in Feb 2026 (https://news.ycombinator.com/item?id=47123980 5pts; next-day repost id=47138571 3pts). Attempt #3 is legitimate (major overhaul per Show HN rules) but MUST disclose both in the first comment and use a materially different title (lead with the port, not the site). Never solicit upvotes.

## 2. Timing + channel order

Deploy done; launch Tuesday Nov 10 ~8:00–9:30am ET (13:00–14:30 UTC).

1. Show HN
2. r/LocalLLaMA Showcase 2–3h later (not within the same hour as HN)
3. X thread from the ttslab account near the HN post
4. Reply under Underdog's announcement any time (already drafted in section 4c)
5. Newsletter sweep launch week: tips@tldr.tech (link + 2 sentences); editor@cooperpress.com pitching BOTH the launch and /limits separately as a cited reference page; Ben's Bites news board https://www.bensbites.com; EchoJS https://www.echojs.com open submission

Skip lobste.rs unless an aged (70+ day) account exists — new accounts can't self-promo for 70 days. HackerNewsletter covers HN automatically. dev.to cross-post 3–7 days after.

## 3. Show HN

Title: `Show HN: A 40MB TTS model hand-ported to run in the browser (TS + WGSL)`

Alternates: `Show HN: Woof TTS in your browser — hand-ported runtime + 22 WGSL kernels` / `Show HN: TTSLab – 28 speech and LLM models running fully client-side`

First comment (post within 2 minutes, stay in thread 4+ hours):

```text
Hi HN — I'm the author. This is a major overhaul of TTSLab, which I posted a smaller version of in February [1]. The new centerpiece: Underdog AI's Woof TTS (38.2M params, 40.6MB, two voices) running fully client-side.

What made this interesting: the model's HF repo ships no runtime at all — just numpy arrays and a ~380-line numpy reference implementation. No ONNX, no WASM engine to lean on. So I hand-ported the reference to a plain typed-array TypeScript runtime (every matmul a loop, no native code), and verified it numerically exact against the numpy reference to float32 precision.

Then I wrote a second backend: 22 hand-written WGSL compute kernels over the raw WebGPU API — int8-packed weights dequantized in registers inside the matmul/conv kernels (never expanded to fp32, which would transiently cost ~250MB of JS heap on iOS), static cached dispatch plans, and frames decoded in small batches with one EOS readback per batch.

Both backends draw noise from the same torch-compatible MT19937 stream, so the same text + voice + seed produces identical audio on CPU and GPU. Verified in a real browser (2026-11-08): CPU vs GPU Pearson correlation 0.9999998 on a fixed seed; ~6.1s CPU vs ~0.19s GPU per sentence on my machine. Bit-exactness is not expected — parallel reductions change accumulation order.

Try it: https://ttslab.dev/models/woof-tts (the whole lab is client-side: a 3-tier Qwen3.5 voice agent at 0.8B/2B/4B across transformers.js/WebLLM/wllama, and a 28-model directory)

Honest caveats, stated upfront:
- Woof's text normalizer is not ported, so feed spelled-out text ("twenty-five dollars", not "$25") — digits and dates will read oddly. That's the next port target.
- English only, no streaming.
- WebGPU support varies: Chrome/Edge 113+, Safari 26, Firefox 141 — with a typed-array fallback for the rest. I wrote up what WebGPU/WASM genuinely can't do yet, with sources: https://ttslab.dev/limits
- Woof's weights and code are Underdog Non-Commercial 1.0: free for non-commercial use with credit ("Voice by Underdog Woof"); commercial use needs a license from Underdog. The rest of the lab is MIT.

Happy to answer anything about the port, the WGSL kernels, or browser inference generally. If you test it, I'd especially like to hear how it does on Safari/iOS — that's the platform where memory ceilings bite.

[1] https://news.ycombinator.com/item?id=47123980
```

Style warning: the Esp32sim 212-pt thread got dragged for AI-slop README prose — rewrite any passage that doesn't sound like you before posting; plain paragraphs in comments, one link list max.

## 4. Reddit + X

### (a) r/LocalLLaMA

Flair: Showcase.

Title: `I hand-ported Underdog's Woof TTS (40MB) to run entirely in the browser — typed-array runtime + 22 hand-written WGSL kernels, no ONNX or WASM engine`

Body:

```text
Sharing something I've been building on ttslab.dev (open source, MIT: github.com/MbBrainz/ttslab — I'm the author).

The exhibit: Underdog AI's Woof (38.2M params, 40.6MB, two voices, 24kHz output) running fully client-side. The HF repo ships only numpy arrays plus a ~380-line numpy reference runtime — no ONNX export, no WASM engine — so I ported the reference by hand to plain typed-array TypeScript, verified numerically exact against the numpy reference, then wrote a second WebGPU backend: 22 hand-written WGSL compute kernels, int8 weights dequantized in registers (never expanded to fp32 — that would transiently cost ~250MB of JS heap, a real iOS problem), cached dispatch plans, batch-4 frame decode.

Same text + voice + seed gives identical audio on both backends — noise is drawn from the same torch-compatible MT19937 stream and uploaded to the GPU. Browser-verified: CPU vs GPU Pearson corr 0.9999998 on a fixed seed; ~6.1s CPU vs ~0.19s GPU per sentence on my hardware (Apple Silicon; expect slower elsewhere — please report yours).

Try it (no account, weights cached after first download): https://ttslab.dev/models/woof-tts
Reproduce: pick Woof, toggle CPU/WebGPU backend, keep the seed, generate twice — same audio. The WGSL path is inspectable: all kernels are in src/lib/inference/loaders/woof-gpu.ts in the repo.

Also in the lab: a fully local voice agent (Whisper-class STT -> Qwen3.5 0.8B/2B/4B via transformers.js/WebLLM/wllama -> TTS), Silero VAD, a real in-browser training demo (https://ttslab.dev/finetune), and a cited writeup on what WebGPU/WASM actually can't do yet: https://ttslab.dev/limits

Honest limitations: English only; no streaming; Woof's text normalizer isn't ported so use spelled-out text ("twenty-five dollars", not "$25"). License note: Woof's weights and code are Underdog NC-1.0 — free for non-commercial use with credit; commercial use needs an Underdog license. The lab itself is MIT.

Feedback welcome — especially browser/hardware combos I can add to the compatibility notes.
```

Disclose authorship (1/10 rule), answer everything.

### (b) X thread from the ttslab account

4 tweets + detail reply under T1.

**T1** (attach hero clip):

```text
Underdog's Woof TTS ships no runtime — just numpy arrays and a 380-line reference implementation. So I hand-ported it: typed-array TypeScript, verified exact against the reference, plus 22 hand-written WGSL kernels for WebGPU. 40MB, fully in your browser, zero server inference. [clip]
```

**T2:**

```text
How the port works: every matmul is a plain typed-array loop, numerically exact vs the numpy reference to float32 precision. No ONNX, no WASM engine, no native code — just JS on the inference worker.
```

**T3:**

```text
The GPU path: 22 hand-written WGSL compute kernels over raw WebGPU. int8 weights stay packed and get dequantized in registers (never expanded to fp32 — that's ~250MB of JS heap on iOS). Dispatch plans are cached; frames decode in batches of 4 with one EOS readback per batch. 0.19s vs 6.1s per sentence.
```

**T4:**

```text
Seed parity: noise comes from the same torch-compatible MT19937 stream on both backends, so the same text + voice + seed gives identical audio on CPU and GPU. Verified in a real browser: Pearson corr 0.9999998 on a fixed seed. Try it, no signup: https://ttslab.dev/models/woof-tts
```

**Reply under T1:**

```text
Details for the curious: English-only, no streaming yet, and Woof's text normalizer isn't ported — feed it spelled-out text ("twenty-five dollars", not "$25"). License is Underdog NC-1.0 (non-commercial, with credit); the lab itself is MIT. What WebGPU/WASM genuinely can't do yet, with sources: https://ttslab.dev/limits
```

### (c) Reply under Underdog's announcement (already prepared; keep for reference)

```text
Congrats on the release! We loved the numpy-reference approach so much we ported it: Woof now runs fully in-browser on TTSLab — typed arrays + 22 hand-written WGSL kernels. Same seed = same audio on CPU and GPU (corr 0.9999998), ~6.1s → 0.19s per sentence. Would love your take: ttslab.dev/models/woof-tts
```

Follow-up reply in-thread:

```text
And for the curious: reading a 380-line numpy reference makes you want to train things in the tab too — so we started. A real gradient-descent loop (9 WGSL kernels) now runs on our Finetune Lab, first step toward in-browser speech-model fine-tuning: ttslab.dev/finetune
```

Do NOT engage the license pushback in their replies.

## 5. Asset checklist (~10 min, capture before posting)

- [ ] 1. Hero clip 25–30s: Woof page, spelled-out sentence, WebGPU backend selected, generate, play — backend toggle visible.
- [ ] 2. Network-tab clip 15s: weights cached, DevTools Network open, hard reload, generate — zero requests during synthesis. The proof shot; show, don't claim.
- [ ] 3. Seed-parity shot: same text+voice+seed on CPU then GPU — same waveforms/players back to back.
- [ ] 4. Screenshot /limits (credibility artifact for Reddit + newsletter pitches).
- [ ] 5. Screenshot voice agent mid-conversation (3-tier pipeline visible).
- [ ] 6. Screenshot 28-model directory grid.
- [ ] 7. Verify OG cards render for ttslab.dev and /models/woof-tts (Reddit/X/Slack preview).
- [ ] 8. Optional 15s: KittenTTS Nano (24MB) on the WASM path — the "even without a GPU" demo.

## 6. Pitfalls

1. NC-license disclosure done right (HN first comment + Reddit body: weights AND code NC-1.0, credit string, commercial contact).
2. Never claim "no network requests" — HF CDN fetches once; say "no server-side inference; cached after first download".
3. WER always "per Underdog's evals".
4. Use the measured corr 0.9999998 (not the ≥0.9999 target framing); always add the bit-exactness disclaimer.
5. Kernel count is 22 (verified in code + tests; Underdog's own bundle is 19 — lineage claim only).
6. WebGPU caveats upfront; defuse "crashed on my old iPhone" with the fallback path + /limits.
7. The $25 normalizer trap — disclose in every channel.
8. HN repost etiquette (disclose Feb posts, different title, no upvote solicitation).
9. No AI-slop prose — rewrite drafts in your own voice.
10. Reddit mechanics: disclose, don't post Reddit+HN same hour, skip r/MachineLearning for v1.
11. Infra: rate limits live (429 + Retry-After, per-instance); if a spike incident appears, priority is the thread's honesty.
12. Lobste.rs only with an aged account.
