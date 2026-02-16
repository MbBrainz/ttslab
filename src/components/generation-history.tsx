"use client";

import { Clock, Download, Play, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HistoryEntry = {
	id: string;
	text: string;
	voice?: string;
	voiceName?: string;
	audioUrl?: string;
	generationTimeMs: number;
	backend: "webgpu" | "wasm";
	timestamp: number;
};

type GenerationHistoryProps = {
	modelSlug: string;
};

function getStorageKey(slug: string) {
	return `ttslab:tts-history:${slug}`;
}

function getHistory(slug: string): HistoryEntry[] {
	try {
		const raw = localStorage.getItem(getStorageKey(slug));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

// In-memory cache for blob URLs (not persisted — they're invalid after reload)
const sessionAudioUrls = new Map<string, string>();

export function addToHistory(slug: string, entry: HistoryEntry) {
	// Cache blob URL in memory for same-session playback
	if (entry.audioUrl) {
		sessionAudioUrls.set(entry.id, entry.audioUrl);
	}
	const existing = getHistory(slug);
	// Strip blob URLs before persisting — they become invalid after page reload
	const { audioUrl: _, ...persistable } = entry;
	const updated = [persistable, ...existing].slice(0, 20);
	localStorage.setItem(getStorageKey(slug), JSON.stringify(updated));
}

function formatTimeAgo(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export function GenerationHistory({ modelSlug }: GenerationHistoryProps) {
	const [entries, setEntries] = useState<HistoryEntry[]>([]);
	const [playingId, setPlayingId] = useState<string | null>(null);
	const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

	useEffect(() => {
		setEntries(getHistory(modelSlug));
	}, [modelSlug]);

	useEffect(() => {
		return () => {
			if (audio) {
				audio.pause();
				audio.src = "";
			}
		};
	}, [audio]);

	function handlePlay(entry: HistoryEntry) {
		const url = sessionAudioUrls.get(entry.id);
		if (!url) return;

		if (playingId === entry.id && audio) {
			audio.pause();
			setPlayingId(null);
			return;
		}

		if (audio) {
			audio.pause();
			audio.src = "";
		}

		const newAudio = new Audio(url);
		newAudio.addEventListener("ended", () => setPlayingId(null));
		newAudio.addEventListener("error", () => setPlayingId(null));
		newAudio.play().catch(() => setPlayingId(null));
		setAudio(newAudio);
		setPlayingId(entry.id);
	}

	function handleClear() {
		localStorage.removeItem(getStorageKey(modelSlug));
		setEntries([]);
		if (audio) {
			audio.pause();
			audio.src = "";
		}
		setPlayingId(null);
	}

	if (entries.length === 0) {
		return (
			<div className="space-y-3">
				<h3 className="text-sm font-medium text-muted-foreground">
					Recent generations
				</h3>
				<p className="text-sm text-muted-foreground/70">
					No generations yet. Generate speech above to see your history here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-muted-foreground">
					Recent generations
				</h3>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs text-muted-foreground"
					onClick={handleClear}
				>
					<X className="mr-1 h-3 w-3" />
					Clear
				</Button>
			</div>

			<div className="space-y-1.5">
				{entries.map((entry) => (
					<div
						key={entry.id}
						className={cn(
							"flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent/50",
							playingId === entry.id && "border-primary/50 bg-accent/50",
						)}
					>
						{sessionAudioUrls.has(entry.id) && (
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7 shrink-0"
								onClick={() => handlePlay(entry)}
								aria-label={playingId === entry.id ? "Stop" : "Play"}
							>
								{playingId === entry.id ? (
									<Volume2 className="h-3.5 w-3.5 text-primary" />
								) : (
									<Play className="h-3.5 w-3.5" />
								)}
							</Button>
						)}

						<div className="min-w-0 flex-1">
							<p className="truncate text-foreground">{entry.text}</p>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								{(entry.voiceName || entry.voice) && (
									<span>{entry.voiceName ?? entry.voice}</span>
								)}
								<span className="flex items-center gap-1">
									<Clock className="h-3 w-3" />
									{entry.generationTimeMs < 1000
										? `${entry.generationTimeMs}ms`
										: `${(entry.generationTimeMs / 1000).toFixed(1)}s`}
								</span>
								<span className="uppercase">{entry.backend}</span>
							</div>
						</div>

						{sessionAudioUrls.has(entry.id) && (
							<a
								href={sessionAudioUrls.get(entry.id)}
								download={`generation-${entry.id.slice(0, 8)}.wav`}
								className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
								aria-label="Download audio"
							>
								<Download className="h-3.5 w-3.5" />
							</a>
						)}

						<span className="shrink-0 text-xs text-muted-foreground">
							{formatTimeAgo(entry.timestamp)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
