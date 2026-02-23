"use client";

import { useEffect, useRef } from "react";

type HeroVisualizerProps = {
	analyser: AnalyserNode | null;
	isActive: boolean;
};

const BAR_COUNT = 48;
const MIN_BAR_HEIGHT = 4;

export function HeroVisualizer({ analyser, isActive }: HeroVisualizerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef<number>(0);
	const fadeRef = useRef(0);
	const isActiveRef = useRef(isActive);
	isActiveRef.current = isActive;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const reducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;

		const dataArray = analyser
			? new Uint8Array(analyser.frequencyBinCount)
			: null;

		let w = 0;
		let h = 0;

		const resize = () => {
			const dpr = window.devicePixelRatio || 1;
			const rect = canvas.getBoundingClientRect();
			w = rect.width;
			h = rect.height;
			canvas.width = w * dpr;
			canvas.height = h * dpr;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};

		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();

		// Read CSS colors (inherited from :root)
		const style = getComputedStyle(canvas);
		const colorFrom =
			style.getPropertyValue("--gradient-from").trim() ||
			"oklch(0.60 0.25 280)";
		const colorTo =
			style.getPropertyValue("--gradient-to").trim() ||
			"oklch(0.65 0.20 230)";

		// Reduced motion: draw static bars once, redraw only on resize
		if (reducedMotion) {
			observer.disconnect();

			const drawStatic = () => {
				ctx.clearRect(0, 0, w, h);
				const cx = w / 2;
				const cy = h * 0.58;
				const R = Math.min(w * 0.25, h * 0.35, 220);
				const arcSpan = Math.PI;
				const angleStep = arcSpan / BAR_COUNT;
				const bw = R * angleStep * 1.1;
				const staticHeight = MIN_BAR_HEIGHT + 0.15 * (Math.min(R * 0.5, 90) - MIN_BAR_HEIGHT);

				for (let i = 0; i < BAR_COUNT; i++) {
					const angle = Math.PI + (i + 0.5) * angleStep;
					ctx.save();
					ctx.translate(cx, cy);
					ctx.rotate(angle);
					ctx.globalAlpha = 0.6;
					ctx.fillStyle = colorFrom;
					ctx.beginPath();
					ctx.roundRect(R, -bw / 2, staticHeight, bw, 2);
					ctx.fill();
					ctx.restore();
				}
				ctx.globalAlpha = 1;
			};

			drawStatic();
			const staticObserver = new ResizeObserver(() => {
				resize();
				drawStatic();
			});
			staticObserver.observe(canvas);

			return () => {
				staticObserver.disconnect();
			};
		}

		const startTime = performance.now();

		const draw = () => {
			rafRef.current = requestAnimationFrame(draw);

			ctx.clearRect(0, 0, w, h);

			// Smooth fade: fast in, slow out
			const target = analyser && isActiveRef.current ? 1 : 0;
			const speed = target > fadeRef.current ? 0.08 : 0.03;
			fadeRef.current += (target - fadeRef.current) * speed;
			if (Math.abs(fadeRef.current - target) < 0.001)
				fadeRef.current = target;

			// Get frequency data when active
			if (analyser && dataArray) {
				analyser.getByteFrequencyData(dataArray);
			}

			const time = (performance.now() - startTime) / 1000;

			// Arc geometry
			const cx = w / 2;
			const cy = h * 0.58;
			const R = Math.min(w * 0.25, h * 0.35, 220);
			const maxBarHeight = Math.min(R * 0.5, 90);
			const arcSpan = Math.PI; // 180°
			const angleStep = arcSpan / BAR_COUNT;
			// Bar width at the arc radius — slightly oversized to close gaps
			const barWidth = R * angleStep * 1.1;

			for (let i = 0; i < BAR_COUNT; i++) {
				// Angle from π (left) through 3π/2 (top) to 2π (right)
				const angle = Math.PI + (i + 0.5) * angleStep;

				// Frequency value (low freq at center/top, high freq at edges)
				let value = 0;
				if (dataArray && fadeRef.current > 0.01) {
					const half = BAR_COUNT / 2;
					const distFromCenter =
						Math.abs(i - half + 0.5) / half;
					const binIdx = Math.min(
						Math.floor(
							Math.pow(distFromCenter, 1.5) *
								dataArray.length *
								0.8,
						),
						dataArray.length - 1,
					);
					value = (dataArray[binIdx] / 255) * fadeRef.current;
				}

				// Idle ambient breathing (fades out as audio fades in)
				const ambient =
					(1 - fadeRef.current) *
					(0.15 +
						0.08 * Math.sin(time * 1.2 + i * 0.3) +
						0.04 * Math.sin(time * 0.7 + i * 0.15 + 2.0));

				const totalValue = Math.max(value, ambient);
				const barHeight =
					MIN_BAR_HEIGHT +
					totalValue * (maxBarHeight - MIN_BAR_HEIGHT);

				// Color: brighter at peaks
				const color = totalValue > 0.45 ? colorTo : colorFrom;
				const alpha = 0.5 + totalValue * 0.5;

				ctx.save();
				ctx.translate(cx, cy);
				ctx.rotate(angle);

				// Main bar (extends outward from arc)
				ctx.globalAlpha = alpha;
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.roundRect(R, -barWidth / 2, barHeight, barWidth, 2);
				ctx.fill();

				// Mirror reflection (extends inward, lower opacity)
				const reflHeight = barHeight * 0.5;
				ctx.globalAlpha = alpha * 0.25;
				ctx.beginPath();
				ctx.roundRect(
					R - reflHeight,
					-barWidth / 2,
					reflHeight,
					barWidth,
					2,
				);
				ctx.fill();

				ctx.restore();
			}

			ctx.globalAlpha = 1;
		};

		rafRef.current = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(rafRef.current);
			observer.disconnect();
		};
	// Only re-run when analyser instance changes (isActive read from ref)
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [analyser]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
			aria-hidden="true"
			style={{ opacity: 0.3 }}
		/>
	);
}
