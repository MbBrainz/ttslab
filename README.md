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
- **Model directory** — browse, search, and upvote models
- **Instant caching** — model weights are cached locally after first download

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Database | [Neon Postgres](https://neon.tech) + [Drizzle ORM](https://orm.drizzle.team) |
| Inference | [ONNX Runtime Web](https://onnxruntime.ai), [kokoro-js](https://github.com/niconielsen32/kokoro-js), [@xenova/transformers](https://github.com/xenova/transformers.js) |
| Analytics | [Vercel Analytics](https://vercel.com/analytics) |
| Linter | [Biome](https://biomejs.dev) |

## Getting Started

```bash
# Clone
git clone https://github.com/MbBrainz/ttslab.git
cd ttslab

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Fill in DATABASE_URL and other variables

# Push DB schema & seed
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
│   ├── api/              # API routes (upvotes, subscriptions)
│   └── opengraph-image.tsx
├── components/           # React components
│   ├── tts-demo.tsx      # TTS playground UI
│   ├── stt-demo.tsx      # STT playground UI
│   ├── audio-player.tsx  # Reusable audio player
│   └── ui/               # Shared UI primitives
├── lib/
│   ├── db/               # Drizzle schema, queries, types
│   ├── inference/        # Model loaders & registry
│   │   ├── loaders/      # Per-model loader implementations
│   │   └── registry.ts   # Lazy loader registry
│   ├── analytics.ts      # Vercel Analytics event wrappers
│   └── constants.ts      # App-wide constants
└── public/
    └── audio-samples/    # Pre-generated audio samples
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, code style, and how to add a model.

## License

[MIT](./LICENSE)
