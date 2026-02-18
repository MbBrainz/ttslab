/**
 * Extract speaker embeddings from an audio file for use with SpeechT5 voice cloning.
 * Uses a small speaker verification model to extract x-vectors.
 */

let extractorPipeline: unknown = null;

export async function extractSpeakerEmbedding(
	audioBlob: Blob,
	onProgress?: (progress: { status: string; progress?: number }) => void,
): Promise<string> {
	// 1. Load the feature extraction pipeline (cached after first load)
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

	// 2. Convert audio blob to 16kHz mono PCM
	onProgress?.({ status: "Processing audio..." });
	const arrayBuffer = await audioBlob.arrayBuffer();
	const audioContext = new AudioContext({ sampleRate: 16000 });
	const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
	const audioData = audioBuffer.getChannelData(0);
	await audioContext.close();

	// 3. Extract embeddings
	onProgress?.({ status: "Extracting speaker embedding..." });
	const output = await (extractorPipeline as CallableFunction)(audioData, {
		pooling: "mean",
		normalize: true,
	});

	// 4. Convert to blob URL (binary Float32Array matching SpeechT5's expected format)
	const embeddingData = output.data as Float32Array;
	const bytes = embeddingData.buffer.slice(
		embeddingData.byteOffset,
		embeddingData.byteOffset + embeddingData.byteLength,
	) as ArrayBuffer;
	const blob = new Blob([bytes], { type: "application/octet-stream" });
	const url = URL.createObjectURL(blob);

	onProgress?.({ status: "Ready" });
	return url;
}
