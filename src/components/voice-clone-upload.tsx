"use client";

import { Loader2, Mic, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decodeAudioToPCM } from "@/lib/inference/speaker-embedding";

type VoiceCloneUploadProps = {
	/** Called with the embedding blob URL when ready, or null when cleared. */
	onEmbeddingReady: (embeddingUrl: string | null) => void;
	/** Extract embedding via the inference worker (runs ONNX in worker thread). */
	extractEmbedding: (
		audio: Float32Array,
		sampleRate: number,
	) => Promise<string>;
	disabled?: boolean;
};

type State =
	| { status: "idle" }
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

	const handleFile = useCallback(
		async (file: File) => {
			setState({
				status: "processing",
				fileName: file.name,
				progress: "Decoding audio...",
			});

			try {
				// 1. Decode audio to PCM on main thread (AudioContext)
				const { audio, sampleRate } = await decodeAudioToPCM(file);

				setState((prev) =>
					prev.status === "processing"
						? { ...prev, progress: "Extracting speaker embedding..." }
						: prev,
				);

				// 2. Extract embedding in the inference worker (ONNX WASM)
				const url = await extractEmbedding(audio, sampleRate);

				// Revoke previous embedding URL if any
				if (embeddingUrlRef.current) {
					URL.revokeObjectURL(embeddingUrlRef.current);
				}
				embeddingUrlRef.current = url;

				setState({ status: "ready", fileName: file.name, embeddingUrl: url });
				onEmbeddingReady(url);
			} catch (err) {
				setState({
					status: "error",
					fileName: file.name,
					message:
						err instanceof Error ? err.message : "Failed to process audio",
				});
			}
		},
		[onEmbeddingReady, extractEmbedding],
	);

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
				<Button
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() => inputRef.current?.click()}
				>
					<Mic className="size-3.5" />
					Clone voice
				</Button>
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
