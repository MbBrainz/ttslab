export interface LoadOptions {
	backend: "webgpu" | "wasm" | "auto";
	quantization?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
	onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadProgress {
	status: "downloading" | "ready";
	file: string;
	loaded: number;
	total: number;
}

export interface AudioResult {
	audio: Float32Array;
	sampleRate: number;
	duration: number;
	metrics: InferenceMetrics;
}

export interface InferenceMetrics {
	totalMs: number;
	firstByteMs?: number;
	tokensPerSecond?: number;
	backend: "webgpu" | "wasm";
}

export interface TranscribeResult {
	text: string;
	chunks?: Array<{
		text: string;
		timestamp: [number, number];
	}>;
	metrics: InferenceMetrics;
}

export interface Voice {
	id: string;
	name: string;
	language?: string;
	gender?: "male" | "female" | "neutral";
}

export interface ModelSession {
	dispose(): void | Promise<void>;
}

export interface ModelLoader {
	slug: string;
	type: "tts" | "stt";
	framework: "transformers-js" | "kokoro-js" | "piper-web" | "sherpa-onnx";

	load(options: LoadOptions): Promise<ModelSession>;

	synthesize?(
		text: string,
		voice: string,
		options?: { streaming?: boolean },
	): Promise<AudioResult>;

	transcribe?(
		audio: Float32Array,
		sampleRate: number,
	): Promise<TranscribeResult>;

	getVoices?(): Voice[];
	getLanguages(): string[];
	getSupportedBackends(): ("webgpu" | "wasm")[];
	getPreferredBackend?(): "webgpu" | "wasm" | "auto";
}

// Worker message types
export type WorkerCommand =
	| { type: "load"; modelSlug: string; options: LoadOptions }
	| { type: "synthesize"; modelSlug: string; text: string; voice: string; speakerEmbeddingUrl?: string }
	| {
			type: "transcribe";
			modelSlug: string;
			audio: Float32Array;
			sampleRate: number;
	  }
	| { type: "dispose"; modelSlug: string };

export type WorkerResponse =
	| { type: "progress"; data: DownloadProgress }
	| { type: "loaded"; backend: "webgpu" | "wasm"; loadTime: number; voices: Voice[] }
	| { type: "audio"; data: AudioResult }
	| { type: "transcript"; data: TranscribeResult }
	| { type: "error"; code: string; message: string }
	| { type: "disposed" };
