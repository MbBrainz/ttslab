import type {
	LoadOptions,
	ModelLoader,
	ModelSession,
	TranscribeResult,
} from "../types";

export class WhisperLoader implements ModelLoader {
	slug: string;
	type = "stt" as const;
	framework = "transformers-js" as const;

	private modelId: string;
	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	constructor(slug: string, modelId: string) {
		this.slug = slug;
		this.modelId = modelId;
	}

	async load(options: LoadOptions): Promise<ModelSession> {
		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";
		const { pipeline } = await import("@xenova/transformers");

		const transcriber = await pipeline(
			"automatic-speech-recognition",
			this.modelId,
			{
				device: options.backend === "wasm" ? "cpu" : "webgpu",
				progress_callback: options.onProgress
					? (progress: {
							status: string;
							file: string;
							loaded: number;
							total: number;
						}) => {
							if (progress.status === "progress") {
								options.onProgress?.({
									status: "downloading",
									file: progress.file,
									loaded: progress.loaded,
									total: progress.total,
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
			options: { sampling_rate: number; return_timestamps: boolean },
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
		return ["en", "fr", "de", "es", "it", "ja", "ko", "zh", "pt", "ru"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["webgpu", "wasm"];
	}
}
