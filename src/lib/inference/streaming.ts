export interface StreamingOptions {
	onChunkReady: (
		audio: Float32Array,
		sampleRate: number,
		chunkIndex: number,
	) => void;
	onComplete: (
		fullAudio: Float32Array,
		sampleRate: number,
		totalMs: number,
	) => void;
	onError: (error: Error) => void;
}

/**
 * Split text into sentences, keeping punctuation attached.
 * Handles common abbreviations (Mr., Dr., etc.) to avoid false splits.
 */
export function splitIntoSentences(text: string): string[] {
	// Replace common abbreviations with placeholders to avoid false splits
	const abbreviations = [
		"Mr.",
		"Mrs.",
		"Ms.",
		"Dr.",
		"Prof.",
		"Sr.",
		"Jr.",
		"St.",
		"vs.",
		"etc.",
		"e.g.",
		"i.e.",
	];
	let processed = text;
	const placeholders: [string, string][] = [];

	for (const abbr of abbreviations) {
		const placeholder = abbr.replace(/\./g, "\u0000");
		placeholders.push([placeholder, abbr]);
		processed = processed.split(abbr).join(placeholder);
	}

	// Split on sentence-ending punctuation followed by whitespace
	const parts = processed.split(/(?<=[.!?])\s+/);

	// Restore abbreviations and filter empty strings
	return parts
		.map((part) => {
			let restored = part;
			for (const [placeholder, original] of placeholders) {
				restored = restored.split(placeholder).join(original);
			}
			return restored.trim();
		})
		.filter((s) => s.length > 0);
}

/**
 * Concatenate multiple Float32Array chunks into a single array.
 */
function concatenateAudio(chunks: Float32Array[]): Float32Array {
	const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
	const result = new Float32Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

/**
 * Generate TTS audio in sentence-level chunks, calling onChunkReady as each
 * sentence finishes so playback can start before the full text is synthesized.
 *
 * @param synthesizeFn - Function that generates audio for a single text+voice
 *   (typically bound from a ModelLoader's synthesize method)
 * @param text - Full input text to synthesize
 * @param voice - Voice ID to use
 * @param options - Streaming callbacks
 */
export async function streamingSynthesize(
	synthesizeFn: (
		text: string,
		voice: string,
	) => Promise<{ audio: Float32Array; sampleRate: number }>,
	text: string,
	voice: string,
	options: StreamingOptions,
): Promise<void> {
	const sentences = splitIntoSentences(text);
	if (sentences.length === 0) return;

	const start = performance.now();

	// Single sentence — skip chunking overhead
	if (sentences.length === 1) {
		try {
			const result = await synthesizeFn(sentences[0], voice);
			options.onChunkReady(result.audio, result.sampleRate, 0);
			options.onComplete(
				result.audio,
				result.sampleRate,
				performance.now() - start,
			);
		} catch (err) {
			options.onError(
				err instanceof Error ? err : new Error(String(err)),
			);
		}
		return;
	}

	// Multiple sentences — generate sequentially, stream chunks as they arrive
	const chunks: Float32Array[] = [];
	let sampleRate = 24000;

	for (let i = 0; i < sentences.length; i++) {
		try {
			const result = await synthesizeFn(sentences[i], voice);
			sampleRate = result.sampleRate;
			chunks.push(result.audio);
			options.onChunkReady(result.audio, result.sampleRate, i);
		} catch (err) {
			options.onError(
				err instanceof Error ? err : new Error(String(err)),
			);
			return;
		}
	}

	const fullAudio = concatenateAudio(chunks);
	options.onComplete(fullAudio, sampleRate, performance.now() - start);
}
