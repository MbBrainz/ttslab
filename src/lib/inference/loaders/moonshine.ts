import type {
	LoadOptions,
	ModelLoader,
	ModelSession,
	TranscribeResult,
} from "../types";

export class MoonshineLoader implements ModelLoader {
	slug = "moonshine-base";
	type = "stt" as const;
	framework = "transformers-js" as const;

	private pipeline: unknown = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		this.loadedBackend = options.backend === "webgpu" ? "webgpu" : "wasm";
		const { pipeline } = await import("@huggingface/transformers");

		const transcriber = await pipeline(
			"automatic-speech-recognition",
			"onnx-community/moonshine-base-ONNX",
			{
				device: options.backend === "wasm" ? "wasm" : "webgpu",
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
			options: { sampling_rate: number },
		) => Promise<{ text: string }>;
		const start = performance.now();

		const result = await transcriber(audio, { sampling_rate: sampleRate });
		const totalMs = performance.now() - start;

		return {
			text: result.text,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: this.loadedBackend,
			},
		};
	}

	getLanguages(): string[] {
		return ["en"];
	}

	getSupportedBackends(): ("webgpu" | "wasm")[] {
		return ["webgpu", "wasm"];
	}
}
