"use client";

import { useEffect, useRef } from "react";
import type { ConversationTurn } from "@/lib/hooks/use-voice-agent";

interface ConversationLogProps {
	turns: ConversationTurn[];
	streamingText: string;
	isStreaming: boolean;
}

const OPACITIES = [0.3, 0.5, 1.0];

export function ConversationLog({
	turns,
	streamingText,
	isStreaming,
}: ConversationLogProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom on new content
	useEffect(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [turns, streamingText]);

	if (turns.length === 0 && !isStreaming) {
		return null;
	}

	const recentTurns = turns.slice(-3);

	return (
		<div ref={scrollRef} className="space-y-2 px-4">
			{recentTurns.map((turn, i) => {
				// Calculate opacity: if fewer than 3 turns, rightmost items get full opacity
				const opacityIdx = 3 - recentTurns.length + i;
				const opacity = OPACITIES[Math.max(0, opacityIdx)];

				return (
					<div
						key={turn.id}
						style={{ opacity }}
						className="transition-opacity duration-500"
					>
						<span className="text-xs font-medium text-muted-foreground">
							{turn.role === "user" ? "You" : "Agent"}
						</span>
						<p className="text-sm text-foreground">
							{turn.content}
							{turn.interrupted && (
								<span className="text-muted-foreground italic">
									{" "}
									(interrupted)
								</span>
							)}
						</p>
					</div>
				);
			})}

			{/* Streaming assistant response */}
			{isStreaming && streamingText && (
				<div className="transition-opacity duration-500">
					<span className="text-xs font-medium text-muted-foreground">
						Agent
					</span>
					<p className="text-sm text-foreground">
						{streamingText}
						<span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
					</p>
				</div>
			)}
		</div>
	);
}
