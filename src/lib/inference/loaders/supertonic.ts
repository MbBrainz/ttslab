import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

const VOICE_BASE_URL =
	"https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices";

const VOICES: Voice[] = [
	{ id: "F1", name: "Calm", gender: "female" },
	{ id: "F2", name: "Cheerful", gender: "female" },
	{ id: "F3", name: "Professional", gender: "female" },
	{ id: "F4", name: "Confident", gender: "female" },
	{ id: "F5", name: "Gentle", gender: "female" },
	{ id: "M1", name: "Energetic", gender: "male" },
	{ id: "M2", name: "Deep", gender: "male" },
	{ id: "M3", name: "Authoritative", gender: "male" },
	{ id: "M4", name: "Friendly", gender: "male" },
	{ id: "M5", name: "Storyteller", gender: "male" },
];

export class SupertonicLoader implements ModelLoader {
	slug = "supertonic-2";
	type = "tts" as const;
	framework = "transformers-js" as const;

	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";
		const { pipeline } = await import("@huggingface/transformers");

		const synthesizer = await pipeline(
			"text-to-speech",
			"onnx-community/Supertonic-TTS-2-ONNX",
			{
				device: options.backend === "wasm" ? "wasm" : "webgpu",
				dtype: "fp32",
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

		const resolvedVoice =
			voice === "default" ? VOICES[0].id : voice;
		const embeddingUrl = `${VOICE_BASE_URL}/${resolvedVoice}.bin`;

		const synthesizer = this.pipeline as (
			text: string,
			options: { speaker_embeddings: string },
		) => Promise<{ audio: Float32Array; sampling_rate: number }>;

		const start = performance.now();
		const result = await synthesizer(text, {
			speaker_embeddings: embeddingUrl,
		});
		const totalMs = performance.now() - start;

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
		return ["en", "ko", "es", "pt", "fr"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["webgpu", "wasm"];
	}

	getPreferredBackend(): "webgpu" | "wasm" | "auto" {
		return "wasm";
	}
}
