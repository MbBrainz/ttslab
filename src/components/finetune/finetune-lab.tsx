"use client";

import {
	Gpu,
	Loader2,
	Pause,
	Play,
	RotateCcw,
	TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	FitChart,
	LossChart,
	Stat,
	WeightHistogram,
} from "@/components/finetune/charts";
import { Button } from "@/components/ui/button";
import { fmtCount, fmtFloat, fmtLoss } from "@/lib/finetune/format";
import { PARAM_COUNT } from "@/lib/finetune/mlp";
import { FinetuneTrainer, type TickData } from "@/lib/finetune/session";
import {
	BATCH_SIZE,
	buildDataset,
	type Dataset,
	TASK_IDS,
	TASK_LABELS,
	type TaskId,
} from "@/lib/finetune/tasks";

type Phase =
	| "probing"
	| "unsupported"
	| "error"
	| "ready"
	| "training"
	| "lost";

/** Hard cap on gradient steps per animation frame — keeps the tab
 * responsive no matter where the slider is. */
const MAX_STEPS_PER_FRAME = 32;
const DEFAULT_STEPS_PER_FRAME = 8;
const LOSS_HISTORY = 360;

function isTrainerLive(phase: Phase): boolean {
	return phase === "ready" || phase === "training";
}

export function FinetuneLab() {
	const [phase, setPhase] = useState<Phase>("probing");
	const [error, setError] = useState<string | null>(null);
	const [task, setTask] = useState<TaskId>("sine");
	const [lr, setLr] = useState(0.02);
	const [speed, setSpeed] = useState(DEFAULT_STEPS_PER_FRAME);
	const [history, setHistory] = useState<number[]>([]);
	const [tick, setTick] = useState<TickData | null>(null);
	const [best, setBest] = useState<number | null>(null);
	const [dataset, setDataset] = useState<Dataset>(() => buildDataset("sine"));

	const trainerRef = useRef<FinetuneTrainer | null>(null);
	const datasetRef = useRef<Dataset>(dataset);
	const speedRef = useRef(DEFAULT_STEPS_PER_FRAME);
	const lrRef = useRef(0.02);
	const taskRef = useRef<TaskId>("sine");
	const resetSeedRef = useRef(0);
	const busyRef = useRef(false);
	const rafRef = useRef<number | null>(null);
	const initEpochRef = useRef(0);

	const init = useCallback(async () => {
		// guard against overlapping probes (React strict mode double-mount,
		// or Re-initialize pressed while a probe is still pending)
		const epoch = ++initEpochRef.current;
		setPhase("probing");
		setError(null);
		setHistory([]);
		setTick(null);
		setBest(null);
		resetSeedRef.current = 0;
		trainerRef.current?.dispose();
		trainerRef.current = null;
		const ds = buildDataset(taskRef.current);
		datasetRef.current = ds;
		setDataset(ds);
		try {
			const trainer = await FinetuneTrainer.probe({
				lr: lrRef.current,
				seed: 0,
			});
			if (epoch !== initEpochRef.current) {
				// a newer init owns the slot — drop this device immediately
				trainer?.dispose();
				return;
			}
			if (!trainer) {
				setPhase("unsupported");
				return;
			}
			trainer.onLost = () => {
				trainerRef.current?.dispose();
				trainerRef.current = null;
				setPhase("lost");
			};
			trainer.setDataset(ds.features, ds.targets);
			trainer.setLearningRate(lrRef.current);
			trainerRef.current = trainer;
			setPhase("ready");
		} catch (e) {
			if (epoch !== initEpochRef.current) return;
			setError(e instanceof Error ? e.message : String(e));
			setPhase("error");
		}
	}, []);

	useEffect(() => {
		void init();
		return () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			// invalidate any probe still pending; the epoch check disposes it
			initEpochRef.current += 1;
			trainerRef.current?.dispose();
			trainerRef.current = null;
		};
	}, [init]);

	const tickOnce = useCallback(async (): Promise<void> => {
		const trainer = trainerRef.current;
		if (!trainer) return;
		try {
			const d = await trainer.tick(speedRef.current);
			setTick(d);
			setHistory((prev) => [...prev, d.loss].slice(-LOSS_HISTORY));
			setBest((prev) => (prev === null || d.loss < prev ? d.loss : prev));
		} catch (e) {
			// a late rejection after device loss / dispose must not clobber
			// the "lost" phase — only surface errors from a live trainer
			if (trainerRef.current !== trainer) return;
			setError(e instanceof Error ? e.message : String(e));
			setPhase("error");
		}
	}, []);

	useEffect(() => {
		if (phase !== "training") return;
		let cancelled = false;
		const loop = (): void => {
			if (cancelled) return;
			if (!document.hidden && !busyRef.current) {
				busyRef.current = true;
				void tickOnce().finally(() => {
					busyRef.current = false;
				});
			}
			rafRef.current = requestAnimationFrame(loop);
		};
		rafRef.current = requestAnimationFrame(loop);
		return () => {
			cancelled = true;
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
		};
	}, [phase, tickOnce]);

	const changeTask = (t: TaskId): void => {
		setTask(t);
		taskRef.current = t;
		const ds = buildDataset(t);
		datasetRef.current = ds;
		setDataset(ds);
		trainerRef.current?.setDataset(ds.features, ds.targets);
		trainerRef.current?.resetWeights(resetSeedRef.current++);
		setHistory([]);
		setTick(null);
		setBest(null);
	};

	const resetWeights = (): void => {
		trainerRef.current?.resetWeights(resetSeedRef.current++);
		setHistory([]);
		setTick(null);
		setBest(null);
	};

	const lrExp = Math.log10(lr);
	const live = isTrainerLive(phase);
	const running = phase === "training";

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm leading-relaxed">
				<strong className="font-semibold">What this is:</strong> a from-scratch
				toy network trained on <em>your</em> GPU to prove the in-browser
				training pipeline — {fmtCount(PARAM_COUNT)} weights, real forward +
				backprop + Adam in WGSL. It is <strong>not</strong> a speech model;
				nothing on TTSLab fine-tunes Woof or any production TTS today. That is
				the roadmap step this demo de-risks (
				<Link
					href="/limits"
					className="text-primary underline underline-offset-2"
				>
					why large fine-tunes are hard
				</Link>
				,{" "}
				<Link
					href="/blog/underdog-woof-deep-dive"
					className="text-primary underline underline-offset-2"
				>
					the Woof story
				</Link>
				).
			</div>

			{phase === "probing" && (
				<div className="flex items-center gap-3 rounded-lg border border-border px-4 py-8 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Requesting a WebGPU adapter…
				</div>
			)}

			{phase === "unsupported" && (
				<div className="space-y-2 rounded-lg border border-border px-4 py-8 text-sm">
					<p className="flex items-center gap-2 font-semibold">
						<TriangleAlert className="h-4 w-4" /> WebGPU is required for
						Finetune Lab
					</p>
					<p className="text-muted-foreground">
						This page runs a real training loop on your GPU, so there is no CPU
						fallback in v1 — a typed-array trainer would be 100&times; slower
						and miss the point of the pipeline proof. Use Chrome or Edge 113+
						(including Android 12+), Safari 26+, or Firefox 141+ on Windows /
						147+ on Apple Silicon. Everything else on TTSLab — all TTS and STT
						demos — works without WebGPU via the WASM fallback.
					</p>
					<p className="text-muted-foreground">
						See{" "}
						<Link
							href="/limits"
							className="text-primary underline underline-offset-2"
						>
							the limits report
						</Link>{" "}
						for the full WebGPU availability picture (~89% of browsers, November
						2026).
					</p>
				</div>
			)}

			{phase === "error" && (
				<div className="space-y-3 rounded-lg border border-destructive/40 px-4 py-8 text-sm">
					<p className="flex items-center gap-2 font-semibold">
						<TriangleAlert className="h-4 w-4" /> The trainer failed to start or
						stalled
					</p>
					<p className="text-muted-foreground">
						{error ?? "Unknown WebGPU error."} Every wait is bounded, so nothing
						should hang — re-initializing is safe.
					</p>
					<Button size="sm" variant="outline" onClick={() => void init()}>
						<RotateCcw className="h-4 w-4" /> Re-initialize
					</Button>
				</div>
			)}

			{phase === "lost" && (
				<div className="space-y-3 rounded-lg border border-destructive/40 px-4 py-8 text-sm">
					<p className="flex items-center gap-2 font-semibold">
						<Gpu className="h-4 w-4" /> The GPU device was lost
					</p>
					<p className="text-muted-foreground">
						The browser took the device away (driver reset, GPU memory pressure,
						or another tab claimed it). Training stopped gracefully — nothing
						crashed. Re-initialize to start over with fresh weights.
					</p>
					<Button size="sm" variant="outline" onClick={() => void init()}>
						<RotateCcw className="h-4 w-4" /> Re-initialize
					</Button>
				</div>
			)}

			{(live || running) && (
				<div className="space-y-4 rounded-lg border border-border p-4">
					{/* Controls */}
					<div className="flex flex-wrap items-end gap-4">
						<div className="flex items-end gap-2">
							{running ? (
								<Button
									size="sm"
									variant="secondary"
									onClick={() => setPhase("ready")}
								>
									<Pause className="h-4 w-4" /> Pause
								</Button>
							) : (
								<Button size="sm" onClick={() => setPhase("training")}>
									<Play className="h-4 w-4" /> Train
								</Button>
							)}
							<Button size="sm" variant="outline" onClick={resetWeights}>
								<RotateCcw className="h-4 w-4" /> Reset
							</Button>
						</div>

						<label className="flex flex-col gap-1 text-xs text-muted-foreground">
							Task
							<select
								value={task}
								onChange={(e) => changeTask(e.target.value as TaskId)}
								className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
							>
								{TASK_IDS.map((t) => (
									<option key={t} value={t}>
										{TASK_LABELS[t]} wave
									</option>
								))}
							</select>
						</label>

						<label className="flex w-44 flex-col gap-1 text-xs text-muted-foreground">
							Learning rate: {fmtFloat(lr, 4)}
							<input
								type="range"
								min={-4}
								max={-1}
								step={0.02}
								value={lrExp}
								onChange={(e) => {
									const exp = Number(e.target.value);
									const next = 10 ** exp;
									setLr(next);
									lrRef.current = next;
									trainerRef.current?.setLearningRate(next);
								}}
								aria-label="Learning rate (log scale)"
							/>
						</label>

						<label className="flex w-44 flex-col gap-1 text-xs text-muted-foreground">
							Steps per frame: {speed} (max {MAX_STEPS_PER_FRAME})
							<input
								type="range"
								min={1}
								max={MAX_STEPS_PER_FRAME}
								step={1}
								value={speed}
								onChange={(e) => {
									const next = Number(e.target.value);
									setSpeed(next);
									speedRef.current = next;
								}}
								aria-label="Gradient steps per animation frame"
							/>
						</label>
					</div>

					{/* Stats */}
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
						<Stat label="Step" value={fmtCount(tick?.steps ?? 0)} />
						<Stat label="Loss (MSE)" value={fmtLoss(tick?.loss ?? NaN)} />
						<Stat label="Best loss" value={fmtLoss(best ?? NaN)} />
						<Stat label="Grad norm" value={fmtFloat(tick?.gradNorm ?? NaN)} />
						<Stat label="Parameters" value={fmtCount(PARAM_COUNT)} />
						<Stat label="Batch" value={`${BATCH_SIZE} samples`} />
					</div>

					{/* Curve fit */}
					<figure className="space-y-1">
						<figcaption className="text-xs font-medium text-muted-foreground">
							Curve fit — target wave vs. network output (read back from the GPU
							each frame)
						</figcaption>
						<FitChart
							xs={dataset.xs}
							targets={dataset.targets}
							preds={tick?.preds ?? null}
						/>
					</figure>

					{/* Loss chart */}
					<figure className="space-y-1">
						<figcaption className="text-xs font-medium text-muted-foreground">
							Loss (log scale) — one point per frame, last {LOSS_HISTORY} frames
						</figcaption>
						<LossChart history={history} />
					</figure>

					{/* Weight histogram */}
					<figure className="space-y-1">
						<figcaption className="text-xs font-medium text-muted-foreground">
							Weight histogram — all {fmtCount(PARAM_COUNT)} weights, read back
							from the GPU
						</figcaption>
						<WeightHistogram bins={tick?.bins ?? new Uint32Array(32)} />
					</figure>

					<p className="text-xs text-muted-foreground">
						Everything above is computed on your GPU: 22 WGSL dispatches per
						step (forward, backprop, Adam), diagnostics readbacks once per
						frame, steps per frame capped at {MAX_STEPS_PER_FRAME}. Watch the
						weights shift and the loss fall — same seeded init every time, so
						Reset + Train from the same settings replays the same run.
					</p>
				</div>
			)}
		</div>
	);
}
