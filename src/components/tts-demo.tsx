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
import { createDownloadTracker } from "@/lib/inference/download-tracker";
import { float32ToWav } from "@/lib/audio-utils";
import type { Model } from "@/lib/db/schema";
import { useStreamingTts } from "@/lib/hooks/use-streaming-tts";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import type { Voice } from "@/lib/inference/types";
import { getShareParams } from "@/lib/share-params";
import { cn } from "@/lib/utils";

type TtsDemoProps = {
	model: Model;
	variant?: "full" | "compact";
};

const DEFAULT_PLACEHOLDER = "Type or paste text here to convert to speech...";

export function TtsDemo({ model, variant = "full" }: TtsDemoProps) {
	const compact = variant === "compact";
	const maxTextLength = compact ? 2000 : 5000;

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

			if (!compact) {
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
			}
		},
		[audioUrl, model.slug, text, voice, voices, compact],
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

	// Pre-fill from share URL params on mount (full variant only)
	useEffect(() => {
		if (compact) return;
		const params = getShareParams();
		if (params.text) setText(params.text);
		if (params.voice) setVoice(params.voice);
	}, [compact]);

	// Add "Custom Voice" option when a speaker embedding is uploaded (SpeechT5)
	const displayVoices = useMemo(() => {
		const base = voices.map((v) => ({ id: v.id, name: v.name }));
		if (!compact && model.slug === "speecht5" && speakerEmbeddingUrl) {
			return [...base, { id: "custom", name: "Custom Voice" }];
		}
		return base;
	}, [voices, model.slug, speakerEmbeddingUrl, compact]);

	const getVoiceName = useCallback((voiceId: string): string => {
		const found = voices.find((v) => v.id === voiceId);
		return found?.name ?? voiceId;
	}, [voices]);

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

			setVoices(result.voices);
			if (result.voices.length > 0) {
				setVoice(result.voices[0].id);
			}

			if (!compact) {
				trackModelLoad(model.slug, result.backend, result.loadTime);
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
	}, [model.slug, model.sizeMb, loadModel, compact]);

	const handleGenerate = useCallback(async () => {
		if (generatingRef.current || !text.trim()) return;
		generatingRef.current = true;

		if (!compact) addRecentText(text);

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

			if (!compact) {
				trackTTSGeneration(
					model.slug,
					result.metrics.backend ?? backendRef.current,
					text.length,
					result.metrics.totalMs,
					rtf,
				);
			}

			setModelState({
				status: "result",
				metrics: {
					totalMs: result.metrics.totalMs,
					audioDuration: result.duration,
					rtf,
					backend: result.metrics.backend ?? backendRef.current,
				},
			});

			// Add to generation history (full variant only)
			if (!compact) {
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
			}
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
	}, [text, voice, audioUrl, model.slug, speakerEmbeddingUrl, synthesize, getVoiceName, compact]);

	const handleStream = useCallback(() => {
		if (!text.trim() || isStreaming) return;
		if (!compact) addRecentText(text);
		startStream(text, voice, speakerEmbeddingUrl ?? undefined);
	}, [text, voice, speakerEmbeddingUrl, isStreaming, startStream, compact]);

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
		<div className={compact ? "mx-auto max-w-lg space-y-3" : "space-y-6"}>
			<ModelStatus
				state={modelState}
				modelName={model.name}
				sizeMb={model.sizeMb}
				onDownload={handleDownload}
				onRetry={handleRetry}
			/>

			<div className={compact ? "space-y-3" : "space-y-4"}>
				<div className={compact ? undefined : "space-y-2"}>
					{!compact && (
						<div className="flex items-center gap-1.5">
							<label
								htmlFor={`tts-text-${model.slug}`}
								className="text-sm font-medium text-foreground"
							>
								Text to speak
							</label>
							<SSMLHints modelSlug={model.slug} />
						</div>
					)}
					<Textarea
						id={`tts-text-${model.slug}`}
						placeholder={compact ? "Type text to convert to speech..." : DEFAULT_PLACEHOLDER}
						value={text}
						onChange={(e) => setText(e.target.value.slice(0, maxTextLength))}
						rows={compact ? 2 : 4}
						className="resize-none"
						maxLength={maxTextLength}
						disabled={isProcessing}
					/>
					{!compact && (
						<>
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>
									{text.length} / {maxTextLength}
								</span>
								{wordCount > 0 && <span>~{wordCount} words</span>}
							</div>
							<TextPresets onSelect={setText} disabled={isProcessing} />
						</>
					)}
				</div>

				{showVoiceSelect && (
					compact ? (
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
					) : (
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
					)
				)}

				{!compact && model.slug === "speecht5" && (
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
							className="flex-1 gap-2"
						>
							<Square className="h-4 w-4" />
							Stop
						</Button>
					) : (
						<Button
							onClick={handleStream}
							disabled={!text.trim() || !canGenerate || isProcessing}
							variant="outline"
							className="flex-1 gap-2"
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
				<div className={compact ? "space-y-1" : "space-y-2"}>
					<div className="flex items-center justify-between">
						<h3 className={cn("font-medium text-foreground", compact ? "text-xs" : "text-sm")}>Output</h3>
						<div className="flex items-center gap-1">
							{!compact && <ShareButton modelSlug={model.slug} text={text} voice={voice} />}
							<a
								href={audioUrl}
								download={`${model.slug}-${Date.now()}.wav`}
								className={cn(
									"inline-flex items-center text-muted-foreground transition-colors hover:text-foreground",
									compact
										? "gap-1 text-xs"
										: "gap-1.5 rounded-md px-2.5 py-1 text-xs hover:bg-secondary",
								)}
							>
								<Download className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
								{compact ? "Download" : "Download audio"}
							</a>
						</div>
					</div>
					<WaveformPlayer audioUrl={audioUrl} />
				</div>
			)}

			{!compact && modelState.status === "result" && (
				<div className={cn(
					"grid gap-4 rounded-lg border border-border bg-secondary/30 p-4",
					modelState.metrics.ttfaMs != null ? "grid-cols-4" : "grid-cols-3",
				)}>
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Generation time</p>
						<p className="text-lg font-semibold tabular-nums">
							{modelState.metrics.totalMs < 1000
								? `${modelState.metrics.totalMs}ms`
								: `${(modelState.metrics.totalMs / 1000).toFixed(2)}s`}
						</p>
					</div>
					{modelState.metrics.ttfaMs != null && (
						<div className="text-center">
							<p className="text-xs text-muted-foreground">First audio</p>
							<p className="text-lg font-semibold tabular-nums">
								{modelState.metrics.ttfaMs < 1000
									? `${modelState.metrics.ttfaMs}ms`
									: `${(modelState.metrics.ttfaMs / 1000).toFixed(2)}s`}
							</p>
						</div>
					)}
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

			{!compact && <RecentTexts onSelect={handleSelectRecentText} currentText={text} />}

			{!compact && <GenerationHistory key={historyKey} modelSlug={model.slug} />}
		</div>
	);
}
