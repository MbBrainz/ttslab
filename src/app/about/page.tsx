import { ExternalLink, Github, Globe, Shield, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
	title: "About",
	description: `Learn about ${APP_NAME}, how it works, and how to contribute.`,
};

export default function AboutPage() {
	return (
		<div className="space-y-12">
			<section className="space-y-4">
				<h1 className="text-3xl font-bold tracking-tight">About {APP_NAME}</h1>
				<p className="max-w-2xl text-lg text-muted-foreground">
					VoiceBench is an open-source tool for testing and comparing
					text-to-speech (TTS) and speech-to-text (STT) models directly in your
					browser. No servers, no data collection, no API keys required.
				</p>
			</section>

			<Separator />

			<section className="space-y-6">
				<h2 className="text-2xl font-semibold">How It Works</h2>
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					<Card>
						<CardHeader>
							<Zap className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>WebGPU Powered</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">
								Models run directly in your browser using WebGPU acceleration.
								No server-side inference means instant results with no queue
								times.
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<Shield className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>Complete Privacy</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">
								Your text and audio never leave your device. All processing
								happens locally in the browser. No data is sent to any server.
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<Globe className="mb-2 h-8 w-8 text-primary" />
							<CardTitle>No Setup Required</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">
								No Python, no dependencies, no API keys. Just open your browser
								and start testing models. Models are downloaded once and cached
								locally.
							</p>
						</CardContent>
					</Card>
				</div>
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Methodology</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						VoiceBench provides a standardized environment for evaluating voice
						AI models. By running models in the browser with WebGPU, we ensure
						consistent and reproducible results across different hardware.
					</p>
					<p>
						Each model is loaded using its ONNX-optimized variant when
						available, ensuring the best balance between quality and performance
						for client-side inference.
					</p>
					<p>
						Comparisons are done side-by-side with shared inputs, allowing you
						to directly hear and evaluate the differences between models on
						identical text or audio.
					</p>
				</div>
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Open Source</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						VoiceBench is fully open source under the MIT License. We believe
						that tools for evaluating AI models should be transparent and
						community-driven.
					</p>
					<p>
						The entire codebase, including the model integration layer, UI
						components, and database schema, is available on GitHub.
					</p>
				</div>
				<div className="flex gap-3">
					<a
						href="https://github.com/nicholasgriffintn/voicebench"
						target="_blank"
						rel="noopener noreferrer"
					>
						<Button variant="outline" className="gap-2">
							<Github className="h-4 w-4" />
							View on GitHub
						</Button>
					</a>
				</div>
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Contributing</h2>
				<div className="max-w-2xl space-y-3 text-muted-foreground">
					<p>
						We welcome contributions of all kinds. Here is how you can help:
					</p>
					<ul className="list-inside list-disc space-y-2">
						<li>
							<strong className="text-foreground">Add a model</strong> &mdash;
							Integrate a new TTS or STT model with an ONNX export.
						</li>
						<li>
							<strong className="text-foreground">Improve the UI</strong>{" "}
							&mdash; Fix bugs, improve accessibility, or add new features.
						</li>
						<li>
							<strong className="text-foreground">Write documentation</strong>{" "}
							&mdash; Help others get started with clear guides.
						</li>
						<li>
							<strong className="text-foreground">Report issues</strong> &mdash;
							Found a bug or have a suggestion? Open an issue on GitHub.
						</li>
					</ul>
				</div>
				<a
					href="https://github.com/nicholasgriffintn/voicebench/issues"
					target="_blank"
					rel="noopener noreferrer"
				>
					<Button variant="secondary" className="gap-2">
						<ExternalLink className="h-4 w-4" />
						Open an Issue
					</Button>
				</a>
			</section>

			<Separator />

			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Links</h2>
				<div className="flex flex-wrap gap-4">
					<a
						href="https://github.com/nicholasgriffintn/voicebench"
						target="_blank"
						rel="noopener noreferrer"
						className="text-sm text-primary hover:underline"
					>
						GitHub Repository
					</a>
					<Link href="/models" className="text-sm text-primary hover:underline">
						Model Directory
					</Link>
					<Link
						href="/compare"
						className="text-sm text-primary hover:underline"
					>
						Compare Models
					</Link>
				</div>
			</section>
		</div>
	);
}
