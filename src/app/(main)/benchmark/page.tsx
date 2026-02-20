import {
	BarChart3,
	FlaskConical,
	ListChecks,
	Trophy,
} from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SubscribeForm } from "@/components/subscribe-form";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
	title: "TTS & STT Benchmarks — In-Browser Performance Comparison",
	description: `Automated, reproducible benchmarks for text-to-speech and speech-to-text models. Run standardized test suites in your browser with WebGPU and compare latency, quality, and real-time factor.`,
};

export default function BenchmarkPage() {
	return (
		<div className="space-y-12">
			<section className="space-y-4">
				<div className="flex items-center gap-3">
					<h1 className="text-3xl font-bold tracking-tight">Benchmarks</h1>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<p className="max-w-2xl text-lg text-muted-foreground">
					Automated, reproducible benchmarks for TTS and STT models. Run
					standardized test suites directly in your browser and compare results
					across models.
				</p>
			</section>

			<Separator />

			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">What to Expect</h2>
				<div className="grid gap-6 sm:grid-cols-2">
					<Card>
						<CardHeader>
							<ListChecks className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Standardized Test Suites</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Harvard sentences for TTS, LibriSpeech clips for STT. Curated
								datasets that test pronunciation, prosody, and accuracy across a
								wide range of inputs.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<FlaskConical className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Reproducible Scores</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Same hardware, same browser, consistent results. Every benchmark
								run is deterministic and comparable, so you can trust the
								numbers.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<BarChart3 className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Automated Metrics</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								Word Error Rate (WER), Real-Time Factor (RTF), MOS predictions,
								and more. Get objective scores without manual evaluation.
							</CardDescription>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<Trophy className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Community Leaderboard</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								See how models rank across different benchmarks. Compare
								performance on specific tasks and find the best model for your
								use case.
							</CardDescription>
						</CardContent>
					</Card>
				</div>
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Get Notified</h2>
				<p className="max-w-2xl text-muted-foreground">
					Subscribe to be the first to know when benchmarks launch.
				</p>
				<div className="max-w-md">
					<SubscribeForm comparisonSlug="benchmark-updates" />
				</div>
			</section>
		</div>
	);
}
