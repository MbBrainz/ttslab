"use client";

import type { AgentMetrics } from "@/lib/hooks/use-voice-agent";
import { formatMs } from "@/lib/format";

interface HudMetricsProps {
	metrics: AgentMetrics;
	visible: boolean;
}

export function HudMetrics({ metrics, visible }: HudMetricsProps) {
	const hasAny =
		metrics.sttMs !== null ||
		metrics.llmTokensPerSec !== null ||
		metrics.ttsRtf !== null;

	if (!hasAny || !visible) return null;

	const parts: string[] = [];
	if (metrics.sttMs !== null) parts.push(`STT ${formatMs(metrics.sttMs)}`);
	if (metrics.llmTokensPerSec !== null)
		parts.push(`LLM ${metrics.llmTokensPerSec.toFixed(0)} tok/s`);
	if (metrics.ttsRtf !== null)
		parts.push(`TTS ${metrics.ttsRtf.toFixed(2)}x`);

	return (
		<p className="text-center font-mono text-xs tabular-nums text-muted-foreground/50 transition-opacity duration-500">
			{parts.join(" \u00b7 ")}
		</p>
	);
}
