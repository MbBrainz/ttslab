"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

type ScatterModel = {
	slug: string;
	name: string;
	type: "tts" | "stt";
	sizeMb: number | null;
	paramsMillions: number | null;
	voices: number | null;
	status: string;
};

type ModelScatterPlotProps = {
	models: ScatterModel[];
};

const PADDING = { top: 30, right: 30, bottom: 50, left: 65 };
const VIEW_W = 800;
const VIEW_H = 400;
const PLOT_W = VIEW_W - PADDING.left - PADDING.right;
const PLOT_H = VIEW_H - PADDING.top - PADDING.bottom;

function niceAxis(min: number, max: number, tickCount: number) {
	const range = max - min || 1;
	const rough = range / tickCount;
	const mag = 10 ** Math.floor(Math.log10(rough));
	const nice = [1, 2, 5, 10].find((n) => n * mag >= rough)! * mag;
	const lo = Math.floor(min / nice) * nice;
	const hi = Math.ceil(max / nice) * nice;
	const ticks: number[] = [];
	for (let v = lo; v <= hi + nice * 0.01; v += nice) {
		ticks.push(Math.round(v * 1000) / 1000);
	}
	return { lo, hi, ticks };
}

function dotRadius(voices: number | null): number {
	if (voices == null || voices <= 0) return 6;
	return Math.min(20, 6 + Math.sqrt(voices) * 2);
}

export function ModelScatterPlot({ models }: ModelScatterPlotProps) {
	const [hovered, setHovered] = useState<string | null>(null);

	const plotModels = useMemo(
		() =>
			models.filter(
				(m) => m.sizeMb != null && m.paramsMillions != null,
			) as (ScatterModel & { sizeMb: number; paramsMillions: number })[],
		[models],
	);

	const { xAxis, yAxis } = useMemo(() => {
		if (plotModels.length === 0) {
			return {
				xAxis: { lo: 0, hi: 100, ticks: [0, 50, 100] },
				yAxis: { lo: 0, hi: 100, ticks: [0, 50, 100] },
			};
		}
		const sizes = plotModels.map((m) => m.sizeMb);
		const params = plotModels.map((m) => m.paramsMillions);
		return {
			xAxis: niceAxis(Math.min(...sizes), Math.max(...sizes), 5),
			yAxis: niceAxis(Math.min(...params), Math.max(...params), 5),
		};
	}, [plotModels]);

	const toX = (v: number) =>
		PADDING.left + ((v - xAxis.lo) / (xAxis.hi - xAxis.lo || 1)) * PLOT_W;
	const toY = (v: number) =>
		PADDING.top +
		PLOT_H -
		((v - yAxis.lo) / (yAxis.hi - yAxis.lo || 1)) * PLOT_H;

	const hoveredModel = plotModels.find((m) => m.slug === hovered);

	return (
		<svg
			viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
			className="w-full"
			style={{ maxHeight: 400 }}
		>
			{/* Grid lines */}
			{xAxis.ticks.map((t) => (
				<line
					key={`gx-${t}`}
					x1={toX(t)}
					y1={PADDING.top}
					x2={toX(t)}
					y2={PADDING.top + PLOT_H}
					className="stroke-border"
					strokeWidth={0.5}
				/>
			))}
			{yAxis.ticks.map((t) => (
				<line
					key={`gy-${t}`}
					x1={PADDING.left}
					y1={toY(t)}
					x2={PADDING.left + PLOT_W}
					y2={toY(t)}
					className="stroke-border"
					strokeWidth={0.5}
				/>
			))}

			{/* Axes */}
			<line
				x1={PADDING.left}
				y1={PADDING.top + PLOT_H}
				x2={PADDING.left + PLOT_W}
				y2={PADDING.top + PLOT_H}
				className="stroke-muted-foreground"
				strokeWidth={1}
			/>
			<line
				x1={PADDING.left}
				y1={PADDING.top}
				x2={PADDING.left}
				y2={PADDING.top + PLOT_H}
				className="stroke-muted-foreground"
				strokeWidth={1}
			/>

			{/* X-axis ticks & labels */}
			{xAxis.ticks.map((t) => (
				<g key={`xt-${t}`}>
					<line
						x1={toX(t)}
						y1={PADDING.top + PLOT_H}
						x2={toX(t)}
						y2={PADDING.top + PLOT_H + 5}
						className="stroke-muted-foreground"
						strokeWidth={1}
					/>
					<text
						x={toX(t)}
						y={PADDING.top + PLOT_H + 18}
						textAnchor="middle"
						className="fill-muted-foreground"
						fontSize={11}
					>
						{t >= 1000 ? `${(t / 1024).toFixed(1)}G` : t}
					</text>
				</g>
			))}

			{/* Y-axis ticks & labels */}
			{yAxis.ticks.map((t) => (
				<g key={`yt-${t}`}>
					<line
						x1={PADDING.left - 5}
						y1={toY(t)}
						x2={PADDING.left}
						y2={toY(t)}
						className="stroke-muted-foreground"
						strokeWidth={1}
					/>
					<text
						x={PADDING.left - 10}
						y={toY(t) + 4}
						textAnchor="end"
						className="fill-muted-foreground"
						fontSize={11}
					>
						{t}
					</text>
				</g>
			))}

			{/* Axis titles */}
			<text
				x={PADDING.left + PLOT_W / 2}
				y={VIEW_H - 4}
				textAnchor="middle"
				className="fill-muted-foreground"
				fontSize={12}
				fontWeight={500}
			>
				Model Size (MB)
			</text>
			<text
				x={14}
				y={PADDING.top + PLOT_H / 2}
				textAnchor="middle"
				className="fill-muted-foreground"
				fontSize={12}
				fontWeight={500}
				transform={`rotate(-90, 14, ${PADDING.top + PLOT_H / 2})`}
			>
				Parameters (M)
			</text>

			{/* Data points */}
			{plotModels.map((m) => {
				const cx = toX(m.sizeMb);
				const cy = toY(m.paramsMillions);
				const r = dotRadius(m.voices);
				const isTts = m.type === "tts";
				const isSupported = m.status === "supported";
				const isHovered = hovered === m.slug;

				return (
					<circle
						key={m.slug}
						cx={cx}
						cy={cy}
						r={isHovered ? r + 2 : r}
						fill={isTts ? "var(--color-primary)" : "oklch(0.65 0.2 295)"}
						opacity={isSupported ? 0.85 : 0.4}
						stroke={isHovered ? "var(--color-foreground)" : "none"}
						strokeWidth={isHovered ? 1.5 : 0}
						className="transition-all duration-150 cursor-pointer"
						onMouseEnter={() => setHovered(m.slug)}
						onMouseLeave={() => setHovered(null)}
					/>
				);
			})}

			{/* Tooltip */}
			{hoveredModel && (() => {
				const tx = toX(hoveredModel.sizeMb);
				const ty = toY(hoveredModel.paramsMillions);
				const tooltipW = 160;
				const tooltipH = 58;
				// Flip tooltip if too close to edges
				const flipX = tx + tooltipW + 15 > VIEW_W;
				const flipY = ty - tooltipH - 10 < 0;
				const ttx = flipX ? tx - tooltipW - 10 : tx + 10;
				const tty = flipY ? ty + 10 : ty - tooltipH - 5;

				return (
					<g pointerEvents="none">
						<rect
							x={ttx}
							y={tty}
							width={tooltipW}
							height={tooltipH}
							rx={6}
							className="fill-card stroke-border"
							strokeWidth={1}
						/>
						<text
							x={ttx + 10}
							y={tty + 18}
							className="fill-foreground"
							fontSize={12}
							fontWeight={600}
						>
							{hoveredModel.name.length > 22
								? `${hoveredModel.name.slice(0, 20)}...`
								: hoveredModel.name}
						</text>
						<text
							x={ttx + 10}
							y={tty + 34}
							className="fill-muted-foreground"
							fontSize={11}
						>
							Size: {hoveredModel.sizeMb >= 1024
								? `${(hoveredModel.sizeMb / 1024).toFixed(1)} GB`
								: `${hoveredModel.sizeMb} MB`}
						</text>
						<text
							x={ttx + 10}
							y={tty + 49}
							className="fill-muted-foreground"
							fontSize={11}
						>
							Params: {hoveredModel.paramsMillions}M
						</text>
					</g>
				);
			})()}

			{/* Legend */}
			<g transform={`translate(${PADDING.left + PLOT_W - 195}, ${PADDING.top + 5})`}>
				<rect
					x={0}
					y={0}
					width={190}
					height={68}
					rx={6}
					className="fill-card/80 stroke-border"
					strokeWidth={0.5}
				/>
				{/* TTS */}
				<circle cx={16} cy={16} r={5} fill="var(--color-primary)" opacity={0.85} />
				<text x={28} y={20} className="fill-muted-foreground" fontSize={11}>
					TTS
				</text>
				{/* STT */}
				<circle cx={70} cy={16} r={5} fill="oklch(0.65 0.2 295)" opacity={0.85} />
				<text x={82} y={20} className="fill-muted-foreground" fontSize={11}>
					STT
				</text>
				{/* Supported */}
				<circle cx={16} cy={36} r={5} className="fill-muted-foreground" opacity={0.85} />
				<text x={28} y={40} className="fill-muted-foreground" fontSize={11}>
					Supported
				</text>
				{/* Unsupported */}
				<circle cx={16} cy={54} r={5} className="fill-muted-foreground" opacity={0.4} />
				<text x={28} y={58} className="fill-muted-foreground" fontSize={11}>
					Planned / Unsupported
				</text>
			</g>
		</svg>
	);
}

export function ModelScatterPlotSection({ models }: ModelScatterPlotProps) {
	const [open, setOpen] = useState(false);

	const plottable = models.filter(
		(m) => m.sizeMb != null && m.paramsMillions != null,
	);

	if (plottable.length < 2) return null;

	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<CardTitle>Model Landscape</CardTitle>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setOpen((v) => !v)}
						className="gap-1"
					>
						{open ? (
							<ChevronDown className="h-4 w-4" />
						) : (
							<ChevronRight className="h-4 w-4" />
						)}
						{open ? "Hide" : "Show"} Visualization
					</Button>
				</div>
			</CardHeader>
			{open && (
				<CardContent>
					<ModelScatterPlot models={models} />
				</CardContent>
			)}
		</Card>
	);
}
