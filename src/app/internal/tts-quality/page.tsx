"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import {
	runQualityTests,
	SUPPORTED_TTS_MODELS,
	type ProgressUpdate,
	type InferenceWorkerAPI,
} from "@/lib/testing/tts-quality-runner";
import { encodeWavBase64 } from "@/lib/audio-qa/wav";
import type {
	QualityReport,
	TestConfig,
	TestVariant,
} from "@/lib/testing/types";

// ── Types ────────────────────────────────────────────────────────────

type Status = "idle" | "running" | "complete";

/** The surface `scripts/model-qa.mjs` drives. */
interface ModelQaApi {
	listModels: () => string[];
	run: (config?: TestConfig) => Promise<QualityReport[]>;
	/**
	 * Capture from the microphone and extract a speaker embedding, returning a
	 * blob URL usable as `TestVariant.speakerEmbeddingUrl`.
	 *
	 * This exists because the SpeechT5 cloning defect is reported as
	 * SOURCE-DEPENDENT: a mic-captured reference triggers it worse than an
	 * uploaded WAV, because capture applies the browser's AGC and noise
	 * suppression and pushes the resulting x-vector further out of the
	 * distribution SpeechT5 was trained on. Cloning from a file therefore tests
	 * a milder configuration than the one the bug was reported under.
	 *
	 * Under automation the mic is Chrome's fake device fed a real WAV via
	 * --use-file-for-fake-audio-capture, so the getUserMedia processing chain is
	 * genuinely exercised.
	 */
	captureMicEmbedding: (seconds: number) => Promise<string>;
}

declare global {
	interface Window {
		__modelQA?: ModelQaApi;
		/** Installed by the driver via page.exposeFunction. */
		__qaEmitReport?: (report: QualityReport) => Promise<void>;
		/** Installed by the driver via page.exposeFunction. */
		__qaEmitAudio?: (
			meta: {
				slug: string;
				variant: string;
				phraseIndex: number;
				sampleRate: number;
			},
			wavBase64: string,
		) => Promise<void>;
	}
}

const VERDICT_COLORS = {
	pass: "text-green-400",
	warn: "text-yellow-400",
	fail: "text-red-400",
} as const;

const VERDICT_BG = {
	pass: "bg-green-900/30",
	warn: "bg-yellow-900/30",
	fail: "bg-red-900/30",
} as const;

// ── Helpers ──────────────────────────────────────────────────────────

function formatMs(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatWer(wer: number): string {
	return `${(wer * 100).toFixed(1)}%`;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
}

/**
 * Median + max, never mean. WER is word-weighted, so one garbage phrase in a
 * long run moves a mean by a couple of points and hides the failure entirely.
 */
function werSummary(report: QualityReport): string {
	if (report.tests.length === 0) return "-";
	const wers = report.tests.map((t) => t.sttRoundTrip.wer);
	return `${formatWer(median(wers))} / ${formatWer(Math.max(...wers))}`;
}

/** Max I/N — the non-termination signal. Unbounded, so it can read > 100%. */
function insertionSummary(report: QualityReport): string {
	if (report.tests.length === 0) return "-";
	return formatWer(
		Math.max(...report.tests.map((t) => t.sttRoundTrip.insertionRate)),
	);
}

/** Worst cepstral ratio — the repeat/overlap signal. */
function cepstralSummary(report: QualityReport): string {
	if (report.tests.length === 0) return "-";
	return Math.max(...report.tests.map((t) => t.qa.cepstral.ratio)).toFixed(0);
}

/** "echo x2, wer x1" — which checks actually gated this model. */
function summarizeFailures(report: QualityReport): string {
	const counts = new Map<string, number>();
	for (const test of report.tests) {
		for (const f of test.failures) {
			counts.set(f.check, (counts.get(f.check) ?? 0) + 1);
		}
	}
	if (counts.size === 0) return "-";
	return [...counts.entries()].map(([check, n]) => `${check} x${n}`).join(", ");
}

function buildWorkerAdapter(
	hook: ReturnType<typeof useInferenceWorker>,
): InferenceWorkerAPI {
	return {
		loadModel: hook.loadModel,
		synthesize: hook.synthesize,
		synthesizeStream: hook.synthesizeStream,
		// Without this a timed-out stream is abandoned rather than cancelled,
		// and keeps generating while the next model loads.
		cancelStream: hook.cancelStream,
		transcribe: hook.transcribe,
		disposeModel: hook.dispose,
	};
}

/**
 * Record `seconds` of microphone audio and return it as mono PCM.
 *
 * Deliberately goes through getUserMedia rather than decoding a file: the
 * capture chain (AGC, noise suppression, resampling) is exactly what makes a
 * mic-cloned embedding differ from a file-cloned one.
 */
async function recordMicPcm(
	seconds: number,
): Promise<{ pcm: Float32Array; sampleRate: number }> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	try {
		const context = new AudioContext();
		try {
			const source = context.createMediaStreamSource(stream);
			const chunks: Float32Array[] = [];
			// ScriptProcessor is deprecated but needs no module loading, which
			// keeps this self-contained inside a page that is already client-only.
			const processor = context.createScriptProcessor(4096, 1, 1);
			processor.onaudioprocess = (event) => {
				chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
			};
			source.connect(processor);
			processor.connect(context.destination);

			await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

			processor.disconnect();
			source.disconnect();

			const total = chunks.reduce((sum, c) => sum + c.length, 0);
			const pcm = new Float32Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				pcm.set(chunk, offset);
				offset += chunk.length;
			}
			return { pcm, sampleRate: context.sampleRate };
		} finally {
			await context.close();
		}
	} finally {
		// Always release the mic, or a failed run leaves the device hot.
		for (const track of stream.getTracks()) track.stop();
	}
}

/** Cross the coverage matrix: {stock, cloned} x {non-streaming, streaming}. */
function buildVariants(
	embeddingUrl: string,
	includeStreaming: boolean,
): TestVariant[] {
	const voices: Array<{ label: string; speakerEmbeddingUrl?: string }> = [
		{ label: "stock" },
	];
	if (embeddingUrl.trim()) {
		voices.push({ label: "cloned", speakerEmbeddingUrl: embeddingUrl.trim() });
	}

	const modes = includeStreaming ? [false, true] : [false];

	return voices.flatMap((voice) =>
		modes.map((streaming) => ({
			id: `${voice.label}/${streaming ? "streaming" : "non-streaming"}`,
			speakerEmbeddingUrl: voice.speakerEmbeddingUrl,
			streaming,
		})),
	);
}

// ── Progress Bar ─────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;
	return (
		<div className="h-2 w-full rounded-full bg-zinc-800">
			<div
				className="h-2 rounded-full bg-blue-500 transition-all"
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}

// ── Model Result Row ─────────────────────────────────────────────────

function ModelResultRow({ report }: { report: QualityReport }) {
	return (
		<tr
			data-testid={`model-result-${report.slug}-${report.variant}`}
			className={VERDICT_BG[report.overall]}
		>
			<td className="px-3 py-2 font-mono text-sm">{report.slug}</td>
			<td className="px-3 py-2 font-mono text-xs text-zinc-400">
				{report.variant}
			</td>
			<td className={`px-3 py-2 font-bold ${VERDICT_COLORS[report.overall]}`}>
				{report.overall.toUpperCase()}
			</td>
			<td className="px-3 py-2 text-sm">{report.backend}</td>
			<td className="px-3 py-2 text-sm tabular-nums">
				{formatMs(report.loadTimeMs)}
			</td>
			<td className="px-3 py-2 text-sm tabular-nums">{werSummary(report)}</td>
			<td className="px-3 py-2 text-sm tabular-nums">
				{insertionSummary(report)}
			</td>
			<td className="px-3 py-2 text-sm tabular-nums">
				{cepstralSummary(report)}
			</td>
			<td className="px-3 py-2 text-sm tabular-nums">{report.tests.length}</td>
			<td
				data-testid={`failed-checks-${report.slug}-${report.variant}`}
				className="px-3 py-2 font-mono text-sm text-yellow-400"
			>
				{summarizeFailures(report)}
			</td>
			<td className="px-3 py-2 text-sm text-red-400">
				{report.errors.length > 0 ? report.errors.join("; ") : "-"}
			</td>
		</tr>
	);
}

// ── Main Page ────────────────────────────────────────────────────────

export default function TtsQualityPage() {
	const worker = useInferenceWorker();

	const [status, setStatus] = useState<Status>("idle");
	const [progress, setProgress] = useState<ProgressUpdate | null>(null);
	const [reports, setReports] = useState<QualityReport[]>([]);
	const [modelFilter, setModelFilter] = useState("");
	const [embeddingUrl, setEmbeddingUrl] = useState("");
	const [includeStreaming, setIncludeStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const runningRef = useRef(false);

	const workerAdapter = useMemo(() => buildWorkerAdapter(worker), [worker]);

	const buildConfig = useCallback((): TestConfig => {
		const models = modelFilter
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		return {
			...(models.length > 0 ? { models } : {}),
			variants: buildVariants(embeddingUrl, includeStreaming),
		};
	}, [modelFilter, embeddingUrl, includeStreaming]);

	const handleRun = useCallback(async () => {
		if (runningRef.current) return;
		runningRef.current = true;

		setStatus("running");
		setReports([]);
		setError(null);
		setProgress(null);

		try {
			const config = buildConfig();
			const results = await runQualityTests(workerAdapter, config, {
				onProgress: setProgress,
			});
			setReports(results);
			setStatus("complete");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("complete");
		} finally {
			runningRef.current = false;
		}
	}, [workerAdapter, buildConfig]);

	// ── Automation hook ──────────────────────────────────────────────
	// Without this the page is button-driven only and any automation has to
	// scrape the DOM for results. `run` returns the reports directly.
	//
	// If the driver has installed window.__qaEmitAudio, every generated buffer
	// is streamed out as a base64 WAV as it is produced — so a run that dies
	// halfway still leaves listenable artifacts for the cases that completed.
	useEffect(() => {
		const api: ModelQaApi = {
			listModels: () => [...SUPPORTED_TTS_MODELS],
			captureMicEmbedding: async (seconds) => {
				const { pcm, sampleRate } = await recordMicPcm(seconds);
				if (pcm.length === 0) {
					throw new Error("Microphone produced no audio");
				}
				let peak = 0;
				for (let i = 0; i < pcm.length; i++)
					peak = Math.max(peak, Math.abs(pcm[i]));
				// A silent mic yields a garbage embedding that would silently
				// invalidate the whole cloned run.
				if (peak < 1e-4) {
					throw new Error(
						`Microphone captured silence (peak ${peak.toExponential(2)})`,
					);
				}
				return worker.extractEmbedding(pcm, sampleRate);
			},
			run: async (config = {}) => {
				setStatus("running");
				setReports([]);
				setError(null);
				try {
					const results = await runQualityTests(workerAdapter, config, {
						onProgress: setProgress,
						// Awaited, and failures are surfaced: a dropped rejection
						// here would leave report.md citing a WAV that was never
						// written, with nothing in the exit code to show for it.
						onAudio: async (item) => {
							if (!window.__qaEmitAudio) return;
							try {
								await window.__qaEmitAudio(
									{
										slug: item.slug,
										variant: item.variant,
										phraseIndex: item.phraseIndex,
										sampleRate: item.sampleRate,
									},
									encodeWavBase64(item.audio, item.sampleRate),
								);
							} catch (err) {
								throw new Error(
									`Failed to persist artifact for ${item.slug} ${item.variant} #${item.phraseIndex}: ${err instanceof Error ? err.message : String(err)}`,
								);
							}
						},
						// Streamed out per cell so a run that dies partway still
						// yields verdicts for the cells that finished.
						onReport: (report) => {
							void window.__qaEmitReport?.(report);
						},
					});
					setReports(results);
					setStatus("complete");
					return results;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					setError(message);
					setStatus("complete");
					throw err;
				}
			},
		};

		window.__modelQA = api;
		return () => {
			delete window.__modelQA;
		};
	}, [workerAdapter, worker]);

	const overallProgress =
		progress?.modelIndex != null && progress.totalModels
			? { value: progress.modelIndex, max: progress.totalModels }
			: null;

	return (
		<div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
			<h1 className="mb-6 text-2xl font-bold font-mono">
				TTS Quality Test Suite
			</h1>

			<div data-testid="status" className="sr-only">
				{status}
			</div>

			{/* Config */}
			<div className="mb-6 flex items-end gap-4">
				<div className="flex-1">
					<label
						htmlFor="model-filter"
						className="mb-1 block text-xs text-zinc-400"
					>
						Model filter (comma-separated slugs, or empty for all)
					</label>
					<input
						id="model-filter"
						type="text"
						value={modelFilter}
						onChange={(e) => setModelFilter(e.target.value)}
						placeholder="kokoro-82m, speecht5"
						disabled={status === "running"}
						className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<div className="flex-1">
					<label
						htmlFor="embedding-url"
						className="mb-1 block text-xs text-zinc-400"
					>
						Speaker embedding URL (empty = stock voice only)
					</label>
					<input
						id="embedding-url"
						type="text"
						value={embeddingUrl}
						onChange={(e) => setEmbeddingUrl(e.target.value)}
						placeholder="/embeddings/mic-clone.bin"
						disabled={status === "running"}
						className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
					/>
				</div>
				<label className="flex items-center gap-2 pb-2 text-xs text-zinc-400">
					<input
						id="include-streaming"
						type="checkbox"
						checked={includeStreaming}
						onChange={(e) => setIncludeStreaming(e.target.checked)}
						disabled={status === "running"}
					/>
					Streaming
				</label>
				<button
					data-testid="run-all-btn"
					onClick={handleRun}
					disabled={status === "running"}
					className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{status === "running" ? "Running..." : "Run All"}
				</button>
			</div>

			{/* Progress */}
			{status === "running" && progress && (
				<div className="mb-6 space-y-2 rounded border border-zinc-800 bg-zinc-900 p-4">
					<p
						data-testid="progress-message"
						className="text-sm font-mono text-zinc-300"
					>
						{progress.message}
					</p>
					{overallProgress && (
						<ProgressBar
							value={overallProgress.value}
							max={overallProgress.max}
						/>
					)}
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="mb-6 rounded border border-red-800 bg-red-950 p-4 text-sm text-red-300">
					{error}
				</div>
			)}

			{/* Results Table */}
			{reports.length > 0 && (
				<div className="mb-6 overflow-x-auto rounded border border-zinc-800">
					<table className="w-full text-left">
						<thead className="bg-zinc-900 text-xs text-zinc-400">
							<tr>
								<th className="px-3 py-2">Model</th>
								<th className="px-3 py-2">Variant</th>
								<th className="px-3 py-2">Verdict</th>
								<th className="px-3 py-2">Backend</th>
								<th className="px-3 py-2">Load Time</th>
								<th className="px-3 py-2">WER med / max</th>
								<th className="px-3 py-2">Max I/N</th>
								<th className="px-3 py-2">Max cepstral</th>
								<th className="px-3 py-2">Phrases</th>
								<th className="px-3 py-2">Failed Checks</th>
								<th className="px-3 py-2">Errors</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-zinc-800">
							{reports.map((r) => (
								<ModelResultRow key={`${r.slug}/${r.variant}`} report={r} />
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* JSON Output */}
			{reports.length > 0 && (
				<details className="rounded border border-zinc-800">
					<summary className="cursor-pointer bg-zinc-900 px-4 py-2 text-sm font-mono text-zinc-400">
						Raw JSON Report
					</summary>
					<pre
						data-testid="results-json"
						className="overflow-auto bg-zinc-950 p-4 text-xs font-mono text-zinc-300"
					>
						{JSON.stringify(reports, null, 2)}
					</pre>
				</details>
			)}
		</div>
	);
}
