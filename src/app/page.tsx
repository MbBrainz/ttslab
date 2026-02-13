import {
	ArrowRight,
	BarChart3,
	ChevronRight,
	Download,
	Shield,
	Volume2,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { ModelCard } from "@/components/model-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { UpvoteButton } from "@/components/upvote-button";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";
import {
	getAllModelsWithUpvotes,
	getPopularComparisons,
} from "@/lib/db/queries";
import type { ComparisonWithModels, ModelWithUpvotes } from "@/lib/db/types";

async function getHomeData() {
	try {
		const [allModels, popularComparisons] = await Promise.all([
			getAllModelsWithUpvotes(),
			getPopularComparisons(4),
		]);

		return { allModels, popularComparisons };
	} catch {
		return {
			allModels: [] as ModelWithUpvotes[],
			popularComparisons: [] as ComparisonWithModels[],
		};
	}
}

export default async function HomePage() {
	const { allModels, popularComparisons } = await getHomeData();

	const supportedModels = allModels
		.filter((m) => m.model.status === "supported")
		.slice(0, 4);

	const unsupportedModels = allModels
		.filter((m) => m.model.status !== "supported")
		.sort((a, b) => b.upvoteCount - a.upvoteCount)
		.slice(0, 6);

	const totalModels = allModels.length;
	const supportedCount = allModels.filter(
		(m) => m.model.status === "supported",
	).length;
	const ttsCount = allModels.filter((m) => m.model.type === "tts").length;
	const sttCount = allModels.filter((m) => m.model.type === "stt").length;

	return (
		<div className="space-y-20">
			{/* Hero Section */}
			<section className="flex flex-col items-center gap-8 pt-12 text-center">
				<Badge variant="secondary" className="gap-1.5">
					<Zap className="h-3 w-3" />
					Powered by WebGPU
				</Badge>
				<h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
					{APP_NAME}
				</h1>
				<p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
					{APP_DESCRIPTION}
				</p>
				<div className="flex flex-wrap justify-center gap-4">
					<Link
						href="/models"
						className={`${buttonVariants({ size: "lg" })} gap-2`}
					>
						<Volume2 className="h-5 w-5" />
						Browse Models
					</Link>
					<Link
						href="/compare"
						className={`${buttonVariants({ variant: "outline", size: "lg" })} gap-2`}
					>
						<BarChart3 className="h-5 w-5" />
						Compare Models
					</Link>
				</div>
				{totalModels > 0 && (
					<div className="flex gap-8 text-sm text-muted-foreground">
						<span>
							<strong className="text-foreground">{totalModels}</strong> models
						</span>
						<span>
							<strong className="text-foreground">{supportedCount}</strong>{" "}
							supported
						</span>
						<span>
							<strong className="text-foreground">{ttsCount}</strong> TTS
						</span>
						<span>
							<strong className="text-foreground">{sttCount}</strong> STT
						</span>
					</div>
				)}
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

			{/* Popular Comparisons */}
			{popularComparisons.length > 0 && (
				<section className="space-y-6">
					<div className="flex items-center justify-between">
						<h2 className="text-2xl font-semibold">Popular Comparisons</h2>
						<Link
							href="/compare"
							className="flex items-center gap-1 text-sm text-primary hover:underline"
						>
							View all
							<ArrowRight className="h-4 w-4" />
						</Link>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						{popularComparisons.map((c) => (
							<Link
								key={c.comparison.id}
								href={`/compare/${c.comparison.slug}`}
							>
								<Card className="transition-colors hover:border-primary/50">
									<CardContent className="flex items-center justify-between p-6">
										<div className="flex items-center gap-3">
											<span className="font-medium">{c.modelA.name}</span>
											<span className="text-sm text-muted-foreground">vs</span>
											<span className="font-medium">{c.modelB.name}</span>
										</div>
										<ChevronRight className="h-4 w-4 text-muted-foreground" />
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
				</section>
			)}

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

			{/* Most Requested */}
			{unsupportedModels.length > 0 && (
				<section className="space-y-6">
					<div className="text-center space-y-2">
						<h2 className="text-2xl font-semibold">Most Requested</h2>
						<p className="text-muted-foreground">
							Upvote the models you want to see supported next.
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{unsupportedModels.map(({ model, upvoteCount }) => (
							<Card key={model.id}>
								<CardHeader>
									<div className="flex items-center justify-between">
										<CardTitle>{model.name}</CardTitle>
										<Badge variant="outline">{model.type.toUpperCase()}</Badge>
									</div>
									<CardDescription>{model.description}</CardDescription>
								</CardHeader>
								<CardContent>
									<UpvoteButton
										modelSlug={model.slug}
										initialCount={upvoteCount}
									/>
								</CardContent>
							</Card>
						))}
					</div>
				</section>
			)}

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
