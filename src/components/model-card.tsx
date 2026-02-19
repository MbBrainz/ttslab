import {
	ArrowRight,
	BadgeCheck,
	Check,
	ChevronUp,
	Clock,
	Cpu,
	Download,
	FileAudio,
	Hash,
	Mic,
	Volume2,
	X,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { Model } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const VERIFIED_SLUGS = new Set(["kokoro-82m", "piper-en-us-lessac-medium"]);

type ModelCardProps = {
	model: Model;
	upvoteCount: number;
};

function StatusIcon({ status }: { status: Model["status"] }) {
	switch (status) {
		case "supported":
			return <Check className="h-4 w-4 text-success" aria-label="Supported" />;
		case "planned":
			return <Clock className="h-4 w-4 text-warning" aria-label="Planned" />;
		case "unsupported":
			return <X className="h-4 w-4 text-destructive" aria-label="Not supported" />;
	}
}

export function ModelCard({ model, upvoteCount }: ModelCardProps) {
	return (
		<Link href={`/models/${model.slug}`} className="group block">
			<Card className="h-full transition-colors hover:border-primary/50 hover:bg-card/80">
				<CardHeader className="pb-3">
					<div className="flex items-start justify-between gap-2">
						<div className="flex items-center gap-2">
							<Badge
								variant={model.type === "tts" ? "default" : "secondary"}
								className="gap-1"
							>
								{model.type === "tts" ? (
									<Volume2 className="h-3 w-3" />
								) : (
									<Mic className="h-3 w-3" />
								)}
								{model.type.toUpperCase()}
							</Badge>
							<StatusIcon status={model.status} />
						</div>
						<div className="flex items-center gap-1 text-sm text-muted-foreground">
							<ChevronUp className="h-4 w-4" />
							<span>{upvoteCount}</span>
						</div>
					</div>
					<CardTitle className="mt-2 flex items-center gap-1.5 group-hover:text-primary transition-colors">
						{model.name}
						{VERIFIED_SLUGS.has(model.slug) && (
							<span
								title="Verified by the ttslab.dev team to work well on TTSLab"
								className="inline-flex cursor-help"
							>
								<BadgeCheck className="h-4 w-4 text-primary" />
							</span>
						)}
					</CardTitle>
					{model.description && (
						<p className="text-sm text-muted-foreground line-clamp-2">
							{model.description}
						</p>
					)}
				</CardHeader>

				<CardContent>
					<div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
						{model.sizeMb != null && (
							<span className="flex items-center gap-1">
								<Download className="h-3 w-3" />
								{model.sizeMb < 1024
									? `${model.sizeMb.toFixed(0)} MB`
									: `${(model.sizeMb / 1024).toFixed(1)} GB`}
							</span>
						)}
						{model.paramsMillions != null && (
							<span className="flex items-center gap-1">
								<Hash className="h-3 w-3" />
								{model.paramsMillions}M params
							</span>
						)}
						{model.voices != null && model.voices > 0 && (
							<span className="flex items-center gap-1">
								<FileAudio className="h-3 w-3" />
								{model.voices} voice{model.voices !== 1 ? "s" : ""}
							</span>
						)}
					</div>

					<div className="mt-3 flex flex-wrap gap-1.5">
						{model.supportsWebgpu && (
							<Badge
								variant="success"
								className="gap-1 text-[10px] px-1.5 py-0"
							>
								<Zap className="h-2.5 w-2.5" />
								WebGPU
							</Badge>
						)}
						{model.supportsWasm && (
							<Badge
								variant="warning"
								className="gap-1 text-[10px] px-1.5 py-0"
							>
								<Cpu className="h-2.5 w-2.5" />
								WASM
							</Badge>
						)}
					</div>
				</CardContent>

				{model.status === "supported" && (
					<CardFooter>
						<span
							className={cn(
								"inline-flex items-center gap-1 text-sm font-medium text-primary",
								"opacity-0 translate-x-[-4px] transition-all group-hover:opacity-100 group-hover:translate-x-0",
							)}
						>
							Try it <ArrowRight className="h-4 w-4" />
						</span>
					</CardFooter>
				)}
			</Card>
		</Link>
	);
}
