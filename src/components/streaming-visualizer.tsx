"use client";

import { useEffect, useRef } from "react";

type StreamingVisualizerProps = {
	analyser: AnalyserNode | null;
	isActive: boolean;
	height?: number;
};

export function StreamingVisualizer({
	analyser,
	isActive,
	height = 64,
}: StreamingVisualizerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef<number>(0);
	const fadeRef = useRef(0);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dataArray = analyser
			? new Uint8Array(analyser.frequencyBinCount)
			: null;

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

			const rect = canvas.getBoundingClientRect();
			const w = rect.width;
			const h = rect.height;

			ctx.clearRect(0, 0, w, h);

			if (!analyser || !dataArray) {
				fadeRef.current = Math.max(0, fadeRef.current - 0.05);
				if (fadeRef.current <= 0) return;
			}

			if (analyser && dataArray) {
				analyser.getByteFrequencyData(dataArray);
				fadeRef.current = isActive ? 1 : Math.max(0, fadeRef.current - 0.05);
			}

			if (fadeRef.current <= 0) return;

			// Get gradient colors from CSS custom properties (matches hero visualizer)
			const style = getComputedStyle(canvas);
			const colorFrom =
				style.getPropertyValue("--gradient-from").trim() ||
				"oklch(0.60 0.25 280)";
			const colorTo =
				style.getPropertyValue("--gradient-to").trim() ||
				"oklch(0.65 0.20 230)";

			const barCount = 32;
			const gap = 2;
			const totalGaps = (barCount - 1) * gap;
			const barWidth = Math.max(1, (w - totalGaps) / barCount);

			for (let i = 0; i < barCount; i++) {
				// Mirror: map bar index to frequency data symmetrically
				const half = barCount / 2;
				const dataIdx =
					i < half
						? Math.floor(((half - 1 - i) / half) * (dataArray?.length ?? 0))
						: Math.floor(((i - half) / half) * (dataArray?.length ?? 0));

				const value = dataArray ? dataArray[dataIdx] / 255 : 0;
				const barHeight = Math.max(2, value * h * 0.9);
				const x = i * (barWidth + gap);
				const y = (h - barHeight) / 2;

				// Color: brighter at peaks, matching hero visualizer style
				const color = value > 0.45 ? colorTo : colorFrom;
				ctx.globalAlpha = fadeRef.current * (0.5 + value * 0.5);
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.roundRect(x, y, barWidth, barHeight, 2);
				ctx.fill();
			}

			ctx.globalAlpha = 1;
		};

		rafRef.current = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(rafRef.current);
			observer.disconnect();
		};
	}, [analyser, isActive]);

	return (
		<canvas
			ref={canvasRef}
			className="w-full rounded-lg border border-border bg-secondary/30 px-4 py-3"
			style={{ height }}
		/>
	);
}
