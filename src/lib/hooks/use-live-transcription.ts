"use client";

import type { MicVAD } from "@ricky0123/vad-web";
import { useCallback, useEffect, useRef, useState } from "react";

/** Silero VAD emits 16kHz mono, which is also what every STT model here wants. */
const SAMPLE_RATE = 16000;

export type SegmentStatus =
	| "listening"
	| "queued"
	| "transcribing"
	| "done"
	| "error";

export interface TranscriptSegment {
	id: string;
	status: SegmentStatus;
	text: string;
	/** Length of the captured utterance. */
	audioMs?: number;
	transcribeMs?: number;
	error?: string;
}

export interface VadTuning {
	positiveSpeechThreshold: number;
	negativeSpeechThreshold: number;
	/** Grace period after speech drops before the segment is closed. */
	redemptionMs: number;
	/** Audio prepended to the segment so word onsets are not clipped. */
	preSpeechPadMs: number;
	/** Segments shorter than this are discarded as misfires. */
	minSpeechMs: number;
}

/**
 * Dictation tuning — deliberately different from `use-vad.ts`, which is tuned
 * for conversational barge-in and is depended on by the voice agent. For
 * dictation we want fewer, longer, cleanly-bounded segments: a longer redemption
 * so a mid-sentence pause does not split one thought in two, a longer pre-speech
 * pad so the first phoneme survives, and a higher minimum so lip smacks and key
 * clicks never reach the transcriber.
 */
export const DICTATION_VAD: VadTuning = {
	positiveSpeechThreshold: 0.6,
	negativeSpeechThreshold: 0.45,
	redemptionMs: 800,
	preSpeechPadMs: 500,
	minSpeechMs: 250,
};

export interface LiveTranscribeResult {
	text: string;
	metrics: { totalMs: number };
}

interface UseLiveTranscriptionOptions {
	/** Injected so the hook shares the caller's already-loaded model + worker. */
	transcribe: (
		audio: Float32Array,
		sampleRate: number,
	) => Promise<LiveTranscribeResult>;
	vad?: Partial<VadTuning>;
	/** Utterances allowed to wait on the transcriber before they get dropped. */
	maxQueued?: number;
}

interface QueuedUtterance {
	segmentId: string;
	audio: Float32Array;
}

/** Peak sample magnitude of a VAD frame, as 0..1. */
function framePeak(frame: Float32Array): number {
	let peak = 0;
	for (const sample of frame) {
		const magnitude = Math.abs(sample);
		if (magnitude > peak) peak = magnitude;
	}
	return Math.min(1, peak);
}

/**
 * VAD-segmented live transcription: each pause closes an utterance, which is
 * transcribed on its own and appended to `segments`. This is the same shape as
 * Hugging Face's `moonshine-web` reference app — text lands a few hundred ms
 * after a pause, not word by word.
 */
export function useLiveTranscription({
	transcribe,
	vad,
	maxQueued = 4,
}: UseLiveTranscriptionOptions) {
	const [segments, setSegments] = useState<TranscriptSegment[]>([]);
	const [isListening, setIsListening] = useState(false);
	const [isSpeechActive, setIsSpeechActive] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const vadRef = useRef<MicVAD | null>(null);
	const activeSegmentRef = useRef<string | null>(null);
	const inputPeakRef = useRef(0);
	// The worker transport has a single pending slot, so utterances arriving
	// faster than transcription completes must wait rather than overlap.
	const queueRef = useRef<QueuedUtterance[]>([]);
	const drainingRef = useRef(false);

	// Kept in refs so fresh callback / object identities never restart the VAD
	// and never invalidate start().
	const transcribeRef = useRef(transcribe);
	const vadTuningRef = useRef(vad);
	useEffect(() => {
		transcribeRef.current = transcribe;
		vadTuningRef.current = vad;
	}, [transcribe, vad]);

	const patchSegment = useCallback(
		(id: string, patch: Partial<TranscriptSegment>) => {
			setSegments((prev) =>
				prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
			);
		},
		[],
	);

	const runUtterance = useCallback(
		async ({ segmentId, audio }: QueuedUtterance) => {
			patchSegment(segmentId, { status: "transcribing" });
			try {
				const result = await transcribeRef.current(audio, SAMPLE_RATE);
				patchSegment(segmentId, {
					status: "done",
					text: result.text.trim(),
					transcribeMs: Math.round(result.metrics.totalMs),
				});
			} catch (err) {
				patchSegment(segmentId, {
					status: "error",
					error: err instanceof Error ? err.message : "Transcription failed",
				});
			}
		},
		[patchSegment],
	);

	/** Drain the queue one utterance at a time; re-entry is a no-op. */
	const drainQueue = useCallback(async () => {
		if (drainingRef.current) return;
		drainingRef.current = true;
		try {
			let next = queueRef.current.shift();
			while (next) {
				await runUtterance(next);
				next = queueRef.current.shift();
			}
		} finally {
			drainingRef.current = false;
		}
	}, [runUtterance]);

	const handleSpeechStart = useCallback(() => {
		setIsSpeechActive(true);
		const id = crypto.randomUUID();
		activeSegmentRef.current = id;
		setSegments((prev) => [...prev, { id, status: "listening", text: "" }]);
	}, []);

	const dropActiveSegment = useCallback(() => {
		setIsSpeechActive(false);
		const id = activeSegmentRef.current;
		activeSegmentRef.current = null;
		if (id) setSegments((prev) => prev.filter((s) => s.id !== id));
	}, []);

	const handleSpeechEnd = useCallback(
		(audio: Float32Array) => {
			setIsSpeechActive(false);
			const segmentId = activeSegmentRef.current ?? crypto.randomUUID();
			activeSegmentRef.current = null;
			const audioMs = Math.round((audio.length / SAMPLE_RATE) * 1000);

			if (queueRef.current.length >= maxQueued) {
				patchSegment(segmentId, {
					status: "error",
					audioMs,
					error: "Skipped — the transcriber fell behind",
				});
				return;
			}

			patchSegment(segmentId, { status: "queued", audioMs });
			queueRef.current.push({ segmentId, audio });
			void drainQueue();
		},
		[maxQueued, patchSegment, drainQueue],
	);

	// Callbacks are read through a ref so MicVAD is built once per start().
	const handlersRef = useRef({
		handleSpeechStart,
		handleSpeechEnd,
		dropActiveSegment,
	});
	useEffect(() => {
		handlersRef.current = {
			handleSpeechStart,
			handleSpeechEnd,
			dropActiveSegment,
		};
	}, [handleSpeechStart, handleSpeechEnd, dropActiveSegment]);

	const start = useCallback(async () => {
		if (vadRef.current) return;
		setError(null);
		try {
			const { MicVAD: MicVadCtor } = await import("@ricky0123/vad-web");
			const instance = await MicVadCtor.new({
				baseAssetPath: "/vad/",
				onnxWASMBasePath: "/onnx/",
				...DICTATION_VAD,
				...vadTuningRef.current,
				startOnLoad: false,
				// Flush a half-finished utterance on stop instead of losing it.
				submitUserSpeechOnPause: true,
				onFrameProcessed: (_probs, frame) => {
					inputPeakRef.current = framePeak(frame);
				},
				onSpeechStart: () => handlersRef.current.handleSpeechStart(),
				onVADMisfire: () => handlersRef.current.dropActiveSegment(),
				onSpeechEnd: (audio) => handlersRef.current.handleSpeechEnd(audio),
			});
			vadRef.current = instance;
			await instance.start();
			setIsListening(true);
		} catch (err) {
			vadRef.current = null;
			setIsListening(false);
			setError(
				err instanceof Error
					? err.message
					: "Could not access the microphone. Please allow microphone access.",
			);
		}
	}, []);

	const stop = useCallback(async () => {
		const instance = vadRef.current;
		vadRef.current = null;
		setIsListening(false);
		setIsSpeechActive(false);
		inputPeakRef.current = 0;
		if (!instance) return;
		// pause() flushes the trailing utterance through onSpeechEnd before
		// destroy() tears the graph down; the queue drains on its own after.
		await instance.pause();
		await instance.destroy();
	}, []);

	const clear = useCallback(() => {
		setSegments([]);
		activeSegmentRef.current = null;
	}, []);

	/** Live input level for a visualiser, read without triggering re-renders. */
	const getInputPeak = useCallback(() => inputPeakRef.current, []);

	useEffect(() => {
		return () => {
			const instance = vadRef.current;
			vadRef.current = null;
			queueRef.current = [];
			void instance?.destroy();
		};
	}, []);

	return {
		segments,
		isListening,
		isSpeechActive,
		error,
		start,
		stop,
		clear,
		getInputPeak,
	};
}
