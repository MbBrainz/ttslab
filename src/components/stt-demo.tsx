"use client";

import { Cpu, Loader2, Mic, Radio, Zap } from "lucide-react";
import { GpuEstimate } from "@/components/gpu-estimate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyserPeakReader, MicWaveform } from "@/components/mic-waveform";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { Button } from "@/components/ui/button";
import { trackModelLoad, trackSTTTranscription } from "@/lib/analytics";
import { createDownloadTracker } from "@/lib/inference/download-tracker";
import type { Model } from "@/lib/db/schema";
import {
	type TranscriptSegment,
	useLiveTranscription,
} from "@/lib/hooks/use-live-transcription";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import { pickRecordingMimeType } from "@/lib/recording-mime";
import { cn } from "@/lib/utils";

type SttDemoProps = {
	model: Model;
};

const PENDING_LABEL = {
	listening: "Listening…",
	queued: "Queued…",
	transcribing: "Transcribing…",
} as const;

/** close() rejects on an already-closed context, so guard and swallow. */
async function closeAudioContext(ctx: AudioContext | null): Promise<void> {
	if (!ctx || ctx.state === "closed") return;
	try {
		await ctx.close();
	} catch {
		// Already closed or closing — nothing to do.
	}
}

function SegmentRow({ segment }: { segment: TranscriptSegment }) {
	if (segment.status === "error") {
		return (
			<p className="text-sm text-destructive">
				{segment.error ?? "Transcription failed"}
			</p>
		);
	}

	if (segment.status === "done") {
		if (!segment.text) {
			return (
				<p className="text-sm italic text-muted-foreground">
					No speech detected
				</p>
			);
		}
		return (
			<p className="text-sm leading-relaxed">
				{segment.text}
				{segment.transcribeMs != null && (
					<span className="ml-2 text-xs tabular-nums text-muted-foreground">
						{segment.transcribeMs}ms
					</span>
				)}
			</p>
		);
	}

	return (
		<p className="flex items-center gap-2 text-sm italic text-muted-foreground">
			{segment.status === "listening" ? (
				<span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
			) : (
				<Loader2 className="h-3 w-3 shrink-0 animate-spin" />
			)}
			{PENDING_LABEL[segment.status]}
		</p>
	);
}

export function SttDemo({ model }: SttDemoProps) {
	const [modelState, setModelState] = useState<ModelState>({
		status: "not_loaded",
	});
	const [isRecording, setIsRecording] = useState(false);
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
	const [recordedSegments, setRecordedSegments] = useState<TranscriptSegment[]>(
		[],
	);
	const [recordingDuration, setRecordingDuration] = useState(0);

	const { loadModel, transcribe, dispose } = useInferenceWorker();

	// Live mode shares this component's worker, so it transcribes with the model
	// that is already loaded rather than loading a second copy.
	const transcribeUtterance = useCallback(
		(audio: Float32Array, sampleRate: number) =>
			transcribe(model.slug, audio, sampleRate),
		[model.slug, transcribe],
	);
	const live = useLiveTranscription({ transcribe: transcribeUtterance });

	const backendRef = useRef<"webgpu" | "wasm">("wasm");
	const loadTimeRef = useRef(0);
	const modelReadyRef = useRef(false);
	const loadingRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const streamRef = useRef<MediaStream | null>(null);
	// The source node is retained alongside the context: an unreferenced
	// MediaStreamAudioSourceNode can be collected mid-recording in Chrome.
	const audioCtxRef = useRef<AudioContext | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

	/** Release the mic, the source node and the capture AudioContext. */
	const teardownCapture = useCallback(() => {
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		setAnalyser(null);
		void closeAudioContext(audioCtxRef.current);
		audioCtxRef.current = null;
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
	}, []);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
			teardownCapture();
		};
	}, [teardownCapture]);

	const handleDownload = useCallback(async () => {
		if (loadingRef.current) return;
		loadingRef.current = true;

		const estimatedBytes = (model.sizeMb ?? 0) * 1024 * 1024;
		const tracker = createDownloadTracker(estimatedBytes);

		setModelState({
			status: "downloading",
			progress: 0,
			speed: 0,
			total: estimatedBytes,
			downloaded: 0,
		});

		try {
			const result = await loadModel(model.slug, {
				backend: "auto",
				onProgress: (progress) => {
					const state = tracker.process(progress);
					if (state) setModelState(state);
				},
			});

			setModelState({ status: "initializing" });
			await new Promise((r) => setTimeout(r, 200));

			backendRef.current = result.backend;
			loadTimeRef.current = result.loadTime;
			modelReadyRef.current = true;

			trackModelLoad(model.slug, result.backend, result.loadTime);

			setModelState({
				status: "ready",
				backend: result.backend,
				loadTime: result.loadTime,
			});
		} catch (err) {
			setModelState({
				status: "error",
				code: "LOAD_FAILED",
				message: err instanceof Error ? err.message : "Failed to load model",
				recoverable: true,
			});
		} finally {
			loadingRef.current = false;
		}
	}, [model.slug, model.sizeMb, loadModel]);

	const handleRetry = useCallback(() => {
		if (modelReadyRef.current) {
			setModelState({ status: "ready", backend: backendRef.current, loadTime: loadTimeRef.current });
		} else {
			dispose(model.slug);
			modelReadyRef.current = false;
			setModelState({ status: "not_loaded" });
		}
	}, [model.slug, dispose]);

	const startRecording = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;

			// Set up the analyser that feeds the live waveform
			const audioCtx = new AudioContext();
			const source = audioCtx.createMediaStreamSource(stream);
			const node = audioCtx.createAnalyser();
			node.fftSize = 2048;
			source.connect(node);
			audioCtxRef.current = audioCtx;
			sourceRef.current = source;
			setAnalyser(node);

			// Start MediaRecorder
			const mimeType = pickRecordingMimeType();
			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType } : undefined,
			);
			audioChunksRef.current = [];
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					audioChunksRef.current.push(e.data);
				}
			};
			recorder.start();
			mediaRecorderRef.current = recorder;

			setIsRecording(true);
			setRecordingDuration(0);

			timerRef.current = setInterval(() => {
				setRecordingDuration((prev) => prev + 100);
			}, 100);
		} catch (err) {
			teardownCapture();
			setModelState({
				status: "error",
				code: "MIC_ACCESS_DENIED",
				message:
					err instanceof Error
						? err.message
						: "Could not access microphone. Please allow microphone access.",
				recoverable: true,
			});
		}
	}, [teardownCapture]);

	const stopRecording = useCallback(async () => {
		setIsRecording(false);

		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}

		const recorder = mediaRecorderRef.current;
		if (!recorder || recorder.state === "inactive") {
			teardownCapture();
			return;
		}

		// Wait for the recorder to finish
		const audioBlob = await new Promise<Blob>((resolve) => {
			recorder.onstop = () => {
				const blob = new Blob(
					audioChunksRef.current,
					recorder.mimeType ? { type: recorder.mimeType } : undefined,
				);
				resolve(blob);
			};
			recorder.stop();
		});

		teardownCapture();

		const startTime = performance.now();

		setModelState({
			status: "processing",
			elapsed: 0,
			type: "stt",
		});

		const timer = setInterval(() => {
			setModelState((prev) => {
				if (prev.status !== "processing") return prev;
				return {
					...prev,
					elapsed: Math.round(performance.now() - startTime),
				};
			});
		}, 100);

		// Decoding needs its own 16kHz context; it is closed as soon as the
		// samples are copied out, before the (much longer) transcribe await.
		const decodeCtx = new AudioContext({ sampleRate: 16000 });

		try {
			const arrayBuffer = await audioBlob.arrayBuffer();
			const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
			// Copy: transcribe() transfers the buffer to the worker.
			const pcm = new Float32Array(audioBuffer.getChannelData(0));
			const audioDuration = audioBuffer.duration;
			await closeAudioContext(decodeCtx);

			const result = await transcribe(model.slug, pcm, 16000);

			clearInterval(timer);

			setRecordedSegments((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					status: "done",
					text: result.text.trim(),
					createdAt: Date.now(),
					audioMs: Math.round(audioDuration * 1000),
					transcribeMs: Math.round(result.metrics.totalMs),
				},
			]);

			trackSTTTranscription(
				model.slug,
				backendRef.current,
				Math.round(audioDuration * 1000),
				result.metrics.totalMs,
			);

			setModelState({
				status: "result",
				metrics: {
					totalMs: result.metrics.totalMs,
					audioDuration,
					rtf:
						audioDuration > 0
							? result.metrics.totalMs / 1000 / audioDuration
							: undefined,
					backend: result.metrics.backend ?? backendRef.current,
				},
			});
		} catch (err) {
			clearInterval(timer);
			setModelState({
				status: "error",
				code: "TRANSCRIBE_FAILED",
				message:
					err instanceof Error ? err.message : "Failed to transcribe audio",
				recoverable: true,
			});
		} finally {
			// No-op if the success path already closed it.
			await closeAudioContext(decodeCtx);
		}
	}, [model.slug, transcribe, teardownCapture]);

	const toggleRecording = useCallback(() => {
		if (isRecording) {
			stopRecording();
		} else {
			startRecording();
		}
	}, [isRecording, startRecording, stopRecording]);

	function formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	const toggleListening = useCallback(() => {
		if (live.isListening) {
			void live.stop();
		} else {
			void live.start();
		}
	}, [live.isListening, live.start, live.stop]);

	const clearTranscript = useCallback(() => {
		setRecordedSegments([]);
		live.clear();
	}, [live.clear]);

	const isReady =
		modelState.status === "ready" || modelState.status === "result";

	const segments = useMemo(
		() =>
			[...recordedSegments, ...live.segments].sort(
				(a, b) => a.createdAt - b.createdAt,
			),
		[recordedSegments, live.segments],
	);

	const isCapturing = isRecording || live.isListening;
	const peakReader = useMemo(
		() => (analyser ? analyserPeakReader(analyser) : null),
		[analyser],
	);
	const getPeak = isRecording ? peakReader : live.getInputPeak;

	return (
		<div className="space-y-6">
			<ModelStatus
				state={modelState}
				modelName={model.name}
				sizeMb={model.sizeMb}
				onDownload={handleDownload}
				onRetry={handleRetry}
			/>

			<div className="flex flex-col items-center gap-6">
				{/* Record button */}
				<div className="relative">
					{isRecording && (
						<div className="absolute inset-0 animate-ping rounded-full bg-destructive/20" />
					)}
					<Button
						variant={isRecording ? "destructive" : "default"}
						size="lg"
						onClick={toggleRecording}
						disabled={(!isReady && !isRecording) || live.isListening}
						className={cn(
							"relative h-20 w-20 rounded-full",
							isRecording && "shadow-lg shadow-destructive/25",
						)}
						aria-label={isRecording ? "Stop recording" : "Start recording"}
					>
						{isRecording ? (
							<div className="h-6 w-6 rounded-sm bg-destructive-foreground" />
						) : (
							<Mic className="h-8 w-8" />
						)}
					</Button>
				</div>

				<p className="text-sm text-muted-foreground">
					{!isReady
						? "Download the model first to start recording"
						: live.isListening
							? "Listening — speak, and each pause is transcribed"
							: isRecording
								? "Click to stop recording"
								: "Click to record one clip, or listen continuously"}
				</p>

				{/* Live transcription toggle, alongside the one-shot recorder */}
				<Button
					variant={live.isListening ? "destructive" : "outline"}
					size="sm"
					onClick={toggleListening}
					disabled={!isReady || isRecording}
					className="min-h-11"
				>
					<Radio
						className={cn("h-4 w-4", live.isListening && "animate-pulse")}
					/>
					{live.isListening ? "Stop Listening" : "Start Listening"}
				</Button>

				{live.error && <p className="text-sm text-destructive">{live.error}</p>}

				{/* Recording duration */}
				{isRecording && (
					<div className="flex items-center gap-2 font-mono text-lg tabular-nums text-destructive">
						<span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
						{formatDuration(recordingDuration)}
					</div>
				)}

				{/* Live waveform */}
				{isCapturing && (
					<div className="w-full max-w-xs">
						<MicWaveform getPeak={getPeak} isActive={isCapturing} />
					</div>
				)}
			</div>

			{/* Transcript output */}
			{segments.length > 0 && (
				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-medium text-foreground">Transcript</h3>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs text-muted-foreground"
							onClick={clearTranscript}
						>
							Clear
						</Button>
					</div>
					<div className="min-h-[80px] space-y-2 rounded-lg border border-border bg-secondary/30 p-4">
						{segments.map((segment) => (
							<SegmentRow key={segment.id} segment={segment} />
						))}
					</div>
				</div>
			)}

			{/* Metrics — one-shot only; live mode reports per segment */}
			{modelState.status === "result" && !live.isListening && (
				<div className={`grid gap-4 rounded-lg border border-border bg-secondary/30 p-4 ${modelState.metrics.backend === "wasm" ? "grid-cols-4" : "grid-cols-3"}`}>
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Processing time</p>
						<p className="text-lg font-semibold tabular-nums">
							{modelState.metrics.totalMs < 1000
								? `${modelState.metrics.totalMs}ms`
								: `${(modelState.metrics.totalMs / 1000).toFixed(2)}s`}
						</p>
					</div>
					{modelState.metrics.audioDuration != null && (
						<div className="text-center">
							<p className="text-xs text-muted-foreground">Audio duration</p>
							<p className="text-lg font-semibold tabular-nums">
								{modelState.metrics.audioDuration.toFixed(2)}s
							</p>
						</div>
					)}
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Backend</p>
						<p className="text-lg font-semibold">
							{modelState.metrics.backend === "webgpu" ? (
								<span className="inline-flex items-center gap-1">
									<Zap className="h-4 w-4 text-success" />
									WebGPU
								</span>
							) : (
								<span className="inline-flex items-center gap-1">
									<Cpu className="h-4 w-4 text-warning" />
									WASM
								</span>
							)}
						</p>
					</div>
					<GpuEstimate totalMs={modelState.metrics.totalMs} backend={modelState.metrics.backend} />
				</div>
			)}
		</div>
	);
}
