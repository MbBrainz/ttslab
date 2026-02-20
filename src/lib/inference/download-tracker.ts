import type { DownloadProgress } from "@/lib/inference/types";
import type { ModelState } from "@/components/model-status";

/**
 * Creates a throttled download progress tracker that aggregates multi-file
 * progress, calculates smoothed speed, and rate-limits UI updates to 500ms.
 *
 * Usage:
 *   const tracker = createDownloadTracker();
 *   onProgress: (p) => {
 *     const state = tracker.process(p);
 *     if (state) setModelState(state);
 *   }
 */
export function createDownloadTracker(estimatedBytes = 0) {
	const fileMap = new Map<string, { loaded: number; total: number }>();
	let lastDisplayTime = 0;
	let smoothSpeed = 0;
	const loadStart = performance.now();

	return {
		/**
		 * Process a download progress event. Returns a ModelState to apply,
		 * or null if throttled (< 500ms since last update).
		 */
		process(progress: DownloadProgress): (ModelState & { status: "downloading" | "initializing" }) | null {
			fileMap.set(progress.file, {
				loaded: progress.loaded,
				total: progress.total,
			});

			let downloadedBytes = 0;
			let totalBytes = 0;
			for (const fp of fileMap.values()) {
				downloadedBytes += fp.loaded;
				totalBytes += fp.total;
			}
			if (totalBytes === 0) totalBytes = estimatedBytes;

			// When download completes, show initializing immediately
			if (downloadedBytes >= totalBytes && totalBytes > 0) {
				return { status: "initializing" };
			}

			// Throttle UI updates to every 500ms
			const now = performance.now();
			const dt = (now - lastDisplayTime) / 1000;
			if (dt < 0.5 && downloadedBytes < totalBytes) return null;

			const elapsed = (now - loadStart) / 1000;
			const speed = elapsed > 0 ? downloadedBytes / elapsed : 0;
			smoothSpeed = smoothSpeed === 0 ? speed : smoothSpeed * 0.7 + speed * 0.3;
			lastDisplayTime = now;

			const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

			return {
				status: "downloading",
				progress: pct,
				speed: smoothSpeed,
				total: totalBytes,
				downloaded: downloadedBytes,
			};
		},
	};
}
