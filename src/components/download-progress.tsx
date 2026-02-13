"use client";

import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatMegabytes, formatSpeed } from "@/lib/format";

type DownloadProgressProps = {
	progress: number;
	speed: number;
	total: number;
	downloaded: number;
	onCancel?: () => void;
};

export function DownloadProgress({
	progress,
	speed,
	total,
	downloaded,
	onCancel,
}: DownloadProgressProps) {
	const remaining = total - downloaded;
	const etaSeconds = speed > 0 ? remaining / speed : 0;
	const etaDisplay =
		etaSeconds < 60
			? `${Math.ceil(etaSeconds)}s`
			: `${Math.floor(etaSeconds / 60)}m ${Math.ceil(etaSeconds % 60)}s`;

	return (
		<div className="space-y-2 rounded-lg border border-border bg-card p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Download className="h-4 w-4 text-primary" />
					<span className="text-sm font-medium">Downloading model...</span>
				</div>
				<div className="flex items-center gap-3 text-xs text-muted-foreground">
					<span>
						{formatMegabytes(downloaded)} / {formatMegabytes(total)}
					</span>
					<span>{formatSpeed(speed)}</span>
					{speed > 0 && <span>ETA {etaDisplay}</span>}
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
			<Progress value={progress} max={100} />
			<div className="text-right text-xs tabular-nums text-muted-foreground">
				{progress.toFixed(1)}%
			</div>
		</div>
	);
}
