"use client";

import { Loader2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { RecentTexts, addRecentText } from "@/components/recent-texts";
import { ShareButton } from "@/components/share-button";
import { TextPresets } from "@/components/text-presets";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WaveformPlayer } from "@/components/waveform-player";
import { float32ToWav } from "@/lib/audio-utils";
import type { Model } from "@/lib/db/schema";
import { selectBackend } from "@/lib/inference/backend-select";
import { getLoader } from "@/lib/inference/registry";
import type { ModelLoader, Voice } from "@/lib/inference/types";
import { getShareParams } from "@/lib/share-params";

type TtsCompareProps = {
	modelA: Model;
	modelB: Model;
	comparisonSlug?: string;
};

const DEFAULT_PLACEHOLDER =
	"Type or paste text here to compare both models...";
const MAX_TEXT_LENGTH = 5000;

type PanelState = {
	modelState: ModelState;
	audioUrl: string | null;
	voice: string;
	voices: Voice[];
	generating: boolean;
};

function createInitialPanel(): PanelState {
	return {
		modelState: { status: "not_loaded" },
		audioUrl: null,
		voice: "default",
		voices: [],
		generating: false,
	};
}

export function TtsCompare({ modelA, modelB, comparisonSlug }: TtsCompareProps) {
	const [text, setText] = useState("");
	const [panelA, setPanelA] = useState<PanelState>(createInitialPanel);
	const [panelB, setPanelB] = useState<PanelState>(createInitialPanel);

	// Pre-fill from share URL params on mount
	useEffect(() => {
		const params = getShareParams();
		if (params.text) setText(params.text);
	}, []);

	// Refs for mutable state that shouldn't trigger re-renders
	const loaderARef = useRef<ModelLoader | null>(null);
	const loaderBRef = useRef<ModelLoader | null>(null);
	const backendARef = useRef<"webgpu" | "wasm">("wasm");
	const backendBRef = useRef<"webgpu" | "wasm">("wasm");
	const loadTimeARef = useRef(0);
	const loadTimeBRef = useRef(0);
	const modelReadyARef = useRef(false);
	const modelReadyBRef = useRef(false);
	const loadingARef = useRef(false);
	const loadingBRef = useRef(false);
	const generatingARef = useRef(false);
	const generatingBRef = useRef(false);

	// Track latest audio URLs in refs for cleanup on unmount
	const audioUrlARef = useRef<string | null>(null);
	const audioUrlBRef = useRef<string | null>(null);
	audioUrlARef.current = panelA.audioUrl;
	audioUrlBRef.current = panelB.audioUrl;

	useEffect(() => {
		return () => {
			if (audioUrlARef.current) URL.revokeObjectURL(audioUrlARef.current);
			if (audioUrlBRef.current) URL.revokeObjectURL(audioUrlBRef.current);
		};
	}, []);

	const handleDownloadA = useCallback(async () => {
		if (loadingARef.current) return;
		loadingARef.current = true;
		try {
			const loader = await getLoader(modelA.slug);
			if (!loader) {
				setPanelA((p) => ({
					...p,
					modelState: {
						status: "error",
						code: "LOADER_NOT_FOUND",
						message: `No loader registered for ${modelA.slug}`,
						recoverable: false,
					},
				}));
				return;
			}
			loaderARef.current = loader;

			if (loader.getVoices) {
				const v = loader.getVoices();
				setPanelA((p) => ({
					...p,
					voices: v,
					voice: v.length > 0 ? v[0].id : "default",
				}));
			}

			const loaderBackends = loader.getSupportedBackends?.() ?? ["wasm"];
			const backend = await selectBackend(
				loaderBackends.includes("webgpu"),
				loaderBackends.includes("wasm"),
			);

			const estimatedBytesA = (modelA.sizeMb ?? 0) * 1024 * 1024;
			let lastDisplayTime = 0;
			let smoothSpeed = 0;
			const fileMap = new Map<string, { loaded: number; total: number }>();

			setPanelA((p) => ({
				...p,
				modelState: {
					status: "downloading",
					progress: 0,
					speed: 0,
					total: estimatedBytesA,
					downloaded: 0,
				},
			}));

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
					if (totalBytes === 0) totalBytes = estimatedBytesA;

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

					setPanelA((p) => ({
						...p,
						modelState: {
							status: "downloading",
							progress: pct,
							speed: smoothSpeed,
							total: totalBytes,
							downloaded: downloadedBytes,
						},
					}));
				},
			});

			setPanelA((p) => ({ ...p, modelState: { status: "initializing" } }));
			await new Promise((r) => setTimeout(r, 200));

			const loadTime = Math.round(performance.now() - loadStart);
			backendARef.current = backend;
			loadTimeARef.current = loadTime;
			modelReadyARef.current = true;

			setPanelA((p) => ({
				...p,
				modelState: { status: "ready", backend, loadTime },
			}));
		} catch (err) {
			setPanelA((p) => ({
				...p,
				modelState: {
					status: "error",
					code: "LOAD_FAILED",
					message:
						err instanceof Error ? err.message : "Failed to load model",
					recoverable: true,
				},
			}));
		} finally {
			loadingARef.current = false;
		}
	}, [modelA.slug, modelA.supportsWebgpu, modelA.supportsWasm, modelA.sizeMb]);

	const handleDownloadB = useCallback(async () => {
		if (loadingBRef.current) return;
		loadingBRef.current = true;
		try {
			const loader = await getLoader(modelB.slug);
			if (!loader) {
				setPanelB((p) => ({
					...p,
					modelState: {
						status: "error",
						code: "LOADER_NOT_FOUND",
						message: `No loader registered for ${modelB.slug}`,
						recoverable: false,
					},
				}));
				return;
			}
			loaderBRef.current = loader;

			if (loader.getVoices) {
				const v = loader.getVoices();
				setPanelB((p) => ({
					...p,
					voices: v,
					voice: v.length > 0 ? v[0].id : "default",
				}));
			}

			const loaderBackends = loader.getSupportedBackends?.() ?? ["wasm"];
			const backend = await selectBackend(
				loaderBackends.includes("webgpu"),
				loaderBackends.includes("wasm"),
			);

			const estimatedBytesB = (modelB.sizeMb ?? 0) * 1024 * 1024;
			let lastDisplayTime = 0;
			let smoothSpeed = 0;
			const fileMap = new Map<string, { loaded: number; total: number }>();

			setPanelB((p) => ({
				...p,
				modelState: {
					status: "downloading",
					progress: 0,
					speed: 0,
					total: estimatedBytesB,
					downloaded: 0,
				},
			}));

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
					if (totalBytes === 0) totalBytes = estimatedBytesB;

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

					setPanelB((p) => ({
						...p,
						modelState: {
							status: "downloading",
							progress: pct,
							speed: smoothSpeed,
							total: totalBytes,
							downloaded: downloadedBytes,
						},
					}));
				},
			});

			setPanelB((p) => ({ ...p, modelState: { status: "initializing" } }));
			await new Promise((r) => setTimeout(r, 200));

			const loadTime = Math.round(performance.now() - loadStart);
			backendBRef.current = backend;
			loadTimeBRef.current = loadTime;
			modelReadyBRef.current = true;

			setPanelB((p) => ({
				...p,
				modelState: { status: "ready", backend, loadTime },
			}));
		} catch (err) {
			setPanelB((p) => ({
				...p,
				modelState: {
					status: "error",
					code: "LOAD_FAILED",
					message:
						err instanceof Error ? err.message : "Failed to load model",
					recoverable: true,
				},
			}));
		} finally {
			loadingBRef.current = false;
		}
	}, [modelB.slug, modelB.supportsWebgpu, modelB.supportsWasm, modelB.sizeMb]);

	const handleRetryA = useCallback(() => {
		if (modelReadyARef.current && loaderARef.current) {
			setPanelA((p) => ({
				...p,
				modelState: {
					status: "ready",
					backend: backendARef.current,
					loadTime: loadTimeARef.current,
				},
			}));
		} else {
			loaderARef.current = null;
			modelReadyARef.current = false;
			setPanelA((p) => ({
				...p,
				voices: [],
				modelState: { status: "not_loaded" },
			}));
		}
	}, []);

	const handleRetryB = useCallback(() => {
		if (modelReadyBRef.current && loaderBRef.current) {
			setPanelB((p) => ({
				...p,
				modelState: {
					status: "ready",
					backend: backendBRef.current,
					loadTime: loadTimeBRef.current,
				},
			}));
		} else {
			loaderBRef.current = null;
			modelReadyBRef.current = false;
			setPanelB((p) => ({
				...p,
				voices: [],
				modelState: { status: "not_loaded" },
			}));
		}
	}, []);

	const generateForModel = useCallback(
		async (
			panel: "A" | "B",
			textToSpeak: string,
		) => {
			const loaderRef = panel === "A" ? loaderARef : loaderBRef;
			const generatingRef = panel === "A" ? generatingARef : generatingBRef;
			const backendRef = panel === "A" ? backendARef : backendBRef;
			const setPanel = panel === "A" ? setPanelA : setPanelB;

			if (generatingRef.current) return;
			const loader = loaderRef.current;
			if (!loader?.synthesize) return;
			generatingRef.current = true;

			// Read current voice from state
			let currentVoice = "default";
			setPanel((p) => {
				currentVoice = p.voice;
				return p;
			});

			// Resolve "default" to the first available voice from the loader
			if (currentVoice === "default" && loader.getVoices) {
				const voices = loader.getVoices();
				if (voices.length > 0) {
					currentVoice = voices[0].id;
				}
			}

			setPanel((p) => ({
				...p,
				generating: true,
				modelState: { status: "processing", elapsed: 0, type: "tts" },
			}));

			const startTime = performance.now();
			const timer = setInterval(() => {
				setPanel((p) => {
					if (p.modelState.status !== "processing") return p;
					return {
						...p,
						modelState: {
							...p.modelState,
							elapsed: Math.round(performance.now() - startTime),
						},
					};
				});
			}, 100);

			try {
				const result = await loader.synthesize(textToSpeak, currentVoice);
				clearInterval(timer);

				const wavBlob = float32ToWav(result.audio, result.sampleRate);
				const url = URL.createObjectURL(wavBlob);

				setPanel((p) => {
					if (p.audioUrl) URL.revokeObjectURL(p.audioUrl);
					return {
						...p,
						generating: false,
						audioUrl: url,
						modelState: {
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
						},
					};
				});
			} catch (err) {
				clearInterval(timer);
				setPanel((p) => ({
					...p,
					generating: false,
					modelState: {
						status: "error",
						code: "SYNTHESIS_FAILED",
						message:
							err instanceof Error
								? err.message
								: "Failed to generate speech",
						recoverable: true,
					},
				}));
			} finally {
				generatingRef.current = false;
			}
		},
		[],
	);

	const handleGenerate = useCallback(async () => {
		if (!text.trim()) return;
		addRecentText(text);

		// Generate for both models in parallel
		await Promise.allSettled([
			generateForModel("A", text),
			generateForModel("B", text),
		]);
	}, [text, generateForModel]);

	const handleSelectRecentText = useCallback((selected: string) => {
		setText(selected);
	}, []);

	const isReadyOrResult = (state: ModelState) =>
		state.status === "ready" || state.status === "result";
	const canGenerateModel = (state: ModelState, modelReady: boolean) =>
		isReadyOrResult(state) ||
		(state.status === "error" && modelReady);

	const bothCanGenerate =
		canGenerateModel(panelA.modelState, modelReadyARef.current) &&
		canGenerateModel(panelB.modelState, modelReadyBRef.current);
	const eitherGenerating = panelA.generating || panelB.generating;

	const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

	const voicesA = panelA.voices.map((v) => ({ id: v.id, name: v.name }));
	const voicesB = panelB.voices.map((v) => ({ id: v.id, name: v.name }));
	const showVoiceA =
		voicesA.length > 0 &&
		(canGenerateModel(panelA.modelState, modelReadyARef.current) ||
			panelA.modelState.status === "processing");
	const showVoiceB =
		voicesB.length > 0 &&
		(canGenerateModel(panelB.modelState, modelReadyBRef.current) ||
			panelB.modelState.status === "processing");

	return (
		<div className="space-y-6">
			{/* Shared text input */}
			<div className="space-y-2">
				<label
					htmlFor="tts-compare-text"
					className="text-sm font-medium text-foreground"
				>
					Text to speak
				</label>
				<Textarea
					id="tts-compare-text"
					placeholder={DEFAULT_PLACEHOLDER}
					value={text}
					onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
					rows={4}
					className="resize-none"
					maxLength={MAX_TEXT_LENGTH}
					disabled={eitherGenerating}
				/>
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>
						{text.length} / {MAX_TEXT_LENGTH}
					</span>
					<div className="flex items-center gap-2">
						<span>{wordCount > 0 ? `~${wordCount} words` : "\u00A0"}</span>
						{text.trim() && (
							<ShareButton
								modelSlug={modelA.slug}
								text={text}
								comparisonSlug={comparisonSlug}
							/>
						)}
					</div>
				</div>
				<TextPresets onSelect={setText} disabled={eitherGenerating} />
			</div>

			{/* Two model panels side by side */}
			<div className="grid gap-6 md:grid-cols-2">
				{/* Model A Panel */}
				<div className="space-y-4">
					<ModelStatus
						state={panelA.modelState}
						modelName={modelA.name}
						sizeMb={modelA.sizeMb}
						onDownload={handleDownloadA}
						onRetry={handleRetryA}
					/>
					{showVoiceA && (
						<div className="space-y-2">
							<label
								htmlFor="tts-compare-voice-a"
								className="text-sm font-medium text-foreground"
							>
								Voice
							</label>
							<Select
								id="tts-compare-voice-a"
								value={panelA.voice}
								onChange={(e) =>
									setPanelA((p) => ({ ...p, voice: e.target.value }))
								}
								disabled={panelA.generating}
							>
								{voicesA.map((v) => (
									<SelectOption key={v.id} value={v.id}>
										{v.name}
									</SelectOption>
								))}
							</Select>
						</div>
					)}
					{panelA.audioUrl && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium text-foreground">Output</h4>
							<WaveformPlayer audioUrl={panelA.audioUrl} />
						</div>
					)}
					{panelA.modelState.status === "result" && (
						<div className="flex flex-wrap justify-center gap-6 rounded-lg border border-border bg-secondary/30 p-4">
							<div className="text-center">
								<p className="text-xs text-muted-foreground">Generation time</p>
								<p className="text-lg font-semibold tabular-nums">
									{panelA.modelState.metrics.totalMs < 1000
										? `${panelA.modelState.metrics.totalMs}ms`
										: `${(panelA.modelState.metrics.totalMs / 1000).toFixed(2)}s`}
								</p>
							</div>
							{panelA.modelState.metrics.rtf != null && (
								<div className="text-center">
									<p className="text-xs text-muted-foreground">
										Real-time Factor
									</p>
									<p className="text-lg font-semibold tabular-nums">
										{panelA.modelState.metrics.rtf.toFixed(3)}x
									</p>
								</div>
							)}
							<div className="text-center">
								<p className="text-xs text-muted-foreground">Backend</p>
								<p className="text-lg font-semibold uppercase">
									{panelA.modelState.metrics.backend}
								</p>
							</div>
						</div>
					)}
				</div>

				{/* Model B Panel */}
				<div className="space-y-4">
					<ModelStatus
						state={panelB.modelState}
						modelName={modelB.name}
						sizeMb={modelB.sizeMb}
						onDownload={handleDownloadB}
						onRetry={handleRetryB}
					/>
					{showVoiceB && (
						<div className="space-y-2">
							<label
								htmlFor="tts-compare-voice-b"
								className="text-sm font-medium text-foreground"
							>
								Voice
							</label>
							<Select
								id="tts-compare-voice-b"
								value={panelB.voice}
								onChange={(e) =>
									setPanelB((p) => ({ ...p, voice: e.target.value }))
								}
								disabled={panelB.generating}
							>
								{voicesB.map((v) => (
									<SelectOption key={v.id} value={v.id}>
										{v.name}
									</SelectOption>
								))}
							</Select>
						</div>
					)}
					{panelB.audioUrl && (
						<div className="space-y-2">
							<h4 className="text-sm font-medium text-foreground">Output</h4>
							<WaveformPlayer audioUrl={panelB.audioUrl} />
						</div>
					)}
					{panelB.modelState.status === "result" && (
						<div className="flex flex-wrap justify-center gap-6 rounded-lg border border-border bg-secondary/30 p-4">
							<div className="text-center">
								<p className="text-xs text-muted-foreground">Generation time</p>
								<p className="text-lg font-semibold tabular-nums">
									{panelB.modelState.metrics.totalMs < 1000
										? `${panelB.modelState.metrics.totalMs}ms`
										: `${(panelB.modelState.metrics.totalMs / 1000).toFixed(2)}s`}
								</p>
							</div>
							{panelB.modelState.metrics.rtf != null && (
								<div className="text-center">
									<p className="text-xs text-muted-foreground">
										Real-time Factor
									</p>
									<p className="text-lg font-semibold tabular-nums">
										{panelB.modelState.metrics.rtf.toFixed(3)}x
									</p>
								</div>
							)}
							<div className="text-center">
								<p className="text-xs text-muted-foreground">Backend</p>
								<p className="text-lg font-semibold uppercase">
									{panelB.modelState.metrics.backend}
								</p>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Shared generate button */}
			<div className="space-y-2">
				<Button
					onClick={handleGenerate}
					disabled={!text.trim() || !bothCanGenerate || eitherGenerating}
					className="w-full gap-2"
				>
					{eitherGenerating ? (
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
				{!bothCanGenerate && !eitherGenerating && (
					<p className="text-center text-xs text-muted-foreground">
						Download both models to compare
					</p>
				)}
			</div>

			<RecentTexts onSelect={handleSelectRecentText} currentText={text} />
		</div>
	);
}

