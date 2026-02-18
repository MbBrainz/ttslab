import type {
	AudioResult,
	LoadOptions,
	ModelLoader,
	ModelSession,
	Voice,
} from "../types";

// SpeechT5 requires speaker embeddings for synthesis.
// This is a pre-extracted x-vector from the CMU ARCTIC dataset.
const SPEAKER_EMBEDDINGS_URL =
	"https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin";

export class SpeechT5Loader implements ModelLoader {
	slug = "speecht5";
	type = "tts" as const;
	framework = "transformers-js" as const;

	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private customSpeakerEmbeddingUrl: string | null = null;

	setSpeakerEmbedding(url: string | null): void {
		this.customSpeakerEmbeddingUrl = url;
	}

	async load(options: LoadOptions): Promise<ModelSession> {
		const { env, pipeline } = await import("@huggingface/transformers");
		const { configureOnnxWasmPaths } = await import("../onnx-config");
		configureOnnxWasmPaths(env);

		const synthesizer = await pipeline(
			"text-to-speech",
			"Xenova/speecht5_tts",
			{
				device: "wasm",
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

	async synthesize(text: string): Promise<AudioResult> {
		if (!this.pipeline) throw new Error("Model not loaded");

		const synthesizer = this.pipeline as (
			text: string,
			options: { speaker_embeddings: string },
		) => Promise<{ audio: Float32Array; sampling_rate: number }>;

		const start = performance.now();
		const result = await synthesizer(text, {
			speaker_embeddings:
				this.customSpeakerEmbeddingUrl ?? SPEAKER_EMBEDDINGS_URL,
		});
		const totalMs = performance.now() - start;

		const duration = result.audio.length / result.sampling_rate;

		return {
			audio: result.audio,
			sampleRate: result.sampling_rate,
			duration,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: "wasm",
			},
		};
	}

	getVoices(): Voice[] {
		const voices: Voice[] = [
			{ id: "default", name: "Default", gender: "neutral" },
		];
		if (this.customSpeakerEmbeddingUrl) {
			voices.push({ id: "custom", name: "Custom Voice", gender: "neutral" });
		}
		return voices;
	}

	getLanguages(): string[] {
		return ["en"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["wasm"];
	}
}
