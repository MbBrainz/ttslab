import { ExternalLink, Gauge, ListChecks, Play } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SubscribeForm } from "@/components/subscribe-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
	title: "Benchmarks — Published In-Browser TTS & STT Performance, Attributed",
	description:
		"What TTSLab measures (RTF for TTS, tokens/sec for LLMs, WER for STT) and an honest table of external, published in-browser performance measurements — each with its source. Run the live demos for your own hardware.",
	alternates: {
		canonical: "/benchmark",
	},
};

type MeasurementRow = {
	model: string;
	metric: string;
	result: string;
	context: string;
	sourceLabel: string;
	sourceHref: string;
};

// Every row is an external, PUBLISHED measurement. No TTSLab-run numbers
// appear here — in-browser performance depends on the visitor's hardware,
// so this table only cites results whose methodology is published.
const measurements: MeasurementRow[] = [
	{
		model: "Kokoro-82M — WebGPU backend",
		metric: "Real-time factor (RTF)",
		result: "0.105 — about 9.5x faster than real time",
		context: "Apple M1 Max, in-browser",
		sourceLabel: "briantung.me, Aug 2026",
		sourceHref: "https://briantung.me/blog/tts-engines-in-the-browser/",
	},
	{
		model: "Kokoro-82M — single-thread WASM (q8)",
		metric: "Real-time factor (RTF)",
		result: "2.002 — about half of real time",
		context: "Apple M1 Max, in-browser (same machine as the WebGPU row)",
		sourceLabel: "briantung.me, Aug 2026",
		sourceHref: "https://briantung.me/blog/tts-engines-in-the-browser/",
	},
	{
		model: "Llama-3.1-8B via WebLLM",
		metric: "Decode speed",
		result: "41.1 tokens/sec — roughly 71% of native Metal performance",
		context: "Apple M3 Max, in-browser",
		sourceLabel: "WebLLM paper (arXiv 2412.15803)",
		sourceHref: "https://arxiv.org/abs/2412.15803",
	},
	{
		model: "Whisper tiny / base via whisper.cpp",
		metric: "Transcription speed",
		result: "Roughly 2-3x faster than real time on modern CPUs",
		context: "WASM / CPU, in-browser",
		sourceLabel: "whisper.cpp README",
		sourceHref: "https://github.com/ggml-org/whisper.cpp",
	},
	{
		model: "Moonshine",
		metric: "CPU transcription latency",
		result:
			"Paper claims 5-15x faster than comparably accurate Whisper models on CPU",
		context: "CPU, on-device",
		sourceLabel: "Moonshine paper (arXiv 2410.15608)",
		sourceHref: "https://arxiv.org/abs/2410.15608",
	},
];

export default function BenchmarkPage() {
	return (
		<div className="space-y-12">
			<section className="space-y-4">
				<h1 className="text-3xl font-bold tracking-tight">Benchmarks</h1>
				<p className="max-w-2xl text-lg text-muted-foreground">
					In-browser performance depends on your GPU, your CPU and your browser,
					so this page does not publish a leaderboard of numbers we collected on
					our machines. Instead: what the metrics mean, how they are measured,
					and a curated table of published measurements from external sources —
					each attributed. For numbers on <em>your</em> hardware, run the live
					demos on the model pages.
				</p>
			</section>

			<Separator />

			{/* What is measured and how */}
			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">What is measured, and how</h2>
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					<Card>
						<CardHeader>
							<Gauge className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Real-time factor (TTS)</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Generation time divided by the duration of the produced audio.
								RTF 1.0 means real time; 0.105 means speech is produced about
								9.5x faster than it is played. Every TTS demo on this site
								displays live generation metrics as you run it.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<ListChecks className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Tokens per second (LLM)</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Decode throughput of the voice agent's language model stage. The
								in-browser reference point is the WebLLM paper's measurement of
								Llama-3.1-8B at 41.1 tok/s on an M3 Max, about 71% of native
								Metal speed on the same machine.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<Play className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Word error rate (STT)</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								The standard accuracy metric for speech-to-text: edits needed to
								turn a transcript into the reference text, lower is better.
								Cross-model WER comparisons are best taken from the Open ASR
								Leaderboard and each model's published card — not re-measured
								per visitor, because a single clip proves nothing about
								accuracy.
							</CardDescription>
						</CardContent>
					</Card>
				</div>
				<p className="max-w-2xl text-sm text-muted-foreground">
					STT accuracy references we link to per model: the{" "}
					<a
						href="https://huggingface.co/spaces/hf-audio/open_asr_leaderboard"
						target="_blank"
						rel="noopener noreferrer"
						className="text-primary hover:underline"
					>
						Open ASR Leaderboard
					</a>{" "}
					and each model's Hugging Face model card, linked from every model
					page.
				</p>
			</section>

			<Separator />

			{/* External published measurements */}
			<section className="space-y-6">
				<div className="flex flex-wrap items-center gap-3">
					<h2 className="text-2xl font-semibold">
						Published measurements (external)
					</h2>
					<Badge variant="secondary">External sources</Badge>
				</div>
				<p className="max-w-2xl text-muted-foreground">
					These are external, published measurements — not run by TTSLab, and
					not reproducible on your machine without its exact context. Each row
					names its source. To see what a model does on your hardware, run its
					live demo.
				</p>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[760px] border-collapse text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="py-2 pr-4 font-semibold">Model / system</th>
								<th className="py-2 pr-4 font-semibold">Metric</th>
								<th className="py-2 pr-4 font-semibold">Published result</th>
								<th className="py-2 pr-4 font-semibold">Context</th>
								<th className="py-2 font-semibold">Source</th>
							</tr>
						</thead>
						<tbody>
							{measurements.map((row) => (
								<tr
									key={`${row.model} — ${row.result}`}
									className="border-b border-border/50 align-top"
								>
									<td className="py-3 pr-4 font-medium">{row.model}</td>
									<td className="py-3 pr-4 text-muted-foreground">
										{row.metric}
									</td>
									<td className="py-3 pr-4 text-muted-foreground">
										{row.result}
									</td>
									<td className="py-3 pr-4 text-muted-foreground">
										{row.context}
									</td>
									<td className="py-3">
										<a
											href={row.sourceHref}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline"
										>
											{row.sourceLabel}
										</a>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="flex flex-wrap gap-3">
					<Link
						href="/models"
						className={`${buttonVariants({ variant: "outline" })} gap-2`}
					>
						<Play className="h-4 w-4" />
						Run the live demos
					</Link>
					<Link
						href="/limits"
						className={`${buttonVariants({ variant: "ghost" })} gap-2`}
					>
						<ExternalLink className="h-4 w-4" />
						Why performance varies — platform limits
					</Link>
				</div>
			</section>

			<Separator />

			{/* Planned standardized suite */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">
					Planned: a standardized suite
				</h2>
				<p className="max-w-2xl text-muted-foreground">
					A reproducible in-browser benchmark suite — fixed test phrases for
					TTS, fixed clips for STT, results anchored to your device profile — is
					planned. Behind the scenes, generations on this site already pass
					through an automated QA harness that checks each render for
					truncation, looping, clipping and silence before it counts as a
					success. Subscribe below if you want to know when the public
					leaderboard lands.
				</p>
				<div className="max-w-md">
					<SubscribeForm comparisonSlug="benchmark-updates" />
				</div>
			</section>
		</div>
	);
}
