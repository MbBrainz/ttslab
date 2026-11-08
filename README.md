<p align="center">
  <h1 align="center">TTSLab</h1>
  <p align="center">
    Test TTS & STT models in your browser. No server. No data collection. Powered by WebGPU.
  </p>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/MbBrainz/ttslab/stargazers"><img src="https://img.shields.io/github/stars/MbBrainz/ttslab?style=social" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="https://ttslab.dev">ttslab.dev</a>
</p>

---

<!-- Add a screenshot here before launch -->
<!-- ![TTSLab Screenshot](./public/screenshot.png) -->

## Features

- **In-browser inference** — models run entirely on your device via WebGPU or WASM
- **Zero data collection** — your text and audio never leave your browser
- **Side-by-side comparisons** — compare TTS and STT models head to head
- **Model directory** — browse, search, and upvote 28 models (TTS, STT, and a voice-agent LLM)
- **Three-tier local LLM** — Qwen3.5 0.8B (~490 MB, runs on any backend), Qwen3.5 2B (~1.1 GB) and 4B (~2.4 GB) via WebLLM on WebGPU, plus a CPU-only WASM tier (0.8B GGUF via wllama) that needs no GPU at all
- **New model additions** — Kitten TTS Nano (15M params, ~24 MB, WASM-only), Underdog Woof (38.2M params, ~41 MB, hand-ported JS runtime, non-commercial license) and DistilWhisper Small (English-only, 166M params)
- **Documented limits** — a dated, cited report on WebGPU/WASM platform limits ([/limits](https://ttslab.dev/limits)), an attributed external benchmark table ([/benchmark](https://ttslab.dev/benchmark)), and an FAQ ([/faq](https://ttslab.dev/faq))
- **Instant caching** — model weights are cached locally after first download

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Database | [Neon Postgres](https://neon.tech) + [Drizzle ORM](https://orm.drizzle.team) |
| Inference | [ONNX Runtime Web 1.31.1](https://onnxruntime.ai), [@huggingface/transformers 4.3.2](https://github.com/huggingface/transformers.js), [kokoro-js](https://github.com/niconielsen32/kokoro-js), [@mlc-ai/web-llm 0.2.87](https://github.com/mlc-ai/web-llm), [@wllama/wllama 3.8.1](https://github.com/ngxson/wllama) |
| Analytics | [Vercel Analytics](https://vercel.com/analytics) |
| Linter | [Biome](https://biomejs.dev) |

## Getting Started

```bash
# Clone
git clone https://github.com/MbBrainz/ttslab.git
cd ttslab

# Install dependencies (postinstall copies the ONNX + wllama WASM files into public/)
pnpm install

# Set up environment
cp .env.example .env.local
# Fill in DATABASE_URL (and RESEND_API_KEY if you want the subscribe flows)

# DB commands read process.env directly — source .env.local first:
set -a; source .env.local; set +a
pnpm db:push
pnpm db:seed

# Start dev server (--webpack flag is required for ONNX alias resolution)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser with WebGPU support (Chrome 113+, Edge 113+).

## Project Structure

```
src/
├── app/                  # Next.js App Router pages & API routes
│   ├── models/           # Model directory & detail pages
│   ├── compare/          # Comparison pages
│   ├── limits/           # WebGPU/WASM limits report (dated, cited)
│   ├── faq/              # FAQ (FAQPage JSON-LD)
│   ├── api/              # API routes (upvotes, subscriptions)
│   └── opengraph-image.tsx
├── components/           # React components
│   ├── tts-demo.tsx      # TTS playground UI
│   ├── stt-demo.tsx      # STT playground UI
│   ├── voice-agent/      # Speech-to-speech voice agent UI
│   ├── audio-player.tsx  # Reusable audio player
│   └── ui/               # Shared UI primitives
├── lib/
│   ├── db/               # Drizzle schema, queries, types
│   ├── inference/        # Model loaders & registry
│   │   ├── loaders/      # Per-model loader implementations
│   │   ├── llm-types.ts  # 3-engine LLM tier definitions
│   │   └── registry.ts   # Lazy loader registry
│   ├── analytics.ts      # Vercel Analytics event wrappers
│   └── constants.ts      # App-wide constants

public/                   # Sibling of src/, served at the site root
├── audio-samples/        # Pre-generated audio samples
├── onnx/                 # Self-hosted ONNX Runtime WASM (copied by postinstall)
├── wllama/               # Self-hosted wllama WASM (copied by postinstall)
└── espeak/               # Vendored eSpeak NG phonemizer worker (kitten-tts)
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, code style, and how to add a model.

## License

[MIT](./LICENSE)
