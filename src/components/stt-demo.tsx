"use client";

import { Cpu, Mic, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ModelState, ModelStatus } from "@/components/model-status";
import { Button } from "@/components/ui/button";
import type { Model } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type SttDemoProps = {
	model: Model;
};

export function SttDemo({ model }: SttDemoProps) {
	const [modelState, setModelState] = useState<ModelState>({
		status: "not_loaded",
	});
	const [isRecording, setIsRecording] = useState(false);
	const [audioLevel, setAudioLevel] = useState(0);
	const [transcript, setTranscript] = useState("");
	const [recordingDuration, setRecordingDuration] = useState(0);
	const [comingSoon, setComingSoon] = useState(false);

	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const levelAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Clean up timers on unmount
	useEffect(() => {
		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
			if (levelAnimRef.current) clearInterval(levelAnimRef.current);
		};
	}, []);

	const handleDownload = useCallback(() => {
		setComingSoon(true);
		setTimeout(() => setComingSoon(false), 3000);
	}, []);

	const handleRetry = useCallback(() => {
		setModelState({ status: "not_loaded" });
	}, []);

	const startRecording = useCallback(() => {
		// MVP: Simulate recording UI without actual audio capture
		setIsRecording(true);
		setRecordingDuration(0);
		setTranscript("");

		timerRef.current = setInterval(() => {
			setRecordingDuration((prev) => prev + 100);
		}, 100);

		// Simulate audio level changes
		levelAnimRef.current = setInterval(() => {
			setAudioLevel(Math.random() * 0.8 + 0.1);
		}, 100);
	}, []);

	const stopRecording = useCallback(() => {
		setIsRecording(false);
		setAudioLevel(0);

		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (levelAnimRef.current) {
			clearInterval(levelAnimRef.current);
			levelAnimRef.current = null;
		}

		// MVP: Show coming soon
		setComingSoon(true);
		setTimeout(() => setComingSoon(false), 3000);
	}, []);

	const toggleRecording = useCallback(() => {
		if (isRecording) {
			stopRecording();
		} else {
			startRecording();
		}
	}, [isRecording, startRecording, stopRecording]);

	function formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	return (
		<div className="space-y-6">
			<ModelStatus
				state={modelState}
				modelName={model.name}
				sizeMb={model.sizeMb}
				onDownload={handleDownload}
				onRetry={handleRetry}
			/>

			<div className="flex flex-col items-center gap-6">
				{/* Record button */}
				<div className="relative">
					{isRecording && (
						<div className="absolute inset-0 animate-ping rounded-full bg-destructive/20" />
					)}
					<Button
						variant={isRecording ? "destructive" : "default"}
						size="lg"
						onClick={toggleRecording}
						className={cn(
							"relative h-20 w-20 rounded-full",
							isRecording && "shadow-lg shadow-destructive/25",
						)}
					>
						{isRecording ? (
							<div className="h-6 w-6 rounded-sm bg-destructive-foreground" />
						) : (
							<Mic className="h-8 w-8" />
						)}
					</Button>
				</div>

				<p className="text-sm text-muted-foreground">
					{isRecording ? "Click to stop recording" : "Click to start recording"}
				</p>

				{/* Recording duration */}
				{isRecording && (
					<div className="flex items-center gap-2 text-lg font-mono tabular-nums text-destructive">
						<span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
						{formatDuration(recordingDuration)}
					</div>
				)}

				{/* Audio level indicator */}
				{isRecording && (
					<div className="flex h-16 w-full max-w-xs items-end justify-center gap-1">
						{Array.from({ length: 20 }, (_, i) => {
							const barHeight = Math.max(
								4,
								Math.min(64, audioLevel * 64 * (0.5 + Math.random() * 0.5)),
							);
							return (
								<div
									key={i}
									className="w-2 rounded-full bg-primary/80 transition-all duration-75"
									style={{ height: `${barHeight}px` }}
								/>
							);
						})}
					</div>
				)}
			</div>

			{comingSoon && (
				<div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm text-primary">
					Coming soon -- inference pipeline is not wired up yet.
				</div>
			)}

			{/* Transcript output */}
			{transcript && (
				<div className="space-y-3">
					<h3 className="text-sm font-medium text-foreground">Transcript</h3>
					<div className="min-h-[80px] rounded-lg border border-border bg-secondary/30 p-4 text-sm leading-relaxed">
						{transcript}
					</div>
				</div>
			)}

			{/* Metrics */}
			{modelState.status === "result" && (
				<div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-secondary/30 p-4">
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Processing time</p>
						<p className="text-lg font-semibold tabular-nums">
							{modelState.metrics.totalMs < 1000
								? `${modelState.metrics.totalMs}ms`
								: `${(modelState.metrics.totalMs / 1000).toFixed(2)}s`}
						</p>
					</div>
					{modelState.metrics.audioDuration != null && (
						<div className="text-center">
							<p className="text-xs text-muted-foreground">Audio duration</p>
							<p className="text-lg font-semibold tabular-nums">
								{modelState.metrics.audioDuration.toFixed(2)}s
							</p>
						</div>
					)}
					<div className="text-center">
						<p className="text-xs text-muted-foreground">Backend</p>
						<p className="text-lg font-semibold">
							{modelState.metrics.backend === "webgpu" ? (
								<span className="inline-flex items-center gap-1">
									<Zap className="h-4 w-4 text-success" />
									WebGPU
								</span>
							) : (
								<span className="inline-flex items-center gap-1">
									<Cpu className="h-4 w-4 text-warning" />
									WASM
								</span>
							)}
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
