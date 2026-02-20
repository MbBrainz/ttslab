"use client";

import { useEffect, useRef } from "react";
import type { ConversationTurn } from "@/lib/hooks/use-voice-agent";
import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/format";

interface ConversationLogProps {
	turns: ConversationTurn[];
	streamingText: string;
	isStreaming: boolean;
}

export function ConversationLog({ turns, streamingText, isStreaming }: ConversationLogProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom on new content
	useEffect(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [turns, streamingText]);

	if (turns.length === 0 && !isStreaming) {
		return (
			<div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
				Start a conversation to see it appear here.
			</div>
		);
	}

	return (
		<div
			ref={scrollRef}
			className="flex h-64 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-secondary/30 p-4"
		>
			{turns.map((turn) => (
				<div
					key={turn.id}
					className={cn(
						"flex flex-col gap-1",
						turn.role === "user" ? "items-end" : "items-start",
					)}
				>
					<div
						className={cn(
							"max-w-[80%] rounded-lg px-3 py-2 text-sm",
							turn.role === "user"
								? "bg-primary text-primary-foreground"
								: "bg-card text-card-foreground border border-border",
						)}
					>
						{turn.content}
					</div>
					{turn.metrics && (
						<div className="flex gap-2 text-[10px] text-muted-foreground">
							{turn.metrics.sttMs != null && (
								<span>STT {formatMs(turn.metrics.sttMs)}</span>
							)}
							{turn.metrics.llmMs != null && (
								<span>LLM {formatMs(turn.metrics.llmMs)}</span>
							)}
							{turn.metrics.llmTokensPerSec != null && (
								<span>{turn.metrics.llmTokensPerSec} tok/s</span>
							)}
						</div>
					)}
				</div>
			))}

			{/* Streaming assistant response */}
			{isStreaming && streamingText && (
				<div className="flex flex-col items-start gap-1">
					<div className="max-w-[80%] rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground">
						{streamingText}
						<span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
					</div>
				</div>
			)}
		</div>
	);
}
