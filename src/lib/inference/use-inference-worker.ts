"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AudioResult,
	DownloadProgress,
	LoadOptions,
	TranscribeResult,
	Voice,
	WorkerCommand,
	WorkerResponse,
} from "./types";

/** Result returned by loadModel once the worker finishes loading. */
export interface LoadedResult {
	backend: "webgpu" | "wasm";
	loadTime: number;
	voices: Voice[];
}

/** Extended loaded response that includes voices sent by the worker. */
type LoadedMessage = Extract<WorkerResponse, { type: "loaded" }> & {
	voices?: Voice[];
};

export function useInferenceWorker() {
	const workerRef = useRef<Worker | null>(null);
	const pendingRef = useRef<{
		// biome-ignore lint/suspicious/noExplicitAny: promise resolves with different types per command
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	} | null>(null);
	const onProgressRef = useRef<
		((progress: DownloadProgress) => void) | null
	>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);

	const getWorker = useCallback(() => {
		if (!workerRef.current) {
			workerRef.current = new Worker(
				new URL("./inference-worker.ts", import.meta.url),
			);

			workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
				const msg = e.data;

				switch (msg.type) {
					case "progress":
						onProgressRef.current?.(msg.data);
						break;

					case "loaded": {
						setIsLoading(false);
						const loaded = msg as LoadedMessage;
						const result: LoadedResult = {
							backend: loaded.backend,
							loadTime: loaded.loadTime,
							voices: loaded.voices ?? [],
						};
						pendingRef.current?.resolve(result);
						pendingRef.current = null;
						break;
					}

					case "audio":
						setIsGenerating(false);
						pendingRef.current?.resolve(msg.data);
						pendingRef.current = null;
						break;

					case "transcript":
						setIsGenerating(false);
						pendingRef.current?.resolve(msg.data);
						pendingRef.current = null;
						break;

					case "disposed":
						pendingRef.current?.resolve(undefined);
						pendingRef.current = null;
						break;

					case "error":
						setIsLoading(false);
						setIsGenerating(false);
						pendingRef.current?.reject(new Error(msg.message));
						pendingRef.current = null;
						break;
				}
			};

			workerRef.current.onerror = (e) => {
				setIsLoading(false);
				setIsGenerating(false);
				pendingRef.current?.reject(
					new Error(e.message || "Worker error"),
				);
				pendingRef.current = null;
			};
		}
		return workerRef.current;
	}, []);

	const sendCommand = useCallback(
		<T>(cmd: WorkerCommand, transfer?: Transferable[]): Promise<T> => {
			return new Promise<T>((resolve, reject) => {
				pendingRef.current = { resolve, reject };
				const worker = getWorker();
				worker.postMessage(cmd, { transfer: transfer ?? [] });
			});
		},
		[getWorker],
	);

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
			onProgressRef.current = options.onProgress ?? null;

			try {
				const result = await sendCommand<LoadedResult>({
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
				onProgressRef.current = null;
			}
		},
		[sendCommand],
	);

	const synthesize = useCallback(
		async (
			modelSlug: string,
			text: string,
			voice: string,
		): Promise<AudioResult> => {
			setIsGenerating(true);
			try {
				return await sendCommand<AudioResult>({
					type: "synthesize",
					modelSlug,
					text,
					voice,
				});
			} catch (err) {
				setIsGenerating(false);
				throw err;
			}
		},
		[sendCommand],
	);

	const transcribe = useCallback(
		async (
			modelSlug: string,
			audio: Float32Array,
			sampleRate: number,
		): Promise<TranscribeResult> => {
			setIsGenerating(true);
			try {
				return await sendCommand<TranscribeResult>(
					{ type: "transcribe", modelSlug, audio, sampleRate },
					[audio.buffer],
				);
			} catch (err) {
				setIsGenerating(false);
				throw err;
			}
		},
		[sendCommand],
	);

	const dispose = useCallback(
		async (modelSlug: string): Promise<void> => {
			await sendCommand<void>({ type: "dispose", modelSlug });
		},
		[sendCommand],
	);

	// Terminate worker on unmount
	useEffect(() => {
		return () => {
			workerRef.current?.terminate();
			workerRef.current = null;
		};
	}, []);

	return {
		loadModel,
		synthesize,
		transcribe,
		dispose,
		isLoading,
		isGenerating,
	};
}
