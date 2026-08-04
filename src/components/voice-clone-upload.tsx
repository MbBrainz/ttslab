"use client";

import { Loader2, Mic, MicOff, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decodeAudioToPCM } from "@/lib/inference/speaker-embedding";
import type { DownloadProgress } from "@/lib/inference/types";
import { pickRecordingMimeType } from "@/lib/recording-mime";

const EXTRACTING_LABEL = "Extracting speaker embedding...";

type FileProgress = Map<string, { loaded: number; total: number }>;

// Below this, only config/tokenizer files have reported — the ~100MB model
// weights haven't joined the denominator yet, so a percentage would be misleading.
const MIN_AGGREGATE_TOTAL_BYTES = 1_000_000;

function aggregatePercent(files: FileProgress): number {
	let loaded = 0;
	let total = 0;
	for (const entry of files.values()) {
		loaded += entry.loaded;
		total += entry.total;
	}
	if (total < MIN_AGGREGATE_TOTAL_BYTES) return -1;
	return Math.min(100, Math.round((loaded / total) * 100));
}

type VoiceCloneUploadProps = {
	/** Called with the embedding blob URL when ready, or null when cleared. */
	onEmbeddingReady: (embeddingUrl: string | null) => void;
	/** Extract embedding via the inference worker (runs ONNX in worker thread). */
	extractEmbedding: (
		audio: Float32Array,
		sampleRate: number,
		onProgress?: (progress: DownloadProgress) => void,
	) => Promise<string>;
	disabled?: boolean;
};

type State =
	| { status: "idle" }
	| { status: "recording"; duration: number }
	| { status: "processing"; fileName: string; progress: string }
	| { status: "ready"; fileName: string; embeddingUrl: string }
	| { status: "error"; fileName: string; message: string };

export function VoiceCloneUpload({
	onEmbeddingReady,
	extractEmbedding,
	disabled,
}: VoiceCloneUploadProps) {
	const [state, setState] = useState<State>({ status: "idle" });
	const inputRef = useRef<HTMLInputElement>(null);
	const embeddingUrlRef = useRef<string | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const streamRef = useRef<MediaStream | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const downloadFilesRef = useRef<FileProgress>(new Map());
	const lastPercentRef = useRef(-1);

	const MAX_RECORDING_SECONDS = 30;

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (autoStopRef.current) clearTimeout(autoStopRef.current);
			if (timerRef.current) clearInterval(timerRef.current);
			const recorder = mediaRecorderRef.current;
			if (recorder) {
				recorder.onstop = null;
				recorder.ondataavailable = null;
				if (recorder.state !== "inactive") recorder.stop();
			}
			if (streamRef.current) {
				streamRef.current.getTracks().forEach((t) => t.stop());
			}
		};
	}, []);

	const setProgressLine = useCallback((progress: string) => {
		setState((prev) =>
			prev.status === "processing" ? { ...prev, progress } : prev,
		);
	}, []);

	const handleDownloadProgress = useCallback(
		(progress: DownloadProgress) => {
			if (progress.status !== "downloading" || !progress.total) {
				lastPercentRef.current = -1;
				setProgressLine(EXTRACTING_LABEL);
				return;
			}

			downloadFilesRef.current.set(progress.file, {
				loaded: progress.loaded,
				total: progress.total,
			});

			const percent = aggregatePercent(downloadFilesRef.current);
			if (percent < 0) {
				setProgressLine(EXTRACTING_LABEL);
				return;
			}
			if (percent === lastPercentRef.current) return;
			lastPercentRef.current = percent;
			setProgressLine(
				`Downloading voice encoder — ${percent}% (first time only)`,
			);
		},
		[setProgressLine],
	);

	const processAudio = useCallback(
		async (audioBlob: Blob, fileName: string) => {
			setState({
				status: "processing",
				fileName,
				progress: "Decoding audio...",
			});
			downloadFilesRef.current.clear();
			lastPercentRef.current = -1;

			try {
				const { audio, sampleRate } = await decodeAudioToPCM(audioBlob);

				setProgressLine(EXTRACTING_LABEL);

				const url = await extractEmbedding(
					audio,
					sampleRate,
					handleDownloadProgress,
				);

				if (embeddingUrlRef.current) {
					URL.revokeObjectURL(embeddingUrlRef.current);
				}
				embeddingUrlRef.current = url;

				setState({ status: "ready", fileName, embeddingUrl: url });
				onEmbeddingReady(url);
			} catch (err) {
				setState({
					status: "error",
					fileName,
					message:
						err instanceof Error ? err.message : "Failed to process audio",
				});
			}
		},
		[onEmbeddingReady, extractEmbedding, setProgressLine, handleDownloadProgress],
	);

	const handleFile = useCallback(
		async (file: File) => {
			await processAudio(file, file.name);
		},
		[processAudio],
	);

	const startRecording = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			streamRef.current = stream;
			audioChunksRef.current = [];

			const mimeType = pickRecordingMimeType();
			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType } : undefined,
			);
			mediaRecorderRef.current = recorder;

			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) audioChunksRef.current.push(e.data);
			};

			recorder.onstop = async () => {
				if (autoStopRef.current) {
					clearTimeout(autoStopRef.current);
					autoStopRef.current = null;
				}
				if (timerRef.current) {
					clearInterval(timerRef.current);
					timerRef.current = null;
				}
				stream.getTracks().forEach((t) => t.stop());
				streamRef.current = null;

				if (audioChunksRef.current.length === 0) {
					setState({ status: "idle" });
					return;
				}

				const blob = new Blob(
					audioChunksRef.current,
					mimeType ? { type: mimeType } : undefined,
				);
				await processAudio(blob, "Microphone recording");
			};

			recorder.start();
			setState({ status: "recording", duration: 0 });

			// Auto-stop after max duration
			autoStopRef.current = setTimeout(() => {
				if (mediaRecorderRef.current?.state === "recording") {
					mediaRecorderRef.current.stop();
				}
			}, MAX_RECORDING_SECONDS * 1000);

			// Update duration every second
			timerRef.current = setInterval(() => {
				setState((prev) =>
					prev.status === "recording"
						? { ...prev, duration: prev.duration + 1 }
						: prev,
				);
			}, 1000);
		} catch {
			setState({
				status: "error",
				fileName: "Microphone",
				message: "Microphone access denied",
			});
		}
	}, [processAudio]);

	const stopRecording = useCallback(() => {
		if (mediaRecorderRef.current?.state === "recording") {
			mediaRecorderRef.current.stop();
		}
	}, []);

	const handleClear = useCallback(() => {
		if (embeddingUrlRef.current) {
			URL.revokeObjectURL(embeddingUrlRef.current);
			embeddingUrlRef.current = null;
		}
		setState({ status: "idle" });
		onEmbeddingReady(null);
		if (inputRef.current) {
			inputRef.current.value = "";
		}
	}, [onEmbeddingReady]);

	const formatDuration = (seconds: number) => {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${s.toString().padStart(2, "0")}`;
	};

	return (
		<div className="flex items-center gap-2">
			<input
				ref={inputRef}
				type="file"
				accept="audio/*"
				className="hidden"
				disabled={disabled || state.status === "processing"}
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) handleFile(file);
				}}
			/>

			{state.status === "idle" && (
				<>
					<Button
						variant="outline"
						size="sm"
						disabled={disabled}
						onClick={() => inputRef.current?.click()}
					>
						<Upload className="size-3.5" />
						Upload voice
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={disabled}
						onClick={startRecording}
					>
						<Mic className="size-3.5" />
						Record voice
					</Button>
				</>
			)}

			{state.status === "recording" && (
				<div className="flex items-center gap-2">
					<Button
						variant="destructive"
						size="sm"
						onClick={stopRecording}
					>
						<MicOff className="size-3.5" />
						Stop
					</Button>
					<span className="text-xs text-muted-foreground flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-red-500 animate-pulse" />
						Recording {formatDuration(state.duration)}
					</span>
				</div>
			)}

			{state.status === "processing" && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					<span className="truncate max-w-[160px]">{state.progress}</span>
				</div>
			)}

			{state.status === "ready" && (
				<div className="flex items-center gap-1.5">
					<Badge variant="success" className="gap-1 text-[11px]">
						<Mic className="size-3" />
						Custom voice
					</Badge>
					<span className="text-xs text-muted-foreground truncate max-w-[120px]">
						{state.fileName}
					</span>
					<button
						type="button"
						onClick={handleClear}
						disabled={disabled}
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						<X className="size-3.5" />
					</button>
				</div>
			)}

			{state.status === "error" && (
				<div className="flex items-center gap-1.5">
					<Badge variant="destructive" className="text-[11px]">
						Error
					</Badge>
					<span className="text-xs text-muted-foreground truncate max-w-[140px]">
						{state.message}
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-1.5"
						onClick={() => inputRef.current?.click()}
					>
						<Upload className="size-3" />
					</Button>
					<button
						type="button"
						onClick={handleClear}
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						<X className="size-3.5" />
					</button>
				</div>
			)}
		</div>
	);
}
