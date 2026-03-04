"use client";

import { useEffect, useRef } from "react";
import type { AgentPhase } from "@/lib/hooks/use-voice-agent";

interface OrbCanvasProps {
	analyser: AnalyserNode | null;
	phase: AgentPhase;
	orbSize: number;
}

const SEGMENTS = 64;
const BASE_OFFSET = 12;

function getPhaseConfig(phase: AgentPhase) {
	switch (phase) {
		case "speaking":
			return {
				amplitudeMax: 20,
				strokeColor: "oklch(0.65 0.20 300 / 0.6)",
				lineWidth: 2.5,
			};
		case "listening":
			return {
				amplitudeMax: 20,
				strokeColor: "oklch(0.55 0.18 270 / 0.4)",
				lineWidth: 2,
			};
		default:
			return {
				amplitudeMax: 6,
				strokeColor: "oklch(0.40 0.10 275 / 0.25)",
				lineWidth: 1.5,
			};
	}
}

export function OrbCanvas({ analyser, phase, orbSize }: OrbCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef<number>(0);

	const canvasSize = orbSize + 80;

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
			const cx = w / 2;
			const cy = h / 2;

			ctx.clearRect(0, 0, w, h);

			if (analyser && dataArray) {
				analyser.getByteFrequencyData(dataArray);
			}

			const config = getPhaseConfig(phase);
			const baseRadius = orbSize / 2 + BASE_OFFSET;

			ctx.beginPath();

			for (let i = 0; i <= SEGMENTS; i++) {
				const angle = (i / SEGMENTS) * Math.PI * 2 - Math.PI / 2;

				let value = 0;
				if (dataArray && dataArray.length > 0) {
					const dataIdx = Math.floor(
						(i % SEGMENTS) * (dataArray.length / SEGMENTS),
					);
					value = dataArray[dataIdx] / 255;
				}

				const radius = baseRadius + value * config.amplitudeMax;
				const x = cx + Math.cos(angle) * radius;
				const y = cy + Math.sin(angle) * radius;

				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}

			ctx.closePath();
			ctx.strokeStyle = config.strokeColor;
			ctx.lineWidth = config.lineWidth;
			ctx.lineJoin = "round";
			ctx.stroke();
		};

		rafRef.current = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(rafRef.current);
			observer.disconnect();
		};
	}, [analyser, phase, orbSize]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute"
			style={{
				width: canvasSize,
				height: canvasSize,
				top: "50%",
				left: "50%",
				transform: "translate(-50%, -50%)",
			}}
		/>
	);
}
