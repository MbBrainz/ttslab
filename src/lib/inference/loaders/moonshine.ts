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

	async load(options: LoadOptions): Promise<ModelSession> {
		const { pipeline } = await import("@xenova/transformers");

		const transcriber = await pipeline(
			"automatic-speech-recognition",
			"onnx-community/moonshine-base-ONNX",
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
			options: { sampling_rate: number },
		) => Promise<{ text: string }>;
		const start = performance.now();

		const result = await transcriber(audio, { sampling_rate: sampleRate });
		const totalMs = performance.now() - start;

		return {
			text: result.text,
			metrics: {
				totalMs: Math.round(totalMs),
				backend: "webgpu",
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
