/**
 * Format a size in megabytes to a human-readable string.
 * Example: 0.5 -> "512 KB", 75 -> "75.0 MB", 2048 -> "2.00 GB"
 */
export function formatMegabytes(mb: number): string {
	if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
	if (mb < 1024) return `${mb.toFixed(1)} MB`;
	return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Format a size in bytes to a human-readable string.
 * Example: 512 -> "512 B", 1536 -> "1.5 KB", 1048576 -> "1.0 MB"
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Example: 500 -> "500ms", 1500 -> "1.5s"
 */
export function formatMs(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a duration in seconds to "M:SS" format.
 */
export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}
