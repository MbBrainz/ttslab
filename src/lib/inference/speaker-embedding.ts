/**
 * Speaker embedding utilities for SpeechT5 voice cloning.
 *
 * - `decodeAudioToPCM()` — main-thread only (uses AudioContext)
 * - `extractEmbeddingFromPCM()` — worker only (runs ONNX pipeline)
 */

const TARGET_SAMPLE_RATE = 16000;

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
 */
let extractorPipeline: unknown = null;

export async function extractEmbeddingFromPCM(
	audio: Float32Array,
	_sampleRate: number,
	onProgress?: (progress: { status: string }) => void,
): Promise<string> {
	if (!extractorPipeline) {
		const { env, pipeline } = await import("@huggingface/transformers");
		const { configureOnnxWasmPaths } = await import("./onnx-config");
		configureOnnxWasmPaths(env);
		onProgress?.({ status: "Loading speaker model..." });
		extractorPipeline = await pipeline(
			"feature-extraction",
			"Xenova/wavlm-base-plus-sv",
			{ device: "wasm" },
		);
	}

	onProgress?.({ status: "Extracting speaker embedding..." });
	const output = await (extractorPipeline as CallableFunction)(audio, {
		pooling: "mean",
		normalize: true,
	});

	const embeddingData = output.data as Float32Array;
	const bytes = embeddingData.buffer.slice(
		embeddingData.byteOffset,
		embeddingData.byteOffset + embeddingData.byteLength,
	) as ArrayBuffer;
	const blob = new Blob([bytes], { type: "application/octet-stream" });
	return URL.createObjectURL(blob);
}
