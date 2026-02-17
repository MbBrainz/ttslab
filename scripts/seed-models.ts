import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { comparisons, models, type NewModel } from "../src/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle({ client: sql });

const modelData: NewModel[] = [
	{
		slug: "kokoro-82m",
		name: "Kokoro 82M",
		type: "tts",
		status: "supported",
		sizeMb: 80,
		paramsMillions: 82,
		architecture: "StyleTTS2 variant",
		languages: ["en", "fr", "ja", "ko", "zh"],
		voices: 21,
		hfModelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
		npmPackage: "kokoro-js",
		loaderConfig: {
			framework: "kokoro-js",
			defaultVoice: "af_heart",
			defaultQuantization: "q8",
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"High-quality TTS with 21 voices. Best quality-to-size ratio for browser inference. Supports streaming generation.",
		websiteUrl: "https://huggingface.co/hexgrad/Kokoro-82M",
		license: "Apache-2.0",
	},
	{
		slug: "piper-en-us-lessac-medium",
		name: "Piper EN-US Lessac Medium",
		type: "tts",
		status: "supported",
		sizeMb: 75,
		paramsMillions: 50,
		architecture: "VITS",
		languages: ["en"],
		voices: 1,
		hfModelId: "rhasspy/piper-voices",
		loaderConfig: {
			framework: "piper-web",
			voice: "en_US-lessac-medium",
		},
		supportsStreaming: false,
		supportsWebgpu: false,
		supportsWasm: true,
		description:
			"Fast, lightweight TTS using the VITS architecture. Part of the Piper project with 904+ voices across languages.",
		websiteUrl: "https://github.com/rhasspy/piper",
		license: "MIT",
	},
	{
		slug: "speecht5",
		name: "SpeechT5",
		type: "tts",
		status: "supported",
		sizeMb: 60,
		paramsMillions: 60,
		architecture: "SpeechT5",
		languages: ["en"],
		voices: 1,
		hfModelId: "Xenova/speecht5_tts",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "text-to-speech",
		},
		supportsStreaming: false,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Microsoft's unified-modal SpeechT5 model. Lightweight and CPU-sufficient for basic TTS needs.",
		websiteUrl: "https://huggingface.co/microsoft/speecht5_tts",
		paperUrl: "https://arxiv.org/abs/2110.07205",
		license: "MIT",
	},
	{
		slug: "whisper-tiny",
		name: "Whisper Tiny",
		type: "stt",
		status: "supported",
		sizeMb: 31,
		paramsMillions: 39,
		architecture: "Whisper (encoder-decoder)",
		languages: ["en", "fr", "de", "es", "it", "ja", "ko", "zh", "pt", "ru"],
		hfModelId: "onnx-community/whisper-tiny",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
			dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"OpenAI's smallest Whisper model. Fastest STT option, supports 100 languages. Great for real-time use.",
		websiteUrl: "https://huggingface.co/openai/whisper-tiny",
		paperUrl: "https://arxiv.org/abs/2212.04356",
		license: "MIT",
	},
	{
		slug: "whisper-base",
		name: "Whisper Base",
		type: "stt",
		status: "supported",
		sizeMb: 56,
		paramsMillions: 74,
		architecture: "Whisper (encoder-decoder)",
		languages: ["en", "fr", "de", "es", "it", "ja", "ko", "zh", "pt", "ru"],
		hfModelId: "onnx-community/whisper-base",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
			dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"OpenAI's Whisper Base model. Good balance of quality and speed for browser-based speech recognition.",
		websiteUrl: "https://huggingface.co/openai/whisper-base",
		paperUrl: "https://arxiv.org/abs/2212.04356",
		license: "MIT",
	},
	{
		slug: "whisper-small",
		name: "Whisper Small",
		type: "stt",
		status: "supported",
		sizeMb: 182,
		paramsMillions: 244,
		architecture: "Whisper (encoder-decoder)",
		languages: ["en", "fr", "de", "es", "it", "ja", "ko", "zh", "pt", "ru"],
		hfModelId: "onnx-community/whisper-small",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
			dtype: { encoder_model: "fp16", decoder_model_merged: "q4" },
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"OpenAI's Whisper Small model. 100 languages. Best quality-to-size ratio for browser-based STT.",
		websiteUrl: "https://huggingface.co/openai/whisper-small",
		paperUrl: "https://arxiv.org/abs/2212.04356",
		license: "MIT",
	},
	{
		slug: "moonshine-base",
		name: "Moonshine Base",
		type: "stt",
		status: "supported",
		sizeMb: 120,
		paramsMillions: 61,
		architecture: "Moonshine",
		languages: ["en"],
		hfModelId: "onnx-community/moonshine-base-ONNX",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Faster-than-Whisper STT model optimized for real-time transcription. English-only but very fast.",
		websiteUrl: "https://github.com/usefulsensors/moonshine",
		license: "MIT",
	},
	// --- New supported models ---
	{
		slug: "supertonic-2",
		name: "Supertonic 2",
		type: "tts",
		status: "supported",
		sizeMb: 305,
		paramsMillions: 66,
		architecture: "Supertonic",
		languages: ["en", "ko", "es", "pt", "fr"],
		voices: 10,
		hfModelId: "onnx-community/Supertonic-TTS-2-ONNX",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "text-to-speech",
			defaultVoice: "F1",
		},
		supportsStreaming: false,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Lightning-fast multilingual TTS by Supertone. 10 voices, 5 languages, 167x faster than real-time. ONNX-native with WebGPU support.",
		websiteUrl: "https://supertonic-tts.com",
		license: "OpenRAIL-M",
	},
	{
		slug: "whisper-large-v3-turbo",
		name: "Whisper Large V3 Turbo",
		type: "stt",
		status: "supported",
		sizeMb: 1200,
		paramsMillions: 809,
		architecture: "Whisper (encoder-decoder)",
		languages: ["en", "fr", "de", "es", "it", "ja", "ko", "zh", "pt", "ru"],
		hfModelId: "onnx-community/whisper-large-v3-turbo",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
			dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"OpenAI's Whisper Large V3 Turbo — 809M params with 4-layer decoder (vs 32 in full Large). Within 1-2% accuracy at 6x speed. 99+ languages.",
		websiteUrl: "https://huggingface.co/openai/whisper-large-v3-turbo",
		paperUrl: "https://arxiv.org/abs/2212.04356",
		license: "MIT",
	},
	{
		slug: "moonshine-tiny",
		name: "Moonshine Tiny",
		type: "stt",
		status: "supported",
		sizeMb: 35,
		paramsMillions: 27,
		architecture: "Moonshine",
		languages: ["en"],
		hfModelId: "onnx-community/moonshine-tiny-ONNX",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Smallest Moonshine variant. Ultra-fast English STT at just 27M params. Ideal for real-time transcription on low-end devices.",
		websiteUrl: "https://github.com/usefulsensors/moonshine",
		license: "MIT",
	},
	{
		slug: "moonshine-tiny-ja",
		name: "Moonshine Tiny (Japanese)",
		type: "stt",
		status: "supported",
		sizeMb: 35,
		paramsMillions: 27,
		architecture: "Moonshine",
		languages: ["ja"],
		hfModelId: "onnx-community/moonshine-tiny-ja-ONNX",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Moonshine Tiny fine-tuned for Japanese. Specialized single-language model for higher accuracy than multilingual alternatives.",
		websiteUrl: "https://github.com/usefulsensors/moonshine",
		license: "MIT",
	},
	{
		slug: "moonshine-tiny-ko",
		name: "Moonshine Tiny (Korean)",
		type: "stt",
		status: "supported",
		sizeMb: 35,
		paramsMillions: 27,
		architecture: "Moonshine",
		languages: ["ko"],
		hfModelId: "onnx-community/moonshine-tiny-ko-ONNX",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Moonshine Tiny fine-tuned for Korean. Specialized single-language model for higher accuracy than multilingual alternatives.",
		websiteUrl: "https://github.com/usefulsensors/moonshine",
		license: "MIT",
	},
	{
		slug: "moonshine-tiny-zh",
		name: "Moonshine Tiny (Chinese)",
		type: "stt",
		status: "supported",
		sizeMb: 35,
		paramsMillions: 27,
		architecture: "Moonshine",
		languages: ["zh"],
		hfModelId: "onnx-community/moonshine-tiny-zh-ONNX",
		loaderConfig: {
			framework: "transformers-js",
			pipeline: "automatic-speech-recognition",
		},
		supportsStreaming: true,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Moonshine Tiny fine-tuned for Chinese (Mandarin). Specialized single-language model for higher accuracy than multilingual alternatives.",
		websiteUrl: "https://github.com/usefulsensors/moonshine",
		license: "MIT",
	},
	// Planned / unsupported models
	{
		slug: "kitten-tts",
		name: "Kitten TTS Nano",
		type: "tts",
		status: "planned",
		sizeMb: 24,
		paramsMillions: 15,
		architecture: "Kitten TTS",
		languages: ["en"],
		voices: 8,
		hfModelId: "KittenML/kitten-tts-nano-0.1",
		loaderConfig: {
			framework: "onnx-runtime",
		},
		supportsStreaming: false,
		supportsWebgpu: false,
		supportsWasm: true,
		description:
			"Ultra-lightweight 15M param TTS. Only 24MB download. Requires phonemization via eSpeak WASM — browser integration in progress.",
		websiteUrl: "https://huggingface.co/KittenML/kitten-tts-nano-0.1",
		license: "Apache-2.0",
	},
	{
		slug: "chatterbox-turbo",
		name: "Chatterbox Turbo",
		type: "tts",
		status: "planned",
		sizeMb: 1400,
		paramsMillions: 350,
		architecture: "Chatterbox (Llama backbone)",
		languages: ["en"],
		hfModelId: "ResembleAI/chatterbox-turbo-ONNX",
		loaderConfig: {
			framework: "onnx-runtime",
		},
		supportsStreaming: false,
		supportsWebgpu: true,
		supportsWasm: false,
		description:
			"Resemble AI's expressive TTS with emotion control and zero-shot voice cloning. ONNX exports available. Large download (~1.4 GB) requires WebGPU.",
		websiteUrl: "https://github.com/resemble-ai/chatterbox",
		license: "MIT",
	},
	{
		slug: "styletts2",
		name: "StyleTTS 2",
		type: "tts",
		status: "unsupported",
		paramsMillions: 200,
		architecture: "StyleTTS2",
		languages: ["en"],
		supportsWebgpu: false,
		supportsWasm: false,
		description:
			"Human-level TTS with style transfer. Community ONNX export available but multi-stage pipeline (encoder, diffusion, vocoder) needs custom integration.",
		websiteUrl: "https://github.com/yl4579/StyleTTS2",
		paperUrl: "https://arxiv.org/abs/2306.07691",
		license: "MIT",
	},
	{
		slug: "f5-tts",
		name: "F5-TTS",
		type: "tts",
		status: "planned",
		sizeMb: 400,
		paramsMillions: 335,
		architecture: "Flow Matching",
		languages: ["en", "zh"],
		hfModelId: "huggingfacess/F5-TTS-ONNX",
		loaderConfig: {
			framework: "onnx-runtime",
		},
		supportsStreaming: false,
		supportsWebgpu: true,
		supportsWasm: true,
		description:
			"Zero-shot voice cloning via flow matching. 3-component ONNX pipeline. Browser demo proven by third party. Needs custom ONNX Runtime integration.",
		websiteUrl: "https://github.com/SWivid/F5-TTS",
		paperUrl: "https://arxiv.org/abs/2410.06885",
		license: "CC-BY-NC-4.0",
	},
];

async function seed() {
	console.log("Seeding models...");

	// Upsert models
	for (const model of modelData) {
		await db
			.insert(models)
			.values(model)
			.onConflictDoUpdate({
				target: models.slug,
				set: {
					name: model.name,
					type: model.type,
					status: model.status,
					sizeMb: model.sizeMb,
					paramsMillions: model.paramsMillions,
					architecture: model.architecture,
					languages: model.languages,
					voices: model.voices,
					hfModelId: model.hfModelId,
					npmPackage: model.npmPackage,
					loaderConfig: model.loaderConfig,
					supportsStreaming: model.supportsStreaming,
					supportsWebgpu: model.supportsWebgpu,
					supportsWasm: model.supportsWasm,
					description: model.description,
					websiteUrl: model.websiteUrl,
					paperUrl: model.paperUrl,
					license: model.license,
					updatedAt: new Date(),
				},
			});
		console.log(`  Seeded: ${model.slug}`);
	}

	// Generate comparison pairs for supported models
	const supportedModels = modelData.filter((m) => m.status === "supported");
	console.log("\nGenerating comparisons...");

	const insertedModels = await db.select().from(models);
	const modelMap = new Map(insertedModels.map((m) => [m.slug, m]));

	for (let i = 0; i < supportedModels.length; i++) {
		for (let j = i + 1; j < supportedModels.length; j++) {
			const a = modelMap.get(supportedModels[i].slug);
			const b = modelMap.get(supportedModels[j].slug);
			if (!a || !b) continue;
			// Only create comparisons for same-type models
			if (a.type !== b.type) continue;

			const [first, second] = a.id < b.id ? [a, b] : [b, a];
			const slug = `${first.slug}-vs-${second.slug}`;

			await db
				.insert(comparisons)
				.values({
					modelAId: first.id,
					modelBId: second.id,
					slug,
				})
				.onConflictDoNothing();
			console.log(`  Comparison: ${slug}`);
		}
	}

	console.log("\nDone!");
}

seed().catch(console.error);
