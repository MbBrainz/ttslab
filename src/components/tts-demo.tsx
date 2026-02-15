"use client";

import { Loader2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPlayer } from "@/components/audio-player";
import {
	addToHistory,
	GenerationHistory,
} from "@/components/generation-history";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { addRecentText, RecentTexts } from "@/components/recent-texts";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Model } from "@/lib/db/schema";
import { selectBackend } from "@/lib/inference/backend-select";
import { getLoader } from "@/lib/inference/registry";
import type { ModelLoader, Voice } from "@/lib/inference/types";

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

	const loaderRef = useRef<ModelLoader | null>(null);
	const voicesRef = useRef<Voice[]>([]);
	const backendRef = useRef<"webgpu" | "wasm">("wasm");
	const loadTimeRef = useRef(0);
	const modelReadyRef = useRef(false);
	const loadingRef = useRef(false);
	const generatingRef = useRef(false);

	// Clean up blob URL on unmount
	useEffect(() => {
		return () => {
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
			}
		};
	}, [audioUrl]);

	const voices: { id: string; name: string }[] = voicesRef.current.map((v) => ({
		id: v.id,
		name: v.name,
	}));

	const getVoiceName = useCallback((voiceId: string): string => {
		const found = voicesRef.current.find((v) => v.id === voiceId);
		return found?.name ?? voiceId;
	}, []);

	const handleDownload = useCallback(async () => {
		if (loadingRef.current) return;
		loadingRef.current = true;
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

			// Get loader voices
			if (loader.getVoices) {
				const v = loader.getVoices();
				voicesRef.current = v;
				if (v.length > 0) {
					setVoice(v[0].id);
				}
			}

			const backend = await selectBackend(
				model.supportsWebgpu ?? false,
				model.supportsWasm ?? false,
			);

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

			// Small delay to show initializing state
			await new Promise((r) => setTimeout(r, 200));

			const loadTime = Math.round(performance.now() - loadStart);

			backendRef.current = backend;
			loadTimeRef.current = loadTime;
			modelReadyRef.current = true;

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
		} finally {
			loadingRef.current = false;
		}
	}, [model.slug, model.supportsWebgpu, model.supportsWasm, model.sizeMb]);

	const handleGenerate = useCallback(async () => {
		if (generatingRef.current) return;
		const loader = loaderRef.current;
		if (!text.trim() || !loader?.synthesize) return;
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
			const result = await loader.synthesize(text, voice);

			clearInterval(timer);

			// Convert Float32Array to WAV blob URL
			const wavBlob = float32ToWav(result.audio, result.sampleRate);
			const url = URL.createObjectURL(wavBlob);

			// Revoke previous URL
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
	}, [text, voice, audioUrl, model.slug, getVoiceName]);

	const handleRetry = useCallback(() => {
		// If the model was successfully loaded, return to ready state
		if (modelReadyRef.current && loaderRef.current) {
			setModelState({
				status: "ready",
				backend: backendRef.current,
				loadTime: loadTimeRef.current,
			});
		} else {
			// Full reset for load errors
			loaderRef.current = null;
			voicesRef.current = [];
			modelReadyRef.current = false;
			setModelState({ status: "not_loaded" });
		}
	}, []);

	const handleSelectRecentText = useCallback((selected: string) => {
		setText(selected);
	}, []);

	const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
	const isReady =
		modelState.status === "ready" || modelState.status === "result";
	const canGenerate =
		isReady || (modelState.status === "error" && modelReadyRef.current);

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
					<label
						htmlFor={`tts-text-${model.slug}`}
						className="text-sm font-medium text-foreground"
					>
						Text to speak
					</label>
					<Textarea
						id={`tts-text-${model.slug}`}
						placeholder={DEFAULT_PLACEHOLDER}
						value={text}
						onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
						rows={4}
						className="resize-none"
						maxLength={MAX_TEXT_LENGTH}
					/>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							{text.length} / {MAX_TEXT_LENGTH}
						</span>
						{wordCount > 0 && <span>~{wordCount} words</span>}
					</div>
				</div>

				{voices.length > 0 && canGenerate && (
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
						>
							{voices.map((v) => (
								<SelectOption key={v.id} value={v.id}>
									{v.name}
								</SelectOption>
							))}
						</Select>
					</div>
				)}

				<Button
					onClick={handleGenerate}
					disabled={!text.trim() || !canGenerate}
					className="w-full gap-2"
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
			</div>

			{audioUrl && (
				<div className="space-y-2">
					<h3 className="text-sm font-medium text-foreground">Output</h3>
					<AudioPlayer audioUrl={audioUrl} />
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

/** Convert a Float32Array of PCM samples to a WAV Blob */
function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
	const numChannels = 1;
	const bitsPerSample = 16;
	const bytesPerSample = bitsPerSample / 8;
	const dataLength = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataLength);
	const view = new DataView(buffer);

	// RIFF header
	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + dataLength, true);
	writeString(view, 8, "WAVE");

	// fmt chunk
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true); // chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
	view.setUint16(32, numChannels * bytesPerSample, true);
	view.setUint16(34, bitsPerSample, true);

	// data chunk
	writeString(view, 36, "data");
	view.setUint32(40, dataLength, true);

	// Write PCM samples
	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(offset, clamped * 0x7fff, true);
		offset += 2;
	}

	return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
