"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AudioResult,
	DownloadProgress,
	LoadOptions,
	TranscribeResult,
} from "./types";
import {
	WorkerTransport,
	type LoadedResult,
	type StreamCallbacks,
} from "./worker-transport";

// Re-export for consumers
export type { StreamCallbacks, LoadedResult };

export function useInferenceWorker() {
	const transportRef = useRef<WorkerTransport | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);

	const getTransport = useCallback(() => {
		if (!transportRef.current) {
			transportRef.current = new WorkerTransport({
				onStateChange: (update) => {
					if (update.isLoading !== undefined) setIsLoading(update.isLoading);
					if (update.isGenerating !== undefined)
						setIsGenerating(update.isGenerating);
					if (update.isStreaming !== undefined)
						setIsStreaming(update.isStreaming);
				},
			});
			transportRef.current.ensureWorker();
		}
		return transportRef.current;
	}, []);

	const loadModel = useCallback(
		async (
			modelSlug: string,
			options: {
				backend: LoadOptions["backend"];
				quantization?: LoadOptions["quantization"];
				onProgress?: (progress: DownloadProgress) => void;
			},
		): Promise<LoadedResult> => {
			setIsLoading(true);
			const transport = getTransport();
			transport.setProgressCallback(options.onProgress ?? null);

			try {
				const result = await transport.sendCommand<LoadedResult>({
					type: "load",
					modelSlug,
					options: {
						backend: options.backend,
						quantization: options.quantization,
					},
				});
				return result;
			} catch (err) {
				setIsLoading(false);
				throw err;
			} finally {
				transport.setProgressCallback(null);
			}
		},
		[getTransport],
	);

	const synthesize = useCallback(
		async (
			modelSlug: string,
			text: string,
			voice: string,
			speakerEmbeddingUrl?: string,
			speed?: number,
		): Promise<AudioResult> => {
			setIsGenerating(true);
			try {
				return await getTransport().sendCommand<AudioResult>({
					type: "synthesize",
					modelSlug,
					text,
					voice,
					speakerEmbeddingUrl,
					speed,
				});
			} catch (err) {
				setIsGenerating(false);
				throw err;
			}
		},
		[getTransport],
	);

	const transcribe = useCallback(
		async (
			modelSlug: string,
			audio: Float32Array,
			sampleRate: number,
		): Promise<TranscribeResult> => {
			setIsGenerating(true);
			try {
				return await getTransport().sendCommand<TranscribeResult>(
					{ type: "transcribe", modelSlug, audio, sampleRate },
					[audio.buffer],
				);
			} catch (err) {
				setIsGenerating(false);
				throw err;
			}
		},
		[getTransport],
	);

	const synthesizeStream = useCallback(
		(
			modelSlug: string,
			text: string,
			voice: string,
			speakerEmbeddingUrl: string | undefined,
			callbacks: StreamCallbacks,
		): void => {
			const transport = getTransport();
			transport.setStreamCallbacks(callbacks);
			setIsStreaming(true);
			transport.postCommand({
				type: "synthesize-stream",
				modelSlug,
				text,
				voice,
				speakerEmbeddingUrl,
			});
		},
		[getTransport],
	);

	const cancelStream = useCallback((): void => {
		getTransport().postCommand({ type: "cancel-stream" });
	}, [getTransport]);

	const extractEmbedding = useCallback(
		async (
			audio: Float32Array,
			sampleRate: number,
			onProgress?: (progress: DownloadProgress) => void,
		): Promise<string> => {
			setIsGenerating(true);
			const transport = getTransport();
			transport.setProgressCallback(onProgress ?? null);
			try {
				return await transport.sendCommand<string>(
					{ type: "extract-embedding", audio, sampleRate },
					[audio.buffer],
				);
			} catch (err) {
				setIsGenerating(false);
				throw err;
			} finally {
				transport.setProgressCallback(null);
			}
		},
		[getTransport],
	);

	const dispose = useCallback(
		async (modelSlug: string): Promise<void> => {
			await getTransport().sendCommand<void>({
				type: "dispose",
				modelSlug,
			});
		},
		[getTransport],
	);

	// Create transport eagerly on mount, terminate on unmount
	useEffect(() => {
		getTransport();
		return () => {
			transportRef.current?.terminate();
			transportRef.current = null;
		};
	}, [getTransport]);

	return {
		loadModel,
		synthesize,
		synthesizeStream,
		cancelStream,
		transcribe,
		extractEmbedding,
		dispose,
		isLoading,
		isGenerating,
		isStreaming,
	};
}
