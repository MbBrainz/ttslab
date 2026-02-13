"use client";

import {
	Check,
	Clock,
	Cpu,
	Download,
	Loader2,
	RotateCcw,
	X,
	Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type ModelState =
	| { status: "not_loaded" }
	| {
			status: "downloading";
			progress: number;
			speed: number;
			total: number;
			downloaded: number;
	  }
	| { status: "initializing" }
	| {
			status: "ready";
			backend: "webgpu" | "wasm";
			loadTime: number;
	  }
	| {
			status: "processing";
			elapsed: number;
			type: "tts" | "stt";
			progress?: number;
	  }
	| {
			status: "result";
			metrics: {
				totalMs: number;
				audioDuration?: number;
				rtf?: number;
				backend: "webgpu" | "wasm";
			};
	  }
	| {
			status: "error";
			code: string;
			message: string;
			recoverable: boolean;
	  };

type ModelStatusProps = {
	state: ModelState;
	modelName: string;
	sizeMb: number | null;
	onDownload?: () => void;
	onRetry?: () => void;
	onCancel?: () => void;
};

function formatBytes(mb: number): string {
	if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
	if (mb < 1024) return `${mb.toFixed(1)} MB`;
	return `${(mb / 1024).toFixed(2)} GB`;
}

function formatSpeed(mbPerSec: number): string {
	if (mbPerSec < 1) return `${(mbPerSec * 1024).toFixed(0)} KB/s`;
	return `${mbPerSec.toFixed(1)} MB/s`;
}

function formatTime(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function StatusDot({
	color,
	animate = false,
	pulse = false,
}: {
	color: string;
	animate?: boolean;
	pulse?: boolean;
}) {
	return (
		<span className="relative flex h-3 w-3">
			{(animate || pulse) && (
				<span
					className={cn(
						"absolute inline-flex h-full w-full rounded-full opacity-75",
						pulse ? "animate-ping" : "animate-pulse",
						color,
					)}
				/>
			)}
			<span
				className={cn("relative inline-flex h-3 w-3 rounded-full", color)}
			/>
		</span>
	);
}

function NotLoadedState({
	sizeMb,
	onDownload,
}: {
	sizeMb: number | null;
	onDownload?: () => void;
}) {
	return (
		<div className="flex items-center gap-3">
			<StatusDot color="bg-muted-foreground" />
			<div className="flex flex-1 items-center gap-2">
				<span className="text-sm text-muted-foreground">Not loaded</span>
				{sizeMb != null && (
					<span className="text-xs text-muted-foreground">
						({formatBytes(sizeMb)})
					</span>
				)}
			</div>
			{onDownload && (
				<Button variant="outline" size="sm" onClick={onDownload}>
					<Download className="h-4 w-4" />
					Download
				</Button>
			)}
		</div>
	);
}

function DownloadingState({
	progress,
	speed,
	total,
	downloaded,
	onCancel,
}: {
	progress: number;
	speed: number;
	total: number;
	downloaded: number;
	onCancel?: () => void;
}) {
	const remaining = total - downloaded;
	const etaSeconds = speed > 0 ? remaining / speed : 0;
	const etaDisplay =
		etaSeconds < 60
			? `${Math.ceil(etaSeconds)}s`
			: `${Math.floor(etaSeconds / 60)}m ${Math.ceil(etaSeconds % 60)}s`;

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-3">
				<StatusDot color="bg-primary" animate />
				<div className="flex flex-1 items-center justify-between">
					<span className="text-sm font-medium">Downloading...</span>
					<div className="flex items-center gap-3">
						<span className="text-xs text-muted-foreground">
							{formatBytes(downloaded)} / {formatBytes(total)}
						</span>
						<span className="text-xs text-muted-foreground">
							{formatSpeed(speed)}
						</span>
						{speed > 0 && (
							<span className="text-xs text-muted-foreground">
								ETA {etaDisplay}
							</span>
						)}
						{onCancel && (
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6"
								onClick={onCancel}
							>
								<X className="h-3 w-3" />
							</Button>
						)}
					</div>
				</div>
			</div>
			<Progress value={progress} max={100} />
		</div>
	);
}

function InitializingState() {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-3">
				<StatusDot color="bg-warning" animate />
				<div className="flex flex-1 items-center gap-2">
					<Loader2 className="h-4 w-4 animate-spin text-warning" />
					<span className="text-sm font-medium">Initializing...</span>
				</div>
				<span className="text-xs text-muted-foreground">
					Compiling shaders...
				</span>
			</div>
			<div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
				<div className="h-full w-full origin-left animate-pulse rounded-full bg-warning/60" />
			</div>
		</div>
	);
}

function ReadyState({
	backend,
	loadTime,
}: {
	backend: "webgpu" | "wasm";
	loadTime: number;
}) {
	return (
		<div className="flex items-center gap-3">
			<StatusDot color="bg-success" />
			<div className="flex flex-1 items-center gap-2">
				<Check className="h-4 w-4 text-success" />
				<span className="text-sm font-medium text-success">Ready</span>
			</div>
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				{backend === "webgpu" ? (
					<span className="flex items-center gap-1">
						<Zap className="h-3 w-3 text-success" />
						WebGPU
					</span>
				) : (
					<span className="flex items-center gap-1">
						<Cpu className="h-3 w-3 text-warning" />
						WASM
					</span>
				)}
				<span>
					<Clock className="mr-1 inline h-3 w-3" />
					{formatTime(loadTime)}
				</span>
			</div>
		</div>
	);
}

function ProcessingState({
	elapsed,
	type,
	progress,
}: {
	elapsed: number;
	type: "tts" | "stt";
	progress?: number;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-3">
				<StatusDot color="bg-success" pulse />
				<div className="flex flex-1 items-center gap-2">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span className="text-sm font-medium">
						{type === "tts" ? "Generating speech..." : "Transcribing audio..."}
					</span>
				</div>
				<span className="text-xs tabular-nums text-muted-foreground">
					{formatTime(elapsed)}
				</span>
			</div>
			{progress != null && <Progress value={progress} max={100} />}
		</div>
	);
}

function ResultState({
	metrics,
}: {
	metrics: {
		totalMs: number;
		audioDuration?: number;
		rtf?: number;
		backend: "webgpu" | "wasm";
	};
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-3">
				<Check className="h-5 w-5 text-success" />
				<span className="text-sm font-medium text-success">Complete</span>
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-secondary/50 p-3 text-xs">
				<span className="text-muted-foreground">Total time</span>
				<span className="text-right font-mono tabular-nums">
					{formatTime(metrics.totalMs)}
				</span>

				{metrics.audioDuration != null && (
					<>
						<span className="text-muted-foreground">Audio duration</span>
						<span className="text-right font-mono tabular-nums">
							{metrics.audioDuration.toFixed(2)}s
						</span>
					</>
				)}

				{metrics.rtf != null && (
					<>
						<span className="text-muted-foreground">RTF</span>
						<span className="text-right font-mono tabular-nums">
							{metrics.rtf.toFixed(3)}x
						</span>
					</>
				)}

				<span className="text-muted-foreground">Backend</span>
				<span className="text-right">
					{metrics.backend === "webgpu" ? (
						<span className="inline-flex items-center gap-1">
							<Zap className="h-3 w-3 text-success" />
							WebGPU
						</span>
					) : (
						<span className="inline-flex items-center gap-1">
							<Cpu className="h-3 w-3 text-warning" />
							WASM
						</span>
					)}
				</span>
			</div>
		</div>
	);
}

function ErrorState({
	code,
	message,
	recoverable,
	onRetry,
}: {
	code: string;
	message: string;
	recoverable: boolean;
	onRetry?: () => void;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-3">
				<X className="h-5 w-5 text-destructive" />
				<div className="flex flex-1 flex-col">
					<span className="text-sm font-medium text-destructive">Error</span>
					<span className="text-xs text-muted-foreground">
						[{code}] {message}
					</span>
				</div>
				{recoverable && onRetry && (
					<Button variant="outline" size="sm" onClick={onRetry}>
						<RotateCcw className="h-4 w-4" />
						Retry
					</Button>
				)}
			</div>
		</div>
	);
}

export function ModelStatus({
	state,
	modelName,
	sizeMb,
	onDownload,
	onRetry,
	onCancel,
}: ModelStatusProps) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				{modelName}
			</div>

			{state.status === "not_loaded" && (
				<NotLoadedState sizeMb={sizeMb} onDownload={onDownload} />
			)}

			{state.status === "downloading" && (
				<DownloadingState
					progress={state.progress}
					speed={state.speed}
					total={state.total}
					downloaded={state.downloaded}
					onCancel={onCancel}
				/>
			)}

			{state.status === "initializing" && <InitializingState />}

			{state.status === "ready" && (
				<ReadyState backend={state.backend} loadTime={state.loadTime} />
			)}

			{state.status === "processing" && (
				<ProcessingState
					elapsed={state.elapsed}
					type={state.type}
					progress={state.progress}
				/>
			)}

			{state.status === "result" && <ResultState metrics={state.metrics} />}

			{state.status === "error" && (
				<ErrorState
					code={state.code}
					message={state.message}
					recoverable={state.recoverable}
					onRetry={onRetry}
				/>
			)}
		</div>
	);
}
