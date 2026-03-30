"use client";

import { Download, Loader2, Radio, Square, Volume2 } from "lucide-react";
import { GpuEstimate } from "@/components/gpu-estimate";
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
import { getLanguageName } from "@/lib/inference/language-names";
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
	const [backend, setBackend] = useState<"auto" | "webgpu" | "wasm">("auto");
	const [modelState, setModelState] = useState<ModelState>({
		status: "not_loaded",
	});
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [historyKey, setHistoryKey] = useState(0);
	const [voices, setVoices] = useState<Voice[]>([]);
	const [languages, setLanguages] = useState<string[]>([]);
	const [language, setLanguage] = useState("en");
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
				backend,
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

			if (result.languages.length > 0) {
				setLanguages(result.languages);
				setLanguage(result.languages.includes("en") ? "en" : result.languages[0]);
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
	}, [model.slug, model.sizeMb, loadModel, compact, backend]);

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
				undefined,
				languages.length > 1 ? language : undefined,
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
	}, [text, voice, audioUrl, model.slug, speakerEmbeddingUrl, synthesize, getVoiceName, compact, language, languages]);

	const handleStream = useCallback(() => {
		if (!text.trim() || isStreaming) return;
		if (!compact) addRecentText(text);
		startStream(text, voice, speakerEmbeddingUrl ?? undefined, languages.length > 1 ? language : undefined);
	}, [text, voice, speakerEmbeddingUrl, isStreaming, startStream, compact, language, languages]);

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
	const showLanguageSelect = languages.length > 1 && (canGenerate || isProcessing || isStreaming);
	const showBackendSelect = !compact && model.supportsWebgpu && model.supportsWasm && modelState.status === "not_loaded";

	return (
		<div className={compact ? "mx-auto max-w-lg space-y-3" : "space-y-6"}>
			<ModelStatus
				state={modelState}
				modelName={model.name}
				sizeMb={model.sizeMb}
				onDownload={handleDownload}
				onRetry={handleRetry}
			/>

			{showBackendSelect && (
				<div className="space-y-2">
					<label
						htmlFor={`tts-backend-${model.slug}`}
						className="text-sm font-medium text-foreground"
					>
						Backend
					</label>
					<Select
						id={`tts-backend-${model.slug}`}
						value={backend}
						onChange={(e) => setBackend(e.target.value as "auto" | "webgpu" | "wasm")}
					>
						<SelectOption value="auto">Auto (recommended)</SelectOption>
						<SelectOption value="webgpu">WebGPU</SelectOption>
						<SelectOption value="wasm">WASM</SelectOption>
					</Select>
					<p className="text-xs text-muted-foreground">
						WebGPU uses your GPU for faster inference. WASM is the reliable fallback.
					</p>
				</div>
			)}

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
							<TextPresets onSelect={setText} disabled={isProcessing} modelSlug={model.slug} />
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

				{showLanguageSelect && (
					compact ? (
						<Select
							value={language}
							onChange={(e) => setLanguage(e.target.value)}
							disabled={isProcessing}
						>
							{languages.map((code) => (
								<SelectOption key={code} value={code}>
									{getLanguageName(code)}
								</SelectOption>
							))}
						</Select>
					) : (
						<div className="space-y-2">
							<label
								htmlFor={`tts-language-${model.slug}`}
								className="text-sm font-medium text-foreground"
							>
								Language
							</label>
							<Select
								id={`tts-language-${model.slug}`}
								value={language}
								onChange={(e) => setLanguage(e.target.value)}
								disabled={isProcessing}
							>
								{languages.map((code) => (
									<SelectOption key={code} value={code}>
										{getLanguageName(code)}
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

			{!compact && modelState.status === "result" && (() => {
				const m = modelState.metrics;
				const cols = 2 + (m.ttfaMs != null ? 1 : 0) + (m.rtf != null ? 1 : 0) + (m.backend === "wasm" ? 1 : 0);
				return (
					<div className={cn(
						"grid gap-4 rounded-lg border border-border bg-secondary/30 p-4",
						cols <= 3 ? "grid-cols-3" : cols === 4 ? "grid-cols-4" : "grid-cols-5",
					)}>
						<div className="text-center">
							<p className="text-xs text-muted-foreground">Generation time</p>
							<p className="text-lg font-semibold tabular-nums">
								{m.totalMs < 1000
									? `${m.totalMs}ms`
									: `${(m.totalMs / 1000).toFixed(2)}s`}
							</p>
						</div>
						{m.ttfaMs != null && (
							<div className="text-center">
								<p className="text-xs text-muted-foreground">First audio</p>
								<p className="text-lg font-semibold tabular-nums">
									{m.ttfaMs < 1000
										? `${m.ttfaMs}ms`
										: `${(m.ttfaMs / 1000).toFixed(2)}s`}
								</p>
							</div>
						)}
						{m.rtf != null && (
							<div className="text-center">
								<p className="text-xs text-muted-foreground">Real-time Factor</p>
								<p className="text-lg font-semibold tabular-nums">
									{m.rtf.toFixed(3)}x
								</p>
							</div>
						)}
						<div className="text-center">
							<p className="text-xs text-muted-foreground">Backend</p>
							<p className="text-lg font-semibold uppercase">
								{m.backend}
							</p>
						</div>
						<GpuEstimate totalMs={m.totalMs} backend={m.backend} />
					</div>
				);
			})()}

			{!compact && <RecentTexts onSelect={handleSelectRecentText} currentText={text} />}

			{!compact && <GenerationHistory key={historyKey} modelSlug={model.slug} />}
		</div>
	);
}
