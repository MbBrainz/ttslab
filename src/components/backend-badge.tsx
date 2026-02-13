import { Cpu, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BackendBadgeProps = {
	backend: "webgpu" | "wasm";
	supported?: boolean;
};

export function BackendBadge({ backend, supported = true }: BackendBadgeProps) {
	if (!supported) {
		return (
			<Badge variant="outline" className="gap-1 opacity-50">
				{backend === "webgpu" ? (
					<Zap className="h-3 w-3" />
				) : (
					<Cpu className="h-3 w-3" />
				)}
				<span className="line-through">
					{backend === "webgpu" ? "WebGPU" : "WASM"}
				</span>
			</Badge>
		);
	}

	return (
		<Badge
			variant={backend === "webgpu" ? "success" : "warning"}
			className={cn("gap-1")}
		>
			{backend === "webgpu" ? (
				<Zap className="h-3 w-3" />
			) : (
				<Cpu className="h-3 w-3" />
			)}
			{backend === "webgpu" ? "WebGPU" : "WASM"}
		</Badge>
	);
}
