"use client";

import { Download, Loader2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { WaveformPlayer } from "@/components/waveform-player";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { float32ToWav } from "@/lib/audio-utils";
import type { Model } from "@/lib/db/schema";
import { selectBackend } from "@/lib/inference/backend-select";
import { getLoader } from "@/lib/inference/registry";
import type { ModelLoader, Voice } from "@/lib/inference/types";

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

	const loaderRef = useRef<ModelLoader | null>(null);
	const voicesRef = useRef<Voice[]>([]);
	const backendRef = useRef<"webgpu" | "wasm">("wasm");
	const modelReadyRef = useRef(false);
	const loadingRef = useRef(false);
	const generatingRef = useRef(false);

	useEffect(() => {
		return () => {
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl);
			}
		};
	}, [audioUrl]);

	const voices: { id: string; name: string }[] = voicesRef.current.map(
		(v) => ({
			id: v.id,
			name: v.name,
		}),
	);

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

			if (loader.getVoices) {
				const v = loader.getVoices();
				voicesRef.current = v;
				if (v.length > 0) {
					setVoice(v[0].id);
				}
			}

			const loaderBackends = loader.getSupportedBackends?.() ?? ["wasm"];
			const preferred = loader.getPreferredBackend?.() ?? "auto";
			const backend = await selectBackend(
				loaderBackends.includes("webgpu"),
				loaderBackends.includes("wasm"),
				preferred,
			);

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

			await loader.load({
				backend,
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

			backendRef.current = backend;
			modelReadyRef.current = true;

			setModelState({
				status: "ready",
				backend,
				loadTime: Math.round(performance.now() - loadStart),
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
	}, [model.slug, model.sizeMb]);

	const handleGenerate = useCallback(async () => {
		if (generatingRef.current) return;
		const loader = loaderRef.current;
		if (!text.trim() || !loader?.synthesize) return;
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
			const result = await loader.synthesize(text, voice);

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
	}, [text, voice, audioUrl]);

	const handleRetry = useCallback(() => {
		if (modelReadyRef.current && loaderRef.current) {
			setModelState({
				status: "ready",
				backend: backendRef.current,
				loadTime: 0,
			});
		} else {
			loaderRef.current = null;
			voicesRef.current = [];
			modelReadyRef.current = false;
			setModelState({ status: "not_loaded" });
		}
	}, []);

	const isReady =
		modelState.status === "ready" || modelState.status === "result";
	const isProcessing = modelState.status === "processing";
	const canGenerate =
		isReady || (modelState.status === "error" && modelReadyRef.current);
	const showVoiceSelect = voices.length > 0 && (canGenerate || isProcessing);

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
					{voices.map((v) => (
						<SelectOption key={v.id} value={v.id}>
							{v.name}
						</SelectOption>
					))}
				</Select>
			)}

			<Button
				onClick={handleGenerate}
				disabled={!text.trim() || !canGenerate}
				className="w-full gap-2"
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
