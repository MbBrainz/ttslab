#!/usr/bin/env tsx
/**
 * Add Model Workflow Script
 *
 * Generates a loader file, registry entry, and seed entry for a new model.
 *
 * Usage:
 *   pnpm tsx scripts/add-model.ts --config models/my-model.json
 *   pnpm tsx scripts/add-model.ts --interactive
 *
 * Config JSON format:
 * {
 *   "slug": "my-model",
 *   "name": "My Model",
 *   "type": "tts" | "stt",
 *   "framework": "transformers-js" | "kokoro-js" | "piper-web" | "onnx-runtime",
 *   "pipeline": "text-to-speech" | "automatic-speech-recognition",
 *   "hfModelId": "onnx-community/my-model-ONNX",
 *   "sizeMb": 100,
 *   "paramsMillions": 50,
 *   "architecture": "Transformer",
 *   "languages": ["en"],
 *   "voices": [
 *     { "id": "default", "name": "Default", "gender": "neutral" }
 *   ],
 *   "voiceEmbeddingBaseUrl": "https://huggingface.co/.../voices",
 *   "supportsWebgpu": true,
 *   "supportsWasm": true,
 *   "dtype": "fp32",
 *   "description": "Description here.",
 *   "websiteUrl": "https://...",
 *   "paperUrl": "https://...",
 *   "license": "MIT"
 * }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

interface VoiceConfig {
	id: string;
	name: string;
	gender?: "male" | "female" | "neutral";
	language?: string;
}

interface ModelConfig {
	slug: string;
	name: string;
	type: "tts" | "stt";
	framework: "transformers-js" | "kokoro-js" | "piper-web" | "onnx-runtime";
	pipeline?: "text-to-speech" | "automatic-speech-recognition";
	hfModelId: string;
	sizeMb: number;
	paramsMillions: number;
	architecture: string;
	languages: string[];
	voices?: VoiceConfig[];
	voiceEmbeddingBaseUrl?: string;
	supportsWebgpu: boolean;
	supportsWasm: boolean;
	supportsStreaming?: boolean;
	dtype?: string | Record<string, string>;
	description: string;
	websiteUrl?: string;
	paperUrl?: string;
	license: string;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateTtsLoader(config: ModelConfig): string {
	const className = toPascalCase(config.slug) + "Loader";
	const voicesArray = (config.voices ?? [])
		.map(
			(v) =>
				`\t{ id: "${v.id}", name: "${v.name}", gender: "${v.gender ?? "neutral"}" },`,
		)
		.join("\n");

	const hasVoiceEmbeddings = !!config.voiceEmbeddingBaseUrl;

	const synthBody = hasVoiceEmbeddings
		? `
		const resolvedVoice = voice === "default" ? this.getVoices()[0]?.id ?? "${config.voices?.[0]?.id ?? "default"}" : voice;
		const embeddingUrl = \`${config.voiceEmbeddingBaseUrl}/\${resolvedVoice}.bin\`;

		const synthesizer = this.pipeline as (
			text: string,
			options: { speaker_embeddings: string },
		) => Promise<{ audio: Float32Array; sampling_rate: number }>;

		const start = performance.now();
		const result = await synthesizer(text, {
			speaker_embeddings: embeddingUrl,
		});
		const totalMs = performance.now() - start;`
		: `
		const synthesizer = this.pipeline as (
			text: string,
		) => Promise<{ audio: Float32Array; sampling_rate: number }>;

		const start = performance.now();
		const result = await synthesizer(text);
		const totalMs = performance.now() - start;`;

	const backends = [];
	if (config.supportsWebgpu) backends.push('"webgpu"');
	if (config.supportsWasm) backends.push('"wasm"');

	return `import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

const VOICES: Voice[] = [
${voicesArray}
];

export class ${className} implements ModelLoader {
	slug = "${config.slug}";
	type = "tts" as const;
	framework = "${config.framework}" as const;

	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";
		const { pipeline } = await import("@huggingface/transformers");

		const synthesizer = await pipeline(
			"text-to-speech",
			"${config.hfModelId}",
			{
				device: options.backend === "wasm" ? "wasm" : "webgpu",${config.dtype ? `\n\t\t\t\tdtype: ${JSON.stringify(config.dtype)},` : ""}
				progress_callback: options.onProgress
					? (progress: {
							status: string;
							file?: string;
							loaded?: number;
							total?: number;
						}) => {
							if (progress.status === "progress" && progress.file != null) {
								options.onProgress?.({
									status: "downloading",
									file: progress.file,
									loaded: progress.loaded ?? 0,
									total: progress.total ?? 0,
								});
							}
						}
					: undefined,
			},
		);

		this.pipeline = synthesizer;
		this.session = {
			dispose: () => {
				this.pipeline = null;
				this.session = null;
			},
		};

		return this.session;
	}

	async synthesize(text: string, voice: string): Promise<AudioResult> {
		if (!this.pipeline) throw new Error("Model not loaded");
${synthBody}

		if (!result.audio || result.audio.length === 0) {
			throw new Error("Model returned empty audio data. Try reloading the model.");
		}

		const duration = result.audio.length / result.sampling_rate;

		return {
			audio: result.audio,
			sampleRate: result.sampling_rate,
			duration,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: this.loadedBackend,
			},
		};
	}

	getVoices(): Voice[] {
		return VOICES;
	}

	getLanguages(): string[] {
		return ${JSON.stringify(config.languages)};
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return [${backends.join(", ")}];
	}
}
`;
}

function generateSttLoader(config: ModelConfig): string {
	const className = toPascalCase(config.slug) + "Loader";

	const backends = [];
	if (config.supportsWebgpu) backends.push('"webgpu"');
	if (config.supportsWasm) backends.push('"wasm"');

	const dtypeStr = config.dtype
		? typeof config.dtype === "string"
			? `\n\t\t\t\tdtype: ${JSON.stringify(config.dtype)},`
			: `\n\t\t\t\tdtype: ${JSON.stringify(config.dtype)},`
		: "";

	return `import type {
	LoadOptions,
	ModelLoader,
	ModelSession,
	TranscribeResult,
} from "../types";

export class ${className} implements ModelLoader {
	slug = "${config.slug}";
	type = "stt" as const;
	framework = "${config.framework}" as const;

	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";
		const { pipeline } = await import("@huggingface/transformers");

		const transcriber = await pipeline(
			"automatic-speech-recognition",
			"${config.hfModelId}",
			{
				device: options.backend === "wasm" ? "wasm" : "webgpu",${dtypeStr}
				progress_callback: options.onProgress
					? (progress: {
							status: string;
							file?: string;
							loaded?: number;
							total?: number;
						}) => {
							if (progress.status === "progress" && progress.file != null) {
								options.onProgress?.({
									status: "downloading",
									file: progress.file,
									loaded: progress.loaded ?? 0,
									total: progress.total ?? 0,
								});
							}
						}
					: undefined,
			},
		);

		this.pipeline = transcriber;
		this.session = {
			dispose: () => {
				this.pipeline = null;
				this.session = null;
			},
		};

		return this.session;
	}

	async transcribe(
		audio: Float32Array,
		sampleRate: number,
	): Promise<TranscribeResult> {
		if (!this.pipeline) throw new Error("Model not loaded");

		const transcriber = this.pipeline as (
			audio: Float32Array,
			options: { sampling_rate: number; return_timestamps?: boolean },
		) => Promise<{
			text: string;
			chunks?: Array<{ text: string; timestamp: [number, number] }>;
		}>;
		const start = performance.now();

		const result = await transcriber(audio, {
			sampling_rate: sampleRate,
			return_timestamps: true,
		});

		const totalMs = performance.now() - start;

		return {
			text: result.text,
			chunks: result.chunks,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: this.loadedBackend,
			},
		};
	}

	getLanguages(): string[] {
		return ${JSON.stringify(config.languages)};
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return [${backends.join(", ")}];
	}
}
`;
}

function generateRegistryEntry(config: ModelConfig): string {
	const className = toPascalCase(config.slug) + "Loader";
	const loaderFile = config.slug.replace(/-/g, "-");

	return `loaders.set("${config.slug}", async () => {
	const { ${className} } = await import("./loaders/${loaderFile}");
	return new ${className}();
});`;
}

function generateSeedEntry(config: ModelConfig): string {
	const entry: Record<string, unknown> = {
		slug: config.slug,
		name: config.name,
		type: config.type,
		status: "supported",
		sizeMb: config.sizeMb,
		paramsMillions: config.paramsMillions,
		architecture: config.architecture,
		languages: config.languages,
		hfModelId: config.hfModelId,
		loaderConfig: {
			framework: config.framework,
			...(config.pipeline ? { pipeline: config.pipeline } : {}),
			...(config.dtype ? { dtype: config.dtype } : {}),
		},
		supportsStreaming: config.supportsStreaming ?? false,
		supportsWebgpu: config.supportsWebgpu,
		supportsWasm: config.supportsWasm,
		description: config.description,
		license: config.license,
	};

	if (config.voices?.length) entry.voices = config.voices.length;
	if (config.websiteUrl) entry.websiteUrl = config.websiteUrl;
	if (config.paperUrl) entry.paperUrl = config.paperUrl;

	return JSON.stringify(entry, null, "\t").replace(/"([^"]+)":/g, "$1:");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPascalCase(slug: string): string {
	return slug
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

function ask(rl: readline.Interface, question: string): Promise<string> {
	return new Promise((resolve) => rl.question(question, resolve));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const args = process.argv.slice(2);
	let config: ModelConfig;

	if (args.includes("--config")) {
		const configPath = args[args.indexOf("--config") + 1];
		if (!configPath) {
			console.error("Error: --config requires a file path");
			process.exit(1);
		}
		const raw = fs.readFileSync(path.resolve(configPath), "utf-8");
		config = JSON.parse(raw);
	} else if (args.includes("--interactive")) {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		config = {
			slug: await ask(rl, "Model slug (e.g., my-model): "),
			name: await ask(rl, "Display name (e.g., My Model): "),
			type: (await ask(rl, "Type (tts/stt): ")) as "tts" | "stt",
			framework: (await ask(
				rl,
				"Framework (transformers-js/kokoro-js/piper-web/onnx-runtime): ",
			)) as ModelConfig["framework"],
			pipeline: (await ask(
				rl,
				"Pipeline (text-to-speech/automatic-speech-recognition, or empty): ",
			)) as ModelConfig["pipeline"] | undefined,
			hfModelId: await ask(rl, "HuggingFace model ID: "),
			sizeMb: Number(await ask(rl, "Size in MB: ")),
			paramsMillions: Number(await ask(rl, "Parameters in millions: ")),
			architecture: await ask(rl, "Architecture: "),
			languages: (await ask(rl, "Languages (comma-separated): ")).split(",").map((l) => l.trim()),
			supportsWebgpu: (await ask(rl, "Supports WebGPU? (y/n): ")) === "y",
			supportsWasm: (await ask(rl, "Supports WASM? (y/n): ")) === "y",
			description: await ask(rl, "Description: "),
			websiteUrl: (await ask(rl, "Website URL (or empty): ")) || undefined,
			paperUrl: (await ask(rl, "Paper URL (or empty): ")) || undefined,
			license: await ask(rl, "License: "),
		} as ModelConfig;

		if (!config.pipeline) delete config.pipeline;

		rl.close();
	} else {
		console.log(`
Add Model Workflow Script
=========================

Usage:
  pnpm tsx scripts/add-model.ts --config <path-to-config.json>
  pnpm tsx scripts/add-model.ts --interactive

Config JSON format — see script header for full schema.

Example (TTS with transformers.js):
  {
    "slug": "supertonic-2",
    "name": "Supertonic 2",
    "type": "tts",
    "framework": "transformers-js",
    "pipeline": "text-to-speech",
    "hfModelId": "onnx-community/Supertonic-TTS-2-ONNX",
    "sizeMb": 305,
    "paramsMillions": 66,
    "architecture": "Supertonic",
    "languages": ["en", "ko", "es", "pt", "fr"],
    "voices": [
      { "id": "F1", "name": "Calm", "gender": "female" },
      { "id": "M1", "name": "Energetic", "gender": "male" }
    ],
    "voiceEmbeddingBaseUrl": "https://huggingface.co/.../voices",
    "supportsWebgpu": true,
    "supportsWasm": true,
    "dtype": "fp32",
    "description": "Fast multilingual TTS.",
    "license": "MIT"
  }
`);
		process.exit(0);
	}

	const rootDir = path.resolve(__dirname, "..");
	const loadersDir = path.join(rootDir, "src/lib/inference/loaders");
	const loaderFileName = `${config.slug}.ts`;
	const loaderPath = path.join(loadersDir, loaderFileName);

	// 1. Generate loader file
	if (config.framework === "transformers-js") {
		const code =
			config.type === "tts"
				? generateTtsLoader(config)
				: generateSttLoader(config);

		if (fs.existsSync(loaderPath)) {
			console.log(`  SKIP: ${loaderPath} already exists`);
		} else {
			fs.writeFileSync(loaderPath, code, "utf-8");
			console.log(`  CREATED: ${loaderPath}`);
		}
	} else {
		console.log(
			`  NOTE: Framework "${config.framework}" requires a custom loader.`,
		);
		console.log(`  Create it manually at: ${loaderPath}`);
	}

	// 2. Print registry entry
	console.log("\n--- Registry entry (add to src/lib/inference/registry.ts) ---");
	console.log(generateRegistryEntry(config));

	// 3. Print seed entry
	console.log("\n--- Seed entry (add to scripts/seed-models.ts) ---");
	console.log(generateSeedEntry(config));

	console.log("\n--- Next steps ---");
	console.log("1. Add the registry entry to src/lib/inference/registry.ts");
	console.log("2. Add the seed entry to scripts/seed-models.ts");
	console.log("3. Run: pnpm tsc --noEmit");
	console.log("4. Run: pnpm tsx scripts/seed-models.ts");
	console.log("5. Test at localhost:3000/models/" + config.slug);
}

main().catch(console.error);
