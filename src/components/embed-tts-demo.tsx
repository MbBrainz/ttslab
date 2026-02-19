"use client";

import { Download, Loader2, Radio, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StreamingVisualizer } from "@/components/streaming-visualizer";
import { WaveformPlayer } from "@/components/waveform-player";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { float32ToWav } from "@/lib/audio-utils";
import type { Model } from "@/lib/db/schema";
import { useStreamingTts } from "@/lib/hooks/use-streaming-tts";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import type { Voice } from "@/lib/inference/types";

type EmbedTtsDemoProps = {
	model: Model;
};

const MAX_TEXT_LENGTH = 2000;

export function EmbedTtsDemo({ model }: EmbedTtsDemoProps) {
	const [text, setText] = useState("");
	const [voice, setVoice] = useState("default");
	const [modelState, setModelState] = useState<ModelState>({
		status: "not_loaded",
	});
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [voices, setVoices] = useState<Voice[]>([]);

	const {
		loadModel,
		synthesize,
		synthesizeStream,
		cancelStream,
		dispose,
	} = useInferenceWorker();

	const backendRef = useRef<"webgpu" | "wasm">("wasm");
	const modelReadyRef = useRef(false);
	const loadingRef = useRef(false);
	const generatingRef = useRef(false);

	const handleStreamAudioReady = useCallback(
		(url: string) => {
			if (audioUrl) URL.revokeObjectURL(audioUrl);
			setAudioUrl(url);
		},
		[audioUrl],
	);

	const {
		startStream,
		stopStream,
		isStreaming,
		analyser,
	} = useStreamingTts({
		synthesizeStream,
		cancelStream,
		modelSlug: model.slug,
		backend: backendRef.current,
		setModelState,
		onAudioReady: handleStreamAudioReady,
	});

	useEffect(() => {
		return () => {
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
			}
		};
	}, [audioUrl]);

	const displayVoices = voices.map((v) => ({ id: v.id, name: v.name }));

	const handleDownload = useCallback(async () => {
		if (loadingRef.current) return;
		loadingRef.current = true;

		const estimatedBytes = (model.sizeMb ?? 0) * 1024 * 1024;
		let lastDisplayTime = 0;
		let smoothSpeed = 0;
		const fileMap = new Map<string, { loaded: number; total: number }>();

		setModelState({
			status: "downloading",
			progress: 0,
			speed: 0,
			total: estimatedBytes,
			downloaded: 0,
		});

		const loadStart = performance.now();

		try {
			const result = await loadModel(model.slug, {
				backend: "auto",
				onProgress: (progress) => {
					fileMap.set(progress.file, {
						loaded: progress.loaded,
						total: progress.total,
					});

					let downloadedBytes = 0;
					let totalBytes = 0;
					for (const fp of fileMap.values()) {
						downloadedBytes += fp.loaded;
						totalBytes += fp.total;
					}
					if (totalBytes === 0) totalBytes = estimatedBytes;

					if (downloadedBytes >= totalBytes && totalBytes > 0) {
						setModelState({ status: "initializing" });
						return;
					}

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

			backendRef.current = result.backend;
			modelReadyRef.current = true;

			setVoices(result.voices);
			if (result.voices.length > 0) {
				setVoice(result.voices[0].id);
			}

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

	const handleGenerate = useCallback(async () => {
		if (generatingRef.current || !text.trim()) return;
		generatingRef.current = true;

		setModelState({
			status: "processing",
			elapsed: 0,
			type: "tts",
		});

		const startTime = performance.now();
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
			const result = await synthesize(model.slug, text, voice);

			clearInterval(timer);

			const wavBlob = float32ToWav(result.audio, result.sampleRate);
			const url = URL.createObjectURL(wavBlob);

			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
			}

			setAudioUrl(url);

			setModelState({
				status: "result",
				metrics: {
					totalMs: result.metrics.totalMs,
					audioDuration: result.duration,
					rtf:
						result.duration > 0
							? result.metrics.totalMs / 1000 / result.duration
							: undefined,
					backend: result.metrics.backend ?? backendRef.current,
				},
			});
		} catch (err) {
			clearInterval(timer);
			setModelState({
				status: "error",
				code: "SYNTHESIS_FAILED",
				message:
					err instanceof Error ? err.message : "Failed to generate speech",
				recoverable: true,
			});
		} finally {
			generatingRef.current = false;
		}
	}, [text, voice, audioUrl, model.slug, synthesize]);

	const handleStream = useCallback(() => {
		if (!text.trim() || isStreaming) return;
		startStream(text, voice);
	}, [text, voice, isStreaming, startStream]);

	const handleRetry = useCallback(() => {
		if (modelReadyRef.current) {
			setModelState({
				status: "ready",
				backend: backendRef.current,
				loadTime: 0,
			});
		} else {
			dispose(model.slug);
			setVoices([]);
			modelReadyRef.current = false;
			setModelState({ status: "not_loaded" });
		}
	}, [model.slug, dispose]);

	const isReady =
		modelState.status === "ready" || modelState.status === "result";
	const isProcessing = modelState.status === "processing";
	const canGenerate =
		isReady || (modelState.status === "error" && modelReadyRef.current);
	const showVoiceSelect = displayVoices.length > 0 && (canGenerate || isProcessing || isStreaming);

	return (
		<div className="mx-auto max-w-lg space-y-3">
			<ModelStatus
				state={modelState}
				modelName={model.name}
				sizeMb={model.sizeMb}
				onDownload={handleDownload}
				onRetry={handleRetry}
			/>

			<Textarea
				placeholder="Type text to convert to speech..."
				value={text}
				onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
				rows={2}
				className="resize-none"
				maxLength={MAX_TEXT_LENGTH}
				disabled={isProcessing}
			/>

			{showVoiceSelect && (
				<Select
					value={voice}
					onChange={(e) => setVoice(e.target.value)}
					disabled={isProcessing}
				>
					{displayVoices.map((v) => (
						<SelectOption key={v.id} value={v.id}>
							{v.name}
						</SelectOption>
					))}
				</Select>
			)}

			<div className="flex gap-2">
				<Button
					onClick={handleGenerate}
					disabled={!text.trim() || !canGenerate || isStreaming}
					className="flex-1 gap-2"
				>
					{isProcessing ? (
						<>
							<Loader2 className="h-4 w-4 animate-spin" />
							Generating...
						</>
					) : (
						<>
							<Volume2 className="h-4 w-4" />
							Generate Speech
						</>
					)}
				</Button>
				{isStreaming ? (
					<Button
						onClick={stopStream}
						variant="destructive"
						className="gap-2"
					>
						<Square className="h-4 w-4" />
						Stop
					</Button>
				) : (
					<Button
						onClick={handleStream}
						disabled={!text.trim() || !canGenerate || isProcessing}
						variant="outline"
						className="gap-2"
					>
						<Radio className="h-4 w-4" />
						Stream
					</Button>
				)}
			</div>

			{isStreaming && (
				<StreamingVisualizer analyser={analyser} isActive={isStreaming} />
			)}

			{audioUrl && (
				<div className="space-y-1">
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-foreground">Output</span>
						<a
							href={audioUrl}
							download={`${model.slug}-${Date.now()}.wav`}
							className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>
							<Download className="h-3 w-3" />
							Download
						</a>
					</div>
					<WaveformPlayer audioUrl={audioUrl} />
				</div>
			)}
		</div>
	);
}
