"use client";

import { Download, Loader2, Radio, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	addToHistory,
	GenerationHistory,
} from "@/components/generation-history";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { addRecentText, RecentTexts } from "@/components/recent-texts";
import { ShareButton } from "@/components/share-button";
import { SSMLHints } from "@/components/ssml-hints";
import { TextPresets } from "@/components/text-presets";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VoiceCloneUpload } from "@/components/voice-clone-upload";
import { StreamingVisualizer } from "@/components/streaming-visualizer";
import { WaveformPlayer } from "@/components/waveform-player";
import { trackModelLoad, trackTTSGeneration } from "@/lib/analytics";
import { float32ToWav } from "@/lib/audio-utils";
import type { Model } from "@/lib/db/schema";
import { useStreamingTts } from "@/lib/hooks/use-streaming-tts";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import type { Voice } from "@/lib/inference/types";
import { getShareParams } from "@/lib/share-params";

type TtsDemoProps = {
	model: Model;
};

const DEFAULT_PLACEHOLDER = "Type or paste text here to convert to speech...";
const MAX_TEXT_LENGTH = 5000;

export function TtsDemo({ model }: TtsDemoProps) {
	const [text, setText] = useState("");
	const [voice, setVoice] = useState("default");
	const [modelState, setModelState] = useState<ModelState>({
		status: "not_loaded",
	});
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [historyKey, setHistoryKey] = useState(0);
	const [voices, setVoices] = useState<Voice[]>([]);
	const [speakerEmbeddingUrl, setSpeakerEmbeddingUrl] = useState<string | null>(null);

	const {
		loadModel,
		synthesize,
		synthesizeStream,
		cancelStream,
		extractEmbedding,
		dispose,
	} = useInferenceWorker();

	const backendRef = useRef<"webgpu" | "wasm">("wasm");
	const loadTimeRef = useRef(0);
	const modelReadyRef = useRef(false);
	const loadingRef = useRef(false);
	const generatingRef = useRef(false);

	const handleStreamAudioReady = useCallback(
		(url: string) => {
			if (audioUrl) URL.revokeObjectURL(audioUrl);
			setAudioUrl(url);

			addToHistory(model.slug, {
				id: crypto.randomUUID(),
				text: text.slice(0, 200),
				voice,
				voiceName: voices.find((v) => v.id === voice)?.name ?? voice,
				audioUrl: url,
				generationTimeMs: 0,
				backend: backendRef.current,
				timestamp: Date.now(),
			});
			setHistoryKey((k) => k + 1);
		},
		[audioUrl, model.slug, text, voice, voices],
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

	// Clean up blob URL on unmount
	useEffect(() => {
		return () => {
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
			}
		};
	}, [audioUrl]);

	// Pre-fill from share URL params on mount
	useEffect(() => {
		const params = getShareParams();
		if (params.text) setText(params.text);
		if (params.voice) setVoice(params.voice);
	}, []);

	// Add "Custom Voice" option when a speaker embedding is uploaded (SpeechT5)
	const displayVoices = useMemo(() => {
		const base = voices.map((v) => ({ id: v.id, name: v.name }));
		if (model.slug === "speecht5" && speakerEmbeddingUrl) {
			return [...base, { id: "custom", name: "Custom Voice" }];
		}
		return base;
	}, [voices, model.slug, speakerEmbeddingUrl]);

	const getVoiceName = useCallback((voiceId: string): string => {
		const found = voices.find((v) => v.id === voiceId);
		return found?.name ?? voiceId;
	}, [voices]);

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

					// When download completes, show initializing immediately
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

			backendRef.current = result.backend;
			loadTimeRef.current = result.loadTime;
			modelReadyRef.current = true;

			setVoices(result.voices);
			if (result.voices.length > 0) {
				setVoice(result.voices[0].id);
			}

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

	const handleGenerate = useCallback(async () => {
		if (generatingRef.current || !text.trim()) return;
		generatingRef.current = true;

		addRecentText(text);

		setModelState({
			status: "processing",
			elapsed: 0,
			type: "tts",
		});

		// Track elapsed time
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
			const result = await synthesize(
				model.slug,
				text,
				voice,
				speakerEmbeddingUrl ?? undefined,
			);

			clearInterval(timer);

			// Convert Float32Array to WAV blob URL
			const wavBlob = float32ToWav(result.audio, result.sampleRate);
			const url = URL.createObjectURL(wavBlob);

			// Revoke previous URL
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
			}

			setAudioUrl(url);

			const rtf =
				result.duration > 0
					? result.metrics.totalMs / 1000 / result.duration
					: undefined;

			trackTTSGeneration(
				model.slug,
				result.metrics.backend ?? backendRef.current,
				text.length,
				result.metrics.totalMs,
				rtf,
			);

			setModelState({
				status: "result",
				metrics: {
					totalMs: result.metrics.totalMs,
					audioDuration: result.duration,
					rtf,
					backend: result.metrics.backend ?? backendRef.current,
				},
			});

			// Add to generation history
			addToHistory(model.slug, {
				id: crypto.randomUUID(),
				text: text.slice(0, 200),
				voice,
				voiceName: getVoiceName(voice),
				audioUrl: url,
				generationTimeMs: result.metrics.totalMs,
				backend: result.metrics.backend ?? backendRef.current,
				timestamp: Date.now(),
			});
			setHistoryKey((k) => k + 1);
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
	}, [text, voice, audioUrl, model.slug, speakerEmbeddingUrl, synthesize, getVoiceName]);

	const handleStream = useCallback(() => {
		if (!text.trim() || isStreaming) return;
		addRecentText(text);
		startStream(text, voice, speakerEmbeddingUrl ?? undefined);
	}, [text, voice, speakerEmbeddingUrl, isStreaming, startStream]);

	const handleRetry = useCallback(() => {
		if (modelReadyRef.current) {
			setModelState({
				status: "ready",
				backend: backendRef.current,
				loadTime: loadTimeRef.current,
			});
		} else {
			dispose(model.slug);
			setVoices([]);
			modelReadyRef.current = false;
			setModelState({ status: "not_loaded" });
		}
	}, [model.slug, dispose]);

	const handleSelectRecentText = useCallback((selected: string) => {
		setText(selected);
	}, []);

	const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
	const isReady =
		modelState.status === "ready" || modelState.status === "result";
	const isProcessing = modelState.status === "processing";
	const canGenerate =
		isReady || (modelState.status === "error" && modelReadyRef.current);
	const showVoiceSelect = displayVoices.length > 0 && (canGenerate || isProcessing || isStreaming);

	return (
		<div className="space-y-6">
			<ModelStatus
				state={modelState}
				modelName={model.name}
				sizeMb={model.sizeMb}
				onDownload={handleDownload}
				onRetry={handleRetry}
			/>

			<div className="space-y-4">
				<div className="space-y-2">
					<div className="flex items-center gap-1.5">
						<label
							htmlFor={`tts-text-${model.slug}`}
							className="text-sm font-medium text-foreground"
						>
							Text to speak
						</label>
						<SSMLHints modelSlug={model.slug} />
					</div>
					<Textarea
						id={`tts-text-${model.slug}`}
						placeholder={DEFAULT_PLACEHOLDER}
						value={text}
						onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
						rows={4}
						className="resize-none"
						maxLength={MAX_TEXT_LENGTH}
						disabled={isProcessing}
					/>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							{text.length} / {MAX_TEXT_LENGTH}
						</span>
						{wordCount > 0 && <span>~{wordCount} words</span>}
					</div>
					<TextPresets onSelect={setText} disabled={isProcessing} />
				</div>

				{showVoiceSelect && (
					<div className="space-y-2">
						<label
							htmlFor={`tts-voice-${model.slug}`}
							className="text-sm font-medium text-foreground"
						>
							Voice
						</label>
						<Select
							id={`tts-voice-${model.slug}`}
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
					</div>
				)}

				{model.slug === "speecht5" && (
					<VoiceCloneUpload
						onEmbeddingReady={(url) => {
							setSpeakerEmbeddingUrl(url);
						}}
						extractEmbedding={extractEmbedding}
						disabled={!canGenerate || isProcessing}
					/>
				)}

				<div className="flex gap-2">
					<Button
						onClick={handleGenerate}
						disabled={!text.trim() || !canGenerate || isStreaming}
						className="flex-1 gap-2"
					>
						{modelState.status === "processing" ? (
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
			</div>

			{isStreaming && (
				<StreamingVisualizer analyser={analyser} isActive={isStreaming} />
			)}

			{audioUrl && (
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-medium text-foreground">Output</h3>
						<div className="flex items-center gap-1">
							<ShareButton modelSlug={model.slug} text={text} voice={voice} />
							<a
								href={audioUrl}
								download={`${model.slug}-${Date.now()}.wav`}
								className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
							>
								<Download className="h-3.5 w-3.5" />
								Download audio
							</a>
						</div>
					</div>
					<WaveformPlayer audioUrl={audioUrl} />
				</div>
			)}

			{modelState.status === "result" && (
				<div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-secondary/30 p-4">
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Generation time</p>
						<p className="text-lg font-semibold tabular-nums">
							{modelState.metrics.totalMs < 1000
								? `${modelState.metrics.totalMs}ms`
								: `${(modelState.metrics.totalMs / 1000).toFixed(2)}s`}
						</p>
					</div>
					{modelState.metrics.rtf != null && (
						<div className="text-center">
							<p className="text-xs text-muted-foreground">Real-time Factor</p>
							<p className="text-lg font-semibold tabular-nums">
								{modelState.metrics.rtf.toFixed(3)}x
							</p>
						</div>
					)}
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Backend</p>
						<p className="text-lg font-semibold uppercase">
							{modelState.metrics.backend}
						</p>
					</div>
				</div>
			)}

			<RecentTexts onSelect={handleSelectRecentText} currentText={text} />

			<GenerationHistory key={historyKey} modelSlug={model.slug} />
		</div>
	);
}
