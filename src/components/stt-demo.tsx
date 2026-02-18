"use client";

import { Cpu, Mic, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { Button } from "@/components/ui/button";
import { trackModelLoad, trackSTTTranscription } from "@/lib/analytics";
import type { Model } from "@/lib/db/schema";
import { selectBackend } from "@/lib/inference/backend-select";
import { getLoader } from "@/lib/inference/registry";
import type { ModelLoader } from "@/lib/inference/types";
import { cn } from "@/lib/utils";

type SttDemoProps = {
	model: Model;
};

export function SttDemo({ model }: SttDemoProps) {
	const [modelState, setModelState] = useState<ModelState>({
		status: "not_loaded",
	});
	const [isRecording, setIsRecording] = useState(false);
	const [audioLevel, setAudioLevel] = useState(0);
	const [transcript, setTranscript] = useState("");
	const [recordingDuration, setRecordingDuration] = useState(0);

	const loaderRef = useRef<ModelLoader | null>(null);
	const backendRef = useRef<"webgpu" | "wasm">("wasm");
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const levelAnimRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(
		null,
	);
	const streamRef = useRef<MediaStream | null>(null);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
			if (levelAnimRef.current) cancelAnimationFrame(levelAnimRef.current);
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) {
					track.stop();
				}
			}
		};
	}, []);

	const handleDownload = useCallback(async () => {
		try {
			const loader = await getLoader(model.slug);
			if (!loader) {
				setModelState({
					status: "error",
					code: "LOADER_NOT_FOUND",
					message: `No loader registered for ${model.slug}`,
					recoverable: false,
				});
				return;
			}

			loaderRef.current = loader;

			const preferred = loader.getPreferredBackend?.() ?? "auto";
			const backend = await selectBackend(
				model.supportsWebgpu ?? false,
				model.supportsWasm ?? false,
				preferred,
			);
			backendRef.current = backend;

			let totalBytes = (model.sizeMb ?? 0) * 1024 * 1024;
			let downloadedBytes = 0;
			let lastDisplayTime = 0;
			let smoothSpeed = 0;

			setModelState({
				status: "downloading",
				progress: 0,
				speed: 0,
				total: totalBytes,
				downloaded: 0,
			});

			const loadStart = performance.now();

			await loader.load({
				backend,
				onProgress: (progress) => {
					if (progress.total > 0) {
						totalBytes = progress.total;
					}
					downloadedBytes = progress.loaded;

					if (downloadedBytes >= totalBytes && totalBytes > 0) {
						setModelState({ status: "initializing" });
						return;
					}

					// Throttle UI updates to every 500ms
					const now = performance.now();
					const dt = (now - lastDisplayTime) / 1000;
					if (dt < 0.5 && downloadedBytes < totalBytes) return;

					const elapsed = (now - loadStart) / 1000;
					const speed = elapsed > 0 ? downloadedBytes / elapsed : 0;
					smoothSpeed =
						smoothSpeed === 0 ? speed : smoothSpeed * 0.7 + speed * 0.3;
					lastDisplayTime = now;

					const pct =
						totalBytes > 0
							? Math.round((downloadedBytes / totalBytes) * 100)
							: 0;

					setModelState({
						status: "downloading",
						progress: pct,
						speed: smoothSpeed,
						total: totalBytes,
						downloaded: downloadedBytes,
					});
				},
			});

			setModelState({ status: "initializing" });
			await new Promise((r) => setTimeout(r, 200));

			const loadTime = Math.round(performance.now() - loadStart);

			trackModelLoad(model.slug, backend, loadTime);

			setModelState({
				status: "ready",
				backend,
				loadTime,
			});
		} catch (err) {
			setModelState({
				status: "error",
				code: "LOAD_FAILED",
				message: err instanceof Error ? err.message : "Failed to load model",
				recoverable: true,
			});
		}
	}, [model.slug, model.supportsWebgpu, model.supportsWasm, model.sizeMb]);

	const handleRetry = useCallback(() => {
		loaderRef.current = null;
		setModelState({ status: "not_loaded" });
	}, []);

	const startRecording = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;

			// Set up audio level analysis
			const audioCtx = new AudioContext();
			const source = audioCtx.createMediaStreamSource(stream);
			const analyser = audioCtx.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);
			analyserRef.current = analyser;

			// Animate audio level
			const dataArray = new Uint8Array(analyser.frequencyBinCount);
			function updateLevel() {
				analyser.getByteFrequencyData(dataArray);
				const avg =
					dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
				setAudioLevel(avg / 255);
				levelAnimRef.current = requestAnimationFrame(updateLevel);
			}
			updateLevel();

			// Start MediaRecorder
			const recorder = new MediaRecorder(stream);
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
			setTranscript("");

			timerRef.current = setInterval(() => {
				setRecordingDuration((prev) => prev + 100);
			}, 100);
		} catch (err) {
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
	}, []);

	const stopRecording = useCallback(async () => {
		setIsRecording(false);
		setAudioLevel(0);

		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (levelAnimRef.current) {
			cancelAnimationFrame(levelAnimRef.current);
			levelAnimRef.current = null;
		}

		const recorder = mediaRecorderRef.current;
		if (!recorder || recorder.state === "inactive") return;

		// Wait for the recorder to finish
		const audioBlob = await new Promise<Blob>((resolve) => {
			recorder.onstop = () => {
				const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
				resolve(blob);
			};
			recorder.stop();
		});

		// Stop microphone
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}

		// Transcribe
		if (!loaderRef.current?.transcribe) return;

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

		try {
			// Decode audio blob to Float32Array
			const audioCtx = new AudioContext({ sampleRate: 16000 });
			const arrayBuffer = await audioBlob.arrayBuffer();
			const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
			const pcm = audioBuffer.getChannelData(0);

			const result = await loaderRef.current.transcribe(pcm, 16000);

			clearInterval(timer);

			setTranscript(result.text);

			const audioDuration = audioBuffer.duration;

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
		}
	}, []);

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

	const isReady =
		modelState.status === "ready" || modelState.status === "result";

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
						disabled={!isReady && !isRecording}
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
					{!isReady && !isRecording
						? "Download the model first to start recording"
						: isRecording
							? "Click to stop recording"
							: "Click to start recording"}
				</p>

				{/* Recording duration */}
				{isRecording && (
					<div className="flex items-center gap-2 font-mono text-lg tabular-nums text-destructive">
						<span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
						{formatDuration(recordingDuration)}
					</div>
				)}

				{/* Audio level indicator */}
				{isRecording && (
					<div className="flex h-16 w-full max-w-xs items-end justify-center gap-1">
						{Array.from({ length: 20 }, (_, i) => {
							const barHeight = Math.max(
								4,
								Math.min(64, audioLevel * 64 * (0.5 + Math.random() * 0.5)),
							);
							return (
								<div
									key={i}
									className="w-2 rounded-full bg-primary/80 transition-all duration-75"
									style={{ height: `${barHeight}px` }}
								/>
							);
						})}
					</div>
				)}
			</div>

			{/* Transcript output */}
			{transcript && (
				<div className="space-y-3">
					<h3 className="text-sm font-medium text-foreground">Transcript</h3>
					<div className="min-h-[80px] rounded-lg border border-border bg-secondary/30 p-4 text-sm leading-relaxed">
						{transcript}
					</div>
				</div>
			)}

			{/* Metrics */}
			{modelState.status === "result" && (
				<div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-secondary/30 p-4">
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
				</div>
			)}
		</div>
	);
}
