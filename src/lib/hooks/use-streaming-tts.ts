"use client";

import { useCallback, useRef, useState } from "react";
import { AudioQueue } from "@/lib/inference/audio-queue";
import { float32ToWav } from "@/lib/audio-utils";
import type { ModelState } from "@/components/model-status";
import type { StreamCallbacks } from "@/lib/inference/use-inference-worker";

interface UseStreamingTtsOptions {
	synthesizeStream: (
		modelSlug: string,
		text: string,
		voice: string,
		speakerEmbeddingUrl: string | undefined,
		callbacks: StreamCallbacks,
	) => void;
	cancelStream: () => void;
	modelSlug: string;
	backend: "webgpu" | "wasm";
	setModelState: (state: ModelState | ((prev: ModelState) => ModelState)) => void;
	onAudioReady: (url: string) => void;
}

export interface StreamProgress {
	chunkIndex: number;
	totalChunks: number;
	currentSentence: string;
}

export interface UseStreamingTtsReturn {
	startStream: (
		text: string,
		voice: string,
		speakerEmbeddingUrl?: string,
	) => void;
	stopStream: () => void;
	isStreaming: boolean;
	analyser: AnalyserNode | null;
	streamProgress: StreamProgress | null;
}

export function useStreamingTts({
	synthesizeStream,
	cancelStream,
	modelSlug,
	backend,
	setModelState,
	onAudioReady,
}: UseStreamingTtsOptions): UseStreamingTtsReturn {
	const [isStreaming, setIsStreaming] = useState(false);
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
	const [streamProgress, setStreamProgress] = useState<StreamProgress | null>(
		null,
	);

	const queueRef = useRef<AudioQueue | null>(null);
	const chunksRef = useRef<{ audio: Float32Array; sampleRate: number }[]>([]);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const startTimeRef = useRef(0);
	const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const cleanup = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (fallbackTimerRef.current) {
			clearTimeout(fallbackTimerRef.current);
			fallbackTimerRef.current = null;
		}
		setIsStreaming(false);
		setAnalyser(null);
		setStreamProgress(null);
	}, []);

	const stopStream = useCallback(() => {
		cancelStream();
		queueRef.current?.stop();
		queueRef.current = null;
		cleanup();
		// Reset model card back to ready
		setModelState({
			status: "ready",
			backend,
			loadTime: 0,
		});
	}, [cancelStream, cleanup, setModelState, backend]);

	const startStream = useCallback(
		(text: string, voice: string, speakerEmbeddingUrl?: string) => {
			if (!text.trim()) return;

			// Clean up any previous stream
			if (queueRef.current) {
				queueRef.current.stop();
				queueRef.current = null;
			}

			const queue = new AudioQueue();
			queueRef.current = queue;
			chunksRef.current = [];
			startTimeRef.current = performance.now();

			setIsStreaming(true);
			setAnalyser(queue.analyserNode);
			setStreamProgress(null);

			setModelState({
				status: "streaming",
				elapsed: 0,
				chunksReady: 0,
				totalChunks: 1,
				currentSentence: "",
			});

			// Elapsed timer
			timerRef.current = setInterval(() => {
				setModelState((prev) => {
					if (prev.status !== "streaming") return prev;
					return {
						...prev,
						elapsed: Math.round(performance.now() - startTimeRef.current),
					};
				});
			}, 100);

			let streamSampleRate = 24000;

			const callbacks: StreamCallbacks = {
				onChunk: (data) => {
					chunksRef.current.push({
						audio: data.audio,
						sampleRate: data.sampleRate,
					});
					streamSampleRate = data.sampleRate;
					queue.enqueue(data.audio, data.sampleRate);

					const progress: StreamProgress = {
						chunkIndex: data.chunkIndex + 1,
						totalChunks: data.totalChunks,
						currentSentence: data.sentenceText,
					};
					setStreamProgress(progress);
					setModelState((prev) => {
						if (prev.status !== "streaming") return prev;
						return {
							...prev,
							chunksReady: data.chunkIndex + 1,
							totalChunks: data.totalChunks,
							currentSentence: data.sentenceText,
						};
					});
				},
				onEnd: (data) => {
					// Stop the elapsed timer immediately
					if (timerRef.current) {
						clearInterval(timerRef.current);
						timerRef.current = null;
					}

					// Concatenate all chunks into a single WAV blob
					const chunks = chunksRef.current;
					const totalLength = chunks.reduce(
						(sum, c) => sum + c.audio.length,
						0,
					);
					const fullAudio = new Float32Array(totalLength);
					let offset = 0;
					for (const chunk of chunks) {
						fullAudio.set(chunk.audio, offset);
						offset += chunk.audio.length;
					}

					const wavBlob = float32ToWav(fullAudio, streamSampleRate);
					const url = URL.createObjectURL(wavBlob);

					let transitioned = false;
					const finalize = () => {
						if (transitioned) return;
						transitioned = true;

						if (fallbackTimerRef.current) {
							clearTimeout(fallbackTimerRef.current);
							fallbackTimerRef.current = null;
						}

						setAnalyser(null);
						setIsStreaming(false);
						setStreamProgress(null);

						const duration = fullAudio.length / streamSampleRate;
						const rtf =
							duration > 0
								? data.totalMs / 1000 / duration
								: undefined;

						setModelState({
							status: "result",
							metrics: {
								totalMs: data.totalMs,
								audioDuration: duration,
								rtf,
								backend,
							},
						});
					};

					// Wait for all audio to finish playing before transitioning to result
					queue.onAllEnded = finalize;
					onAudioReady(url);

					// If audio already finished playing (very short text), trigger immediately
					if (!queue.isPlaying) {
						finalize();
						return;
					}

					// Safety fallback: estimate remaining playback time from AudioQueue
					// scheduledEndTime is absolute (context time when last source ends),
					// currentTime is where playback is now — difference is remaining time
					const remaining = Math.max(
						0,
						queue.scheduledEndTime - queue.currentTime,
					);
					fallbackTimerRef.current = setTimeout(
						() => finalize(),
						(remaining + 1) * 1000,
					);
				},
				onError: (error) => {
					queueRef.current?.stop();
					queueRef.current = null;
					cleanup();
					setModelState({
						status: "error",
						code: "STREAM_FAILED",
						message: error.message,
						recoverable: true,
					});
				},
			};

			synthesizeStream(
				modelSlug,
				text,
				voice,
				speakerEmbeddingUrl,
				callbacks,
			);
		},
		[synthesizeStream, modelSlug, backend, setModelState, onAudioReady, cleanup],
	);

	return {
		startStream,
		stopStream,
		isStreaming,
		analyser,
		streamProgress,
	};
}
