export class PerformanceTimer {
	private startTime = 0;
	private firstByteTime: number | null = null;

	start(): void {
		this.startTime = performance.now();
		this.firstByteTime = null;
	}

	markFirstByte(): void {
		if (!this.firstByteTime) {
			this.firstByteTime = performance.now() - this.startTime;
		}
	}

	elapsed(): number {
		return performance.now() - this.startTime;
	}

	stop(): { totalMs: number; firstByteMs?: number } {
		const totalMs = performance.now() - this.startTime;
		return {
			totalMs: Math.round(totalMs),
			firstByteMs: this.firstByteTime
				? Math.round(this.firstByteTime)
				: undefined,
		};
	}
}

export function calculateRTF(
	generationMs: number,
	audioDurationS: number,
): number {
	if (generationMs <= 0 || audioDurationS <= 0) return 0;
	return Number.parseFloat((audioDurationS / (generationMs / 1000)).toFixed(1));
}

export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
