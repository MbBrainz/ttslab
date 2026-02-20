"use client";

import { cn } from "@/lib/utils";
import type { AgentPhase } from "@/lib/hooks/use-voice-agent";

const PHASES: { key: AgentPhase; label: string }[] = [
	{ key: "listening", label: "Listening" },
	{ key: "transcribing", label: "Transcribing" },
	{ key: "thinking", label: "Thinking" },
	{ key: "speaking", label: "Speaking" },
];

export function PipelineStatus({ phase }: { phase: AgentPhase }) {
	if (phase === "idle") return null;

	const activeIdx = PHASES.findIndex((p) => p.key === phase);

	return (
		<div className="flex items-center gap-2">
			{PHASES.map((p, i) => {
				const isActive = p.key === phase;
				const isPast = i < activeIdx;

				return (
					<div key={p.key} className="flex items-center gap-2">
						{i > 0 && (
							<div
								className={cn(
									"h-px w-4",
									isPast || isActive ? "bg-primary" : "bg-border",
								)}
							/>
						)}
						<div className="flex items-center gap-1.5">
							<span
								className={cn(
									"flex h-2.5 w-2.5 rounded-full",
									isActive && "animate-pulse bg-primary",
									isPast && "bg-primary",
									!isActive && !isPast && "bg-muted-foreground/30",
								)}
							/>
							<span
								className={cn(
									"text-xs font-medium",
									isActive && "text-primary",
									isPast && "text-foreground",
									!isActive && !isPast && "text-muted-foreground",
								)}
							>
								{p.label}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
