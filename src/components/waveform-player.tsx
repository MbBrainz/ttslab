"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WaveformPlayerProps = {
	audioUrl: string | null;
	duration?: number;
};

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function WaveformPlayer({ audioUrl, duration }: WaveformPlayerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const wavesurferRef = useRef<WaveSurfer | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [totalDuration, setTotalDuration] = useState(duration ?? 0);
	const [speedIndex, setSpeedIndex] = useState(2); // default 1x
	const [isReady, setIsReady] = useState(false);

	// Create / destroy wavesurfer when audioUrl changes
	useEffect(() => {
		if (!containerRef.current || !audioUrl) {
			// Clean up if audioUrl becomes null
			if (wavesurferRef.current) {
				try {
					wavesurferRef.current.destroy();
				} catch {
					// AbortError expected when destroying during pending fetch
				}
				wavesurferRef.current = null;
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setIsReady(false);
			return;
		}

		const ws = WaveSurfer.create({
			container: containerRef.current,
			height: 48,
			waveColor: "hsl(var(--muted-foreground) / 0.3)",
			progressColor: "hsl(var(--primary))",
			cursorColor: "hsl(var(--primary))",
			barWidth: 2,
			barGap: 1,
			barRadius: 2,
			normalize: true,
		});

		ws.load(audioUrl);

		ws.on("ready", () => {
			setTotalDuration(ws.getDuration());
			setIsReady(true);
			ws.setPlaybackRate(PLAYBACK_SPEEDS[2], true);
		});

		ws.on("timeupdate", (time: number) => {
			setCurrentTime(time);
		});

		ws.on("finish", () => {
			setIsPlaying(false);
			setCurrentTime(0);
		});

		ws.on("play", () => setIsPlaying(true));
		ws.on("pause", () => setIsPlaying(false));

		wavesurferRef.current = ws;

		return () => {
			try {
				ws.destroy();
			} catch {
				// AbortError expected when destroying during pending fetch
			}
			wavesurferRef.current = null;
			setIsPlaying(false);
			setCurrentTime(0);
			setIsReady(false);
		};
	}, [audioUrl]);

	// Sync duration prop
	useEffect(() => {
		if (duration != null && !isReady) {
			setTotalDuration(duration);
		}
	}, [duration, isReady]);

	const togglePlayPause = useCallback(() => {
		const ws = wavesurferRef.current;
		if (!ws || !isReady) return;
		ws.playPause();
	}, [isReady]);

	const cycleSpeed = useCallback(() => {
		const ws = wavesurferRef.current;
		const nextIndex = (speedIndex + 1) % PLAYBACK_SPEEDS.length;
		setSpeedIndex(nextIndex);
		if (ws) {
			ws.setPlaybackRate(PLAYBACK_SPEEDS[nextIndex], true);
		}
	}, [speedIndex]);

	if (!audioUrl) {
		return (
			<div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
				No audio available
			</div>
		);
	}

	return (
		<div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3">
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8 shrink-0"
				onClick={togglePlayPause}
				aria-label={isPlaying ? "Pause" : "Play"}
				disabled={!isReady}
			>
				{isPlaying ? (
					<Pause className="h-4 w-4" />
				) : (
					<Play className="h-4 w-4" />
				)}
			</Button>

			<div
				ref={containerRef}
				className={cn(
					"min-w-0 flex-1",
					!isReady && "opacity-50",
				)}
			/>

			<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
				{formatTime(currentTime)} / {formatTime(totalDuration)}
			</span>

			<Button
				variant="ghost"
				size="sm"
				className="h-7 shrink-0 px-2 text-xs tabular-nums text-muted-foreground"
				onClick={cycleSpeed}
				aria-label={`Playback speed ${PLAYBACK_SPEEDS[speedIndex]}x`}
			>
				{PLAYBACK_SPEEDS[speedIndex]}x
			</Button>
		</div>
	);
}
