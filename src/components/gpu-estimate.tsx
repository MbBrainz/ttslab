import { Info } from "lucide-react";

type GpuEstimateProps = {
	totalMs: number;
	backend: string;
};

function formatEstimate(ms: number): string {
	const estimated = Math.round(ms / 10);
	if (estimated < 1000) return `~${estimated}ms`;
	return `~${(estimated / 1000).toFixed(1)}s`;
}

export function GpuEstimate({ totalMs, backend }: GpuEstimateProps) {
	if (backend !== "wasm") return null;

	return (
		<div className="text-center">
			<p className="text-xs text-muted-foreground">
				Est. GPU speed
				<span className="group relative ml-1 inline-block align-middle">
					<Info
						className="inline h-3.5 w-3.5 cursor-help text-muted-foreground"
						aria-hidden="true"
					/>
					<span
						className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-[280px] -translate-x-1/2 rounded-md bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md border border-border opacity-0 transition-opacity group-hover:opacity-100"
						role="tooltip"
					>
						This model ran on your CPU via WebAssembly. On a production GPU
						(e.g. NVIDIA A100), expect 5-20x faster inference speeds.
					</span>
				</span>
			</p>
			<p className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
				{formatEstimate(totalMs)}
			</p>
		</div>
	);
}
