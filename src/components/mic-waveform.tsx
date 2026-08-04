"use client";

import { useEffect, useRef } from "react";

/** Current input level as 0..1, sampled once per animation frame. */
export type PeakReader = () => number;

type MicWaveformProps = {
	getPeak: PeakReader | null;
	isActive: boolean;
	height?: number;
};

const BAR_COUNT = 48;
const BAR_GAP = 2;
/** ms of audio summarised into one bar — BAR_COUNT * this = window length */
const BAR_INTERVAL_MS = 50;

/**
 * Peak reader backed by an AnalyserNode: peak deviation from the 128 midpoint
 * of getByteTimeDomainData. The scratch buffer is allocated once per reader.
 */
export function analyserPeakReader(analyser: AnalyserNode): PeakReader {
	const data = new Uint8Array(analyser.fftSize);
	return () => {
		analyser.getByteTimeDomainData(data);
		let peak = 0;
		for (const sample of data) {
			const deviation = Math.abs(sample - 128);
			if (deviation > peak) peak = deviation;
		}
		return Math.min(1, peak / 128);
	};
}

function readCssColors(canvas: HTMLCanvasElement) {
	const style = getComputedStyle(canvas);
	return {
		from:
			style.getPropertyValue("--gradient-from").trim() ||
			"oklch(0.60 0.25 280)",
		to:
			style.getPropertyValue("--gradient-to").trim() || "oklch(0.65 0.20 230)",
	};
}

function drawBars(
	ctx: CanvasRenderingContext2D,
	bars: number[],
	w: number,
	h: number,
	colors: { from: string; to: string },
) {
	const barWidth = Math.max(1, (w - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT);
	for (let i = 0; i < BAR_COUNT; i++) {
		const value = bars[i];
		const barHeight = Math.max(2, value * h * 0.9);
		const x = i * (barWidth + BAR_GAP);
		const y = (h - barHeight) / 2;
		ctx.globalAlpha = 0.5 + value * 0.5;
		ctx.fillStyle = value > 0.45 ? colors.to : colors.from;
		ctx.beginPath();
		ctx.roundRect(x, y, barWidth, barHeight, 2);
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}

/**
 * Scrolling time-domain view of live microphone input. Each bar is the peak
 * amplitude of one BAR_INTERVAL_MS slice of audio, newest on the right — so the
 * shape carries real per-time information rather than a re-rendered scalar.
 * The level source is injected, so it works off an AnalyserNode or off the
 * VAD's own frames without this component knowing which.
 */
export function MicWaveform({
	getPeak,
	isActive,
	height = 64,
}: MicWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef<number>(0);
	const barsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const colors = readCssColors(canvas);
		let slicePeak = 0;
		let lastPush = performance.now();

		const resize = () => {
			const dpr = window.devicePixelRatio || 1;
			const rect = canvas.getBoundingClientRect();
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			ctx.scale(dpr, dpr);
		};
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();

		const draw = () => {
			rafRef.current = requestAnimationFrame(draw);

			if (getPeak && isActive) {
				slicePeak = Math.max(slicePeak, getPeak());
			}

			const now = performance.now();
			if (now - lastPush >= BAR_INTERVAL_MS) {
				lastPush = now;
				barsRef.current = [...barsRef.current.slice(1), slicePeak];
				slicePeak = 0;
			}

			const rect = canvas.getBoundingClientRect();
			ctx.clearRect(0, 0, rect.width, rect.height);
			drawBars(ctx, barsRef.current, rect.width, rect.height, colors);
		};
		rafRef.current = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(rafRef.current);
			observer.disconnect();
		};
	}, [getPeak, isActive]);

	return (
		<canvas
			ref={canvasRef}
			className="w-full rounded-lg border border-border bg-secondary/30 px-4 py-3"
			style={{ height }}
		/>
	);
}
