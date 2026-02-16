# Contributing to TTSLab

Thanks for your interest in contributing to TTSLab! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** 20+
- **pnpm** (install via `corepack enable` or `npm i -g pnpm`)
- A **Neon Postgres** database (or compatible PostgreSQL instance)

### Getting Started

```bash
# Clone the repo
git clone https://github.com/MbBrainz/ttslab.git
cd ttslab

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
# Fill in your DATABASE_URL and other variables

# Push the database schema
pnpm db:push

# Seed the models table
pnpm db:seed

# Start the dev server (uses --webpack flag, required for ONNX alias)
pnpm dev
```

## Code Style

- **Formatter/Linter**: [Biome](https://biomejs.dev/) — run `pnpm check` to auto-fix
- **Indentation**: Tabs
- **Quotes**: Double quotes
- **Semicolons**: Always

Run `pnpm lint` to check, `pnpm format` to auto-format.

## Adding a Model

1. **Create a loader** in `src/lib/inference/loaders/` — implement the `ModelLoader` interface
2. **Register it** in `src/lib/inference/registry.ts` with a lazy import
3. **Add a seed entry** in `scripts/seed-models.ts` with the model metadata
4. Run `pnpm db:seed` to insert the model into the database

See existing loaders (e.g., `kokoro.ts`, `whisper.ts`) for reference.

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes — keep PRs focused on a single concern
3. Run `pnpm check` to ensure linting/formatting passes
4. Run `pnpm build` to verify the build succeeds
5. Open a PR with a clear description of the change

## Reporting Issues

- Use [GitHub Issues](https://github.com/MbBrainz/ttslab/issues)
- Include browser, OS, and GPU info for WebGPU-related issues
- Include console errors and reproduction steps when possible

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
