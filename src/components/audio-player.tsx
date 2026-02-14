"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AudioPlayerProps = {
	audioUrl: string | null;
	duration?: number;
};

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ audioUrl, duration }: AudioPlayerProps) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [totalDuration, setTotalDuration] = useState(duration ?? 0);

	useEffect(() => {
		setIsPlaying(false);
		setCurrentTime(0);
	}, []);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		function handleTimeUpdate() {
			setCurrentTime(audio?.currentTime ?? 0);
		}

		function handleLoadedMetadata() {
			if (audio?.duration != null && Number.isFinite(audio.duration)) {
				setTotalDuration(audio.duration);
			}
		}

		function handleEnded() {
			setIsPlaying(false);
			setCurrentTime(0);
		}

		audio.addEventListener("timeupdate", handleTimeUpdate);
		audio.addEventListener("loadedmetadata", handleLoadedMetadata);
		audio.addEventListener("ended", handleEnded);

		return () => {
			audio.removeEventListener("timeupdate", handleTimeUpdate);
			audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
			audio.removeEventListener("ended", handleEnded);
		};
	}, []);

	const togglePlayPause = useCallback(() => {
		const audio = audioRef.current;
		if (!audio || !audioUrl) return;

		if (isPlaying) {
			audio.pause();
			setIsPlaying(false);
		} else {
			audio.play();
			setIsPlaying(true);
		}
	}, [isPlaying, audioUrl]);

	const handleScrub = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const audio = audioRef.current;
			const bar = progressRef.current;
			if (!audio || !bar || !audioUrl) return;

			const rect = bar.getBoundingClientRect();
			const percent = Math.max(
				0,
				Math.min(1, (e.clientX - rect.left) / rect.width),
			);
			const newTime = percent * totalDuration;
			audio.currentTime = newTime;
			setCurrentTime(newTime);
		},
		[totalDuration, audioUrl],
	);

	const progressPercent =
		totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

	if (!audioUrl) {
		return (
			<div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
				No audio available
			</div>
		);
	}

	return (
		<div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3">
			{audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}

			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8 shrink-0"
				onClick={togglePlayPause}
			>
				{isPlaying ? (
					<Pause className="h-4 w-4" />
				) : (
					<Play className="h-4 w-4" />
				)}
			</Button>

			<div
				ref={progressRef}
				className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-secondary"
				onClick={handleScrub}
			>
				<div
					className="absolute left-0 top-0 h-full rounded-full bg-primary transition-[width] duration-100"
					style={{ width: `${progressPercent}%` }}
				/>
				<div
					className={cn(
						"absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-primary shadow-sm transition-[left] duration-100",
						progressPercent === 0 && "opacity-50",
					)}
					style={{ left: `${progressPercent}%` }}
				/>
			</div>

			<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
				{formatTime(currentTime)} / {formatTime(totalDuration)}
			</span>
		</div>
	);
}
