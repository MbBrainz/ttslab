"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useInferenceWorker } from "@/lib/inference/use-inference-worker";
import {
	runQualityTests,
	type ProgressUpdate,
	type InferenceWorkerAPI,
} from "@/lib/testing/tts-quality-runner";
import type { QualityReport, TestConfig } from "@/lib/testing/types";

// ── Types ────────────────────────────────────────────────────────────

type Status = "idle" | "running" | "complete";

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

function buildWorkerAdapter(hook: ReturnType<typeof useInferenceWorker>): InferenceWorkerAPI {
	return {
		loadModel: hook.loadModel,
		synthesize: hook.synthesize,
		transcribe: hook.transcribe,
		disposeModel: hook.dispose,
	};
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
	const avgWer = report.tests.length > 0
		? report.tests.reduce((s, t) => s + t.sttRoundTrip.wer, 0) / report.tests.length
		: 0;

	return (
		<tr
			data-testid={`model-result-${report.slug}`}
			className={VERDICT_BG[report.overall]}
		>
			<td className="px-3 py-2 font-mono text-sm">{report.slug}</td>
			<td className={`px-3 py-2 font-bold ${VERDICT_COLORS[report.overall]}`}>
				{report.overall.toUpperCase()}
			</td>
			<td className="px-3 py-2 text-sm">{report.backend}</td>
			<td className="px-3 py-2 text-sm tabular-nums">{formatMs(report.loadTimeMs)}</td>
			<td className="px-3 py-2 text-sm tabular-nums">{formatWer(avgWer)}</td>
			<td className="px-3 py-2 text-sm tabular-nums">{report.tests.length}</td>
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
	const [error, setError] = useState<string | null>(null);
	const runningRef = useRef(false);

	const workerAdapter = useMemo(() => buildWorkerAdapter(worker), [worker]);

	const buildConfig = useCallback((): TestConfig => {
		if (!modelFilter.trim()) return {};
		const models = modelFilter
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		return { models };
	}, [modelFilter]);

	const handleRun = useCallback(async () => {
		if (runningRef.current) return;
		runningRef.current = true;

		setStatus("running");
		setReports([]);
		setError(null);
		setProgress(null);

		try {
			const config = buildConfig();
			const results = await runQualityTests(workerAdapter, config, setProgress);
			setReports(results);
			setStatus("complete");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("complete");
		} finally {
			runningRef.current = false;
		}
	}, [workerAdapter, buildConfig]);

	const overallProgress = progress?.modelIndex != null && progress.totalModels
		? { value: progress.modelIndex, max: progress.totalModels }
		: null;

	return (
		<div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
			<h1 className="mb-6 text-2xl font-bold font-mono">TTS Quality Test Suite</h1>

			<div data-testid="status" className="sr-only">{status}</div>

			{/* Config */}
			<div className="mb-6 flex items-end gap-4">
				<div className="flex-1">
					<label htmlFor="model-filter" className="mb-1 block text-xs text-zinc-400">
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
					<p data-testid="progress-message" className="text-sm font-mono text-zinc-300">
						{progress.message}
					</p>
					{overallProgress && (
						<ProgressBar value={overallProgress.value} max={overallProgress.max} />
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
								<th className="px-3 py-2">Verdict</th>
								<th className="px-3 py-2">Backend</th>
								<th className="px-3 py-2">Load Time</th>
								<th className="px-3 py-2">Avg WER</th>
								<th className="px-3 py-2">Phrases</th>
								<th className="px-3 py-2">Errors</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-zinc-800">
							{reports.map((r) => (
								<ModelResultRow key={r.slug} report={r} />
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
