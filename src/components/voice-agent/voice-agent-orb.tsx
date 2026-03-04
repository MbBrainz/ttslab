"use client";

import { useMemo } from "react";
import type { AgentPhase } from "@/lib/hooks/use-voice-agent";
import { cn } from "@/lib/utils";

interface VoiceAgentOrbProps {
	phase: AgentPhase;
	children?: React.ReactNode;
}

type OrbStyle = {
	gradient: string;
	shadow: string;
	glowGradient: string;
	glowShadow: string;
	scaleClass: string;
	animationClass: string;
};

const orbStyles: Record<AgentPhase, OrbStyle> = {
	idle: {
		gradient:
			"radial-gradient(circle at 40% 40%, oklch(0.25 0.02 275), oklch(0.15 0.01 275))",
		shadow: "0 0 60px oklch(0.25 0.04 275 / 0.3)",
		glowGradient:
			"radial-gradient(circle, oklch(0.25 0.04 275 / 0.2), transparent 70%)",
		glowShadow: "none",
		scaleClass: "scale-100",
		animationClass: "",
	},
	listening: {
		gradient:
			"radial-gradient(circle at 40% 40%, oklch(0.45 0.18 270), oklch(0.30 0.12 280))",
		shadow:
			"0 0 80px oklch(0.45 0.18 270 / 0.4), 0 0 160px oklch(0.35 0.14 275 / 0.2)",
		glowGradient:
			"radial-gradient(circle, oklch(0.45 0.18 270 / 0.3), transparent 70%)",
		glowShadow: "0 0 80px oklch(0.40 0.16 270 / 0.3)",
		scaleClass: "scale-100",
		animationClass: "orb-breathe",
	},
	transcribing: {
		gradient:
			"radial-gradient(circle at 40% 40%, oklch(0.55 0.20 270), oklch(0.35 0.14 280))",
		shadow:
			"0 0 100px oklch(0.50 0.20 270 / 0.45), 0 0 180px oklch(0.40 0.16 275 / 0.2)",
		glowGradient:
			"radial-gradient(circle, oklch(0.50 0.20 270 / 0.35), transparent 70%)",
		glowShadow: "0 0 100px oklch(0.45 0.18 270 / 0.3)",
		scaleClass: "scale-[1.02]",
		animationClass: "",
	},
	thinking: {
		gradient:
			"radial-gradient(circle at 40% 40%, oklch(0.50 0.20 280), oklch(0.38 0.18 260))",
		shadow:
			"0 0 100px oklch(0.50 0.20 280 / 0.45), 0 0 200px oklch(0.42 0.18 270 / 0.2)",
		glowGradient:
			"radial-gradient(circle, oklch(0.50 0.20 280 / 0.35), transparent 70%)",
		glowShadow: "0 0 100px oklch(0.45 0.18 280 / 0.3)",
		scaleClass: "scale-100",
		animationClass: "orb-think",
	},
	speaking: {
		gradient:
			"radial-gradient(circle at 40% 40%, oklch(0.60 0.22 300), oklch(0.50 0.20 270))",
		shadow:
			"0 0 120px oklch(0.58 0.22 300 / 0.5), 0 0 240px oklch(0.50 0.20 285 / 0.25)",
		glowGradient:
			"radial-gradient(circle, oklch(0.58 0.22 300 / 0.4), transparent 70%)",
		glowShadow: "0 0 120px oklch(0.55 0.20 300 / 0.35)",
		scaleClass: "scale-105",
		animationClass: "orb-speak",
	},
};

export function VoiceAgentOrb({ phase, children }: VoiceAgentOrbProps) {
	const style = useMemo(() => orbStyles[phase], [phase]);

	return (
		<div className="relative flex items-center justify-center">
			{/* Glow layer (behind, larger, blurred) */}
			<div
				className={cn(
					"absolute h-48 w-48 rounded-full blur-xl transition-all duration-700 ease-out",
					style.scaleClass,
					style.animationClass,
				)}
				style={{
					background: style.glowGradient,
					boxShadow: style.glowShadow,
				}}
			/>
			{/* Main orb */}
			<div
				className={cn(
					"relative h-40 w-40 rounded-full transition-all duration-500 ease-out",
					style.scaleClass,
					style.animationClass,
				)}
				style={{
					background: style.gradient,
					boxShadow: style.shadow,
				}}
			/>
			{/* Canvas overlay slot */}
			{children}
		</div>
	);
}
