"use client";

import {
	curvePaths,
	type Frame,
	histogramBars,
	lossPolyline,
	pointsToPath,
} from "@/lib/finetune/chart";
import { fmtCount, fmtLoss } from "@/lib/finetune/format";

const FRAME: Frame = { left: 52, right: 548, top: 14, bottom: 178 };

/** Training loss, log-scale SVG polyline (no chart library). */
export function LossChart({ history }: { history: number[] }) {
	const pts = lossPolyline(history, FRAME);
	let maxLoss = "";
	let minLoss = "";
	if (history.length > 0) {
		let min = Infinity;
		let max = -Infinity;
		for (const v of history) {
			if (v < min) min = v;
			if (v > max) max = v;
		}
		maxLoss = fmtLoss(max);
		minLoss = fmtLoss(min);
	}
	return (
		<svg
			viewBox="0 0 560 200"
			className="h-auto w-full"
			role="img"
			aria-label="Training loss over steps, logarithmic scale"
		>
			<text x={8} y={24} className="fill-muted-foreground text-[11px]">
				{maxLoss || "loss"}
			</text>
			<text x={8} y={176} className="fill-muted-foreground text-[11px]">
				{minLoss || ""}
			</text>
			{pts ? (
				<polyline
					points={pointsToPath(pts)}
					fill="none"
					strokeWidth={1.5}
					className="stroke-primary"
				/>
			) : (
				<text
					x={280}
					y={100}
					textAnchor="middle"
					className="fill-muted-foreground text-[12px]"
				>
					Press Train — the loss curve draws here, log scale.
				</text>
			)}
		</svg>
	);
}

/** Target wave (dashed reference) vs the network's current fit. */
export function FitChart({
	xs,
	targets,
	preds,
}: {
	xs: ArrayLike<number>;
	targets: ArrayLike<number>;
	preds: ArrayLike<number> | null;
}) {
	const { target, prediction } = curvePaths(xs, targets, preds, FRAME);
	return (
		<svg
			viewBox="0 0 560 200"
			className="h-auto w-full"
			role="img"
			aria-label="Target wave versus the network's current fit"
		>
			<path
				d={`M ${target}`}
				fill="none"
				strokeWidth={1.25}
				strokeDasharray="4 4"
				className="stroke-muted-foreground"
			/>
			{prediction && (
				<path
					d={`M ${prediction}`}
					fill="none"
					strokeWidth={1.75}
					className="stroke-primary"
				/>
			)}
			<text x={60} y={16} className="fill-muted-foreground text-[11px]">
				dashed = target · solid = network
			</text>
			<text
				x={280}
				y={196}
				textAnchor="middle"
				className="fill-muted-foreground text-[10px]"
			>
				x (one period)
			</text>
		</svg>
	);
}

/** 32-bin weight histogram (u32 counts read back from the GPU). */
export function WeightHistogram({ bins }: { bins: ArrayLike<number> }) {
	const bars = histogramBars(bins, {
		left: 16,
		right: 544,
		top: 8,
		bottom: 96,
	});
	return (
		<svg
			viewBox="0 0 560 110"
			className="h-auto w-full"
			role="img"
			aria-label="Weight value histogram, 32 bins"
		>
			{bars.map((b) => (
				<rect
					key={`bin-${b.x}`}
					x={b.x}
					y={b.y}
					width={Math.max(1, b.w - 1)}
					height={Math.max(b.count > 0 ? 1 : 0, b.h)}
					className="fill-primary/70"
				/>
			))}
			<text x={16} y={108} className="fill-muted-foreground text-[10px]">
				−
			</text>
			<text x={532} y={108} className="fill-muted-foreground text-[10px]">
				+
			</text>
			<text
				x={280}
				y={108}
				textAnchor="middle"
				className="fill-muted-foreground text-[10px]"
			>
				weight value (fixed window per init)
			</text>
		</svg>
	);
}

/** Compact labeled stat. */
export function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-border bg-background/50 px-3 py-2">
			<p className="text-[10px] tracking-wide text-muted-foreground uppercase">
				{label}
			</p>
			<p className="text-sm font-semibold tabular-nums">{value}</p>
		</div>
	);
}

export { fmtCount };
