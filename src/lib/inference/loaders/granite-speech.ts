import type {
	LoadOptions,
	ModelLoader,
	ModelSession,
	TranscribeResult,
} from "../types";

const MODEL_ID = "onnx-community/granite-4.0-1b-speech-ONNX";
const TRANSCRIBE_PROMPT =
	"<|startoftext|>Transcribe this audio recording.<|endoftext|>";
const LANGUAGES = ["en", "fr", "de", "es", "pt", "ja"];

export class GraniteSpeechLoader implements ModelLoader {
	slug = "granite-speech";
	type = "stt" as const;
	framework = "transformers-js" as const;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private model: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private processor: any = null;
	private session: ModelSession | null = null;
	private loadedBackend: "webgpu" | "wasm" = "wasm";

	async load(options: LoadOptions): Promise<ModelSession> {
		const backend = options.backend === "webgpu" ? "webgpu" : "wasm";
		this.loadedBackend = backend;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const transformers: any = await import("@huggingface/transformers");
		const { configureOnnxWasmPaths } = await import("../onnx-config");
		configureOnnxWasmPaths(transformers.env);

		const progressCallback = (progress: {
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
		};

		console.log(
			`[granite-speech] Loading from ${MODEL_ID} (backend: ${backend})`,
		);

		try {
			const [model, processor] = await Promise.all([
				transformers.GraniteSpeechForConditionalGeneration.from_pretrained(
					MODEL_ID,
					{
						dtype: "q4",
						device: backend,
						progress_callback: progressCallback,
					},
				),
				transformers.AutoProcessor.from_pretrained(MODEL_ID),
			]);

			this.model = model;
			this.processor = processor;

			console.log(
				`[granite-speech] Model loaded successfully on ${backend}`,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`[granite-speech] Load failed (backend: ${backend}):`,
				message,
			);
			throw new Error(
				`Granite Speech ${backend} load failed: ${message}`,
			);
		}

		this.session = {
			dispose: () => {
				this.model?.dispose?.();
				this.model = null;
				this.processor = null;
				this.session = null;
			},
		};

		return this.session;
	}

	async transcribe(
		audio: Float32Array,
		sampleRate: number,
	): Promise<TranscribeResult> {
		if (!this.model || !this.processor) {
			throw new Error("Model not loaded");
		}

		const start = performance.now();

		const inputs = await this.processor(audio, {
			text: TRANSCRIBE_PROMPT,
			sampling_rate: sampleRate,
		});

		const outputs = await this.model.generate({
			...inputs,
			max_new_tokens: 1024,
		});

		const decoded: string[] = this.processor.batch_decode(outputs, {
			skip_special_tokens: true,
		});
		const text = (decoded[0] ?? "").trim();

		const totalMs = performance.now() - start;

		return {
			text,
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
