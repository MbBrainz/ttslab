import {
	ArrowRight,
	Download,
	Shield,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { HeroSection } from "@/components/hero-section";
import { ModelCard } from "@/components/model-card";
import { SubscribeForm } from "@/components/subscribe-form";
import { VerifiedDialog } from "@/components/verified-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { getAllModelsWithUpvotes } from "@/lib/db/queries";
import type { ModelWithUpvotes } from "@/lib/db/types";

async function getHomeData() {
	try {
		const allModels = await getAllModelsWithUpvotes();
		return { allModels };
	} catch {
		return { allModels: [] as ModelWithUpvotes[] };
	}
}

export default async function HomePage() {
	const { allModels } = await getHomeData();

	const supportedModels = allModels
		.filter((m) => m.model.status === "supported")
		.slice(0, 4);

	return (
		<div className="space-y-20">
			<Suspense>
				<VerifiedDialog />
			</Suspense>
			<HeroSection />

			{/* Newsletter Signup */}
			<section className="mx-auto max-w-xl text-center">
				<h2 className="text-xl font-semibold">Stay in the loop</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					Subscribe for the latest news on voice AI and text-to-speech
					— new models, features, and benchmarks.
				</p>
				<div className="mt-4 mx-auto max-w-sm">
					<SubscribeForm />
				</div>
			</section>

			{/* Featured Models */}
			{supportedModels.length > 0 && (
				<section className="space-y-6">
					<div className="flex items-center justify-between">
						<h2 className="text-2xl font-semibold">Featured Models</h2>
						<Link
							href="/models"
							className="flex items-center gap-1 text-sm text-primary hover:underline"
						>
							View all
							<ArrowRight className="h-4 w-4" />
						</Link>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{supportedModels.map(({ model, upvoteCount }) => (
							<ModelCard
								key={model.id}
								model={model}
								upvoteCount={upvoteCount}
							/>
						))}
					</div>
				</section>
			)}

			{/* Voice Agent Preview */}
			<section className="space-y-6">
				<Card className="border-primary/20 bg-gradient-to-r from-gradient-from/5 to-gradient-to/5">
					<CardContent className="flex items-center justify-between p-6">
						<div>
							<div className="flex items-center gap-2">
								<h2 className="text-lg font-semibold">Voice Agent</h2>
								<Badge variant="secondary">Preview</Badge>
							</div>
							<p className="mt-1 text-sm text-muted-foreground">
								Talk to an AI assistant running entirely in your browser.
							</p>
						</div>
						<Link
							href="/voice-agent"
							className={buttonVariants({ variant: "outline" })}
						>
							Try it
						</Link>
					</CardContent>
				</Card>
			</section>

			{/* Text-to-Speech in the Browser */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Text-to-Speech in the Browser</h2>
				<div className="max-w-3xl space-y-3 text-muted-foreground">
					<p>
						TTSLab lets you run text-to-speech models directly in your browser
						using WebGPU and WASM. No server-side processing, no API keys, no
						queue times. Models like Kokoro 82M, SpeechT5, and Piper generate
						natural-sounding speech in real time, right on your device.
					</p>
					<p>
						Each model is downloaded once and cached locally for instant reuse.
						Whether you are a developer evaluating TTS options, a researcher
						benchmarking model quality, or a product team comparing voices,
						TTSLab provides a fast, standardized environment.
					</p>
				</div>
			</section>

			{/* Why Privacy Matters */}
			<section className="space-y-4">
				<h2 className="text-2xl font-semibold">Why On-Device Speech AI Matters</h2>
				<div className="max-w-3xl space-y-3 text-muted-foreground">
					<p>
						Cloud-based TTS services require sending your text to external
						servers. For sensitive content — medical notes, legal documents,
						personal messages — that creates privacy and compliance risks.
						On-device inference eliminates this entirely: your text and audio
						never leave your browser.
					</p>
					<p>
						WebGPU-accelerated inference also removes latency from network round
						trips, making real-time applications like voice agents and live
						captioning practical without a backend.
					</p>
				</div>
			</section>

			{/* How It Works */}
			<section className="space-y-6">
				<h2 className="text-2xl font-semibold text-center">How It Works</h2>
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
					{[
						{
							step: "1",
							title: "Pick a Model",
							description:
								"Browse our directory of TTS and STT models, or compare two side by side.",
						},
						{
							step: "2",
							title: "Downloads Once",
							description:
								"The model weights are downloaded to your browser and cached locally for instant reuse.",
							icon: Download,
						},
						{
							step: "3",
							title: "Runs Locally",
							description:
								"Inference runs entirely in your browser using WebGPU or WASM. No server required.",
							icon: Zap,
						},
						{
							step: "4",
							title: "Data Stays Private",
							description:
								"Your text and audio never leave your device. Zero data collection, zero tracking.",
							icon: Shield,
						},
					].map((item) => (
						<Card key={item.step}>
							<CardHeader>
								<div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
									{item.step}
								</div>
								<CardTitle>{item.title}</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-sm text-muted-foreground">
									{item.description}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			</section>

			{/* Open Source CTA */}
			<section className="rounded-xl border border-border bg-card p-8 text-center sm:p-12">
				<h2 className="text-2xl font-semibold">Open Source</h2>
				<p className="mx-auto mt-3 max-w-xl text-muted-foreground">
					TTSLab is MIT licensed and fully open source. Contribute models,
					report bugs, or build on top of the project.
				</p>
				<div className="mt-6 flex flex-wrap justify-center gap-4">
					<a
						href="https://github.com/MbBrainz/ttslab"
						target="_blank"
						rel="noopener noreferrer"
						className={`${buttonVariants({ variant: "default", size: "lg" })} gap-2`}
					>
						View on GitHub
						<ArrowRight className="h-4 w-4" />
					</a>
					<Link
						href="/about"
						className={buttonVariants({ variant: "outline", size: "lg" })}
					>
						Learn More
					</Link>
				</div>
			</section>
		</div>
	);
}
