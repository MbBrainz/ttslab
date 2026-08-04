/**
 * Speaker embedding utilities for SpeechT5 voice cloning.
 *
 * - `decodeAudioToPCM()` — main-thread only (uses AudioContext)
 * - `extractEmbeddingFromPCM()` — worker only (runs ONNX pipeline)
 */

import type { DownloadProgress } from "./types";

const TARGET_SAMPLE_RATE = 16000;
/** Max audio length for embedding extraction (10s is plenty for speaker identity) */
const MAX_AUDIO_SAMPLES = TARGET_SAMPLE_RATE * 10;
/** SpeechT5 expects a 512-dim speaker embedding vector */
const SPEAKER_EMBEDDING_DIM = 512;

/**
 * Decode an audio Blob to 16 kHz mono Float32Array PCM.
 * Must run on the main thread (AudioContext is not available in workers).
 */
export async function decodeAudioToPCM(
	audioBlob: Blob,
): Promise<{ audio: Float32Array; sampleRate: number }> {
	const arrayBuffer = await audioBlob.arrayBuffer();
	const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
	try {
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
		const audio = audioBuffer.getChannelData(0);
		return { audio, sampleRate: TARGET_SAMPLE_RATE };
	} finally {
		await audioContext.close();
	}
}

/**
 * Run the speaker verification model on PCM audio and return a blob URL
 * pointing to the raw Float32Array embedding.
 * Must run inside a Web Worker (ONNX WASM).
 *
 * Uses AutoModel + AutoProcessor directly instead of pipeline() because
 * wavlm-base-plus-sv has no tokenizer_config.json and pipeline("feature-extraction")
 * tries to load one, causing a fetch error in transformers.js v4.
 */
let cachedModel: { model: unknown; processor: unknown } | null = null;

const SPEAKER_MODEL_ID = "Xenova/wavlm-base-plus-sv";

type HubProgress = {
	status: string;
	file?: string;
	loaded?: number;
	total?: number;
};

/** Translate a transformers.js hub event into a DownloadProgress, or null to skip it. */
function toDownloadProgress(event: HubProgress): DownloadProgress | null {
	if (event.status !== "progress") return null;
	if (!event.total) return null;
	return {
		status: "downloading",
		file: event.file ?? SPEAKER_MODEL_ID,
		loaded: event.loaded ?? 0,
		total: event.total,
	};
}

async function loadSpeakerModel(
	onProgress?: (progress: DownloadProgress) => void,
): Promise<{ model: unknown; processor: unknown }> {
	if (cachedModel) return cachedModel;

	const { AutoModel, AutoProcessor } = await import("@huggingface/transformers");
	const progress_callback = onProgress
		? (event: HubProgress) => {
				const mapped = toDownloadProgress(event);
				if (mapped) onProgress(mapped);
			}
		: undefined;

	const [model, processor] = await Promise.all([
		AutoModel.from_pretrained(SPEAKER_MODEL_ID, {
			device: "wasm",
			progress_callback,
		}),
		AutoProcessor.from_pretrained(SPEAKER_MODEL_ID, { progress_callback }),
	]);

	cachedModel = { model, processor };
	return cachedModel;
}

export async function extractEmbeddingFromPCM(
	audio: Float32Array,
	_sampleRate: number,
	onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
	const { env } = await import("@huggingface/transformers");
	const { configureOnnxWasmPaths } = await import("./onnx-config");
	configureOnnxWasmPaths(env);

	const loaded = await loadSpeakerModel(onProgress);

	onProgress?.({ status: "ready", file: SPEAKER_MODEL_ID, loaded: 0, total: 0 });

	// Truncate to 10s max — speaker identity doesn't need more, and longer
	// audio causes WASM OOM (std::bad_alloc) in the ONNX runtime.
	const truncated =
		audio.length > MAX_AUDIO_SAMPLES
			? audio.slice(0, MAX_AUDIO_SAMPLES)
			: audio;

	// Process audio through the feature extractor
	// AutoProcessor may be callable directly or expose .feature_extractor
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const proc = loaded.processor as any;
	const extractor = proc.feature_extractor ?? proc;
	const inputs = await extractor(truncated);

	// Run model inference
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const model = loaded.model as any;
	const output = await model({ input_values: inputs.input_values });

	// Get embeddings — wavlm-sv outputs embeddings directly, or fall back to last_hidden_state with mean pooling
	let embeddingData: Float32Array;
	if (output.embeddings) {
		embeddingData = output.embeddings.data as Float32Array;
	} else if (output.last_hidden_state) {
		// Mean pooling over the sequence dimension (assumes batch size 1)
		const hidden = output.last_hidden_state;
		const [batchSize, seqLen, hiddenSize] = hidden.dims;
		if (batchSize !== 1) throw new Error("Expected batch size 1");
		const data = hidden.data as Float32Array;
		const pooled = new Float32Array(hiddenSize);
		for (let h = 0; h < hiddenSize; h++) {
			let sum = 0;
			for (let s = 0; s < seqLen; s++) {
				sum += data[s * hiddenSize + h];
			}
			pooled[h] = sum / seqLen;
		}
		// L2 normalize
		let norm = 0;
		for (let i = 0; i < pooled.length; i++) norm += pooled[i] * pooled[i];
		norm = Math.sqrt(norm);
		if (norm > 0) {
			for (let i = 0; i < pooled.length; i++) pooled[i] /= norm;
		}
		embeddingData = pooled;
	} else {
		throw new Error(
			"WavLM model returned neither embeddings nor last_hidden_state",
		);
	}

	if (embeddingData.length !== SPEAKER_EMBEDDING_DIM) {
		throw new Error(
			`Speaker embedding has ${embeddingData.length} dimensions, expected ${SPEAKER_EMBEDDING_DIM} for SpeechT5`,
		);
	}

	const bytes = embeddingData.buffer.slice(
		embeddingData.byteOffset,
		embeddingData.byteOffset + embeddingData.byteLength,
	) as ArrayBuffer;
	const blob = new Blob([bytes], { type: "application/octet-stream" });
	return URL.createObjectURL(blob);
}
