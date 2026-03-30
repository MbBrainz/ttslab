import type {
	LoadOptions,
	ModelLoader,
	ModelSession,
	TranscribeResult,
} from "../types";

const MODEL_ID = "onnx-community/cohere-transcribe-03-2026-ONNX";

const LANGUAGES = [
	"en", "fr", "de", "es", "it", "pt",
	"nl", "pl", "el", "ar", "ja", "zh", "vi", "ko",
];

export class CohereTranscribeLoader implements ModelLoader {
	slug = "cohere-transcribe";
	type = "stt" as const;
	framework = "transformers-js" as const;

	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";
		const { env, pipeline } = await import("@huggingface/transformers");
		const { configureOnnxWasmPaths } = await import("../onnx-config");
		configureOnnxWasmPaths(env);

		const transcriber = await pipeline(
			"automatic-speech-recognition",
			MODEL_ID,
			{
				device: options.backend === "wasm" ? "wasm" : "webgpu",
				dtype: "q4",
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
			options: {
				sampling_rate: number;
				return_timestamps: boolean;
				max_new_tokens: number;
			},
		) => Promise<{
			text: string;
			chunks?: Array<{ text: string; timestamp: [number, number] }>;
		}>;
		const start = performance.now();

		const result = await transcriber(audio, {
			sampling_rate: sampleRate,
			return_timestamps: true,
			max_new_tokens: 1024,
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
		return LANGUAGES;
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["webgpu", "wasm"];
	}
}
