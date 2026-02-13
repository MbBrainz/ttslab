import { ArrowRight, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackendBadge } from "@/components/backend-badge";
import { GenerationHistory } from "@/components/generation-history";
import { SttDemo } from "@/components/stt-demo";
import { SubscribeForm } from "@/components/subscribe-form";
import { TtsDemo } from "@/components/tts-demo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { UpvoteButton } from "@/components/upvote-button";
import { APP_NAME, APP_URL } from "@/lib/constants";
import {
	getAllModelSlugs,
	getComparisonsForModel,
	getModelBySlug,
	getModelBySlugWithUpvotes,
	getSimilarSupportedModels,
} from "@/lib/db/queries";

type PageProps = {
	params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
	const allModels = await getAllModelSlugs();
	return allModels.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;
	const model = await getModelBySlug(slug);

	if (!model) {
		return { title: "Model Not Found" };
	}

	return {
		title: model.name,
		description:
			model.description ??
			`Test ${model.name} ${model.type.toUpperCase()} model in your browser.`,
		openGraph: {
			title: `${model.name} | ${APP_NAME}`,
			description:
				model.description ??
				`Test ${model.name} ${model.type.toUpperCase()} model in your browser.`,
			url: `${APP_URL}/models/${model.slug}`,
			siteName: APP_NAME,
			type: "website",
		},
	};
}

export default async function ModelPage({ params }: PageProps) {
	const { slug } = await params;

	const result = await getModelBySlugWithUpvotes(slug);

	if (!result) {
		notFound();
	}

	const { model, upvoteCount } = result;

	// Fetch comparisons and similar models in parallel
	const [comparisonModels, similarModels] = await Promise.all([
		getComparisonsForModel(model.id),
		model.status !== "supported"
			? getSimilarSupportedModels(model.type, model.id)
			: Promise.resolve([]),
	]);

	const isSupported = model.status === "supported";

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: model.name,
		description: model.description,
		applicationCategory: "MultimediaApplication",
		operatingSystem: "Web Browser",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
		},
	};

	return (
		<div className="space-y-8">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>

			{/* Header */}
			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="text-3xl font-bold tracking-tight">{model.name}</h1>
					<Badge variant="outline">{model.type.toUpperCase()}</Badge>
				</div>
				{model.description && (
					<p className="max-w-2xl text-lg text-muted-foreground">
						{model.description}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{model.supportsWebgpu && <BackendBadge backend="webgpu" />}
					{model.supportsWasm && <BackendBadge backend="wasm" />}
					{model.supportsStreaming && (
						<Badge variant="secondary">Streaming</Badge>
					)}
					{model.license && <Badge variant="outline">{model.license}</Badge>}
				</div>
			</div>

			<Separator />

			{isSupported ? (
				<>
					{/* Demo section for supported models */}
					<section className="space-y-4">
						<h2 className="text-xl font-semibold">Try It</h2>
						{model.type === "tts" ? (
							<TtsDemo model={model} />
						) : (
							<SttDemo model={model} />
						)}
					</section>

					<Separator />

					{/* Technical Details */}
					<section className="space-y-4">
						<h2 className="text-xl font-semibold">Technical Details</h2>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{model.architecture && (
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Architecture</CardDescription>
									</CardHeader>
									<CardContent>
										<p className="font-medium">{model.architecture}</p>
									</CardContent>
								</Card>
							)}
							{model.paramsMillions && (
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Parameters</CardDescription>
									</CardHeader>
									<CardContent>
										<p className="font-medium">{model.paramsMillions}M</p>
									</CardContent>
								</Card>
							)}
							{model.sizeMb && (
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Model Size</CardDescription>
									</CardHeader>
									<CardContent>
										<p className="font-medium">{model.sizeMb} MB</p>
									</CardContent>
								</Card>
							)}
							{model.voices != null && (
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Voices</CardDescription>
									</CardHeader>
									<CardContent>
										<p className="font-medium">{model.voices}</p>
									</CardContent>
								</Card>
							)}
							{model.languages && model.languages.length > 0 && (
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Languages</CardDescription>
									</CardHeader>
									<CardContent>
										<p className="font-medium">{model.languages.join(", ")}</p>
									</CardContent>
								</Card>
							)}
						</div>
					</section>

					<Separator />

					{/* Generation History */}
					<section className="space-y-4">
						<h2 className="text-xl font-semibold">Generation History</h2>
						<GenerationHistory modelSlug={model.slug} />
					</section>
				</>
			) : (
				<>
					{/* Unsupported/planned model content */}
					<section className="space-y-6">
						<Card className="border-dashed">
							<CardHeader>
								<CardTitle>
									{model.status === "planned"
										? "Coming Soon"
										: "Not Yet Supported"}
								</CardTitle>
								<CardDescription>
									{model.status === "planned"
										? `${model.name} is planned for a future release. Upvote to show your interest and get notified when it's ready.`
										: `${model.name} is not yet supported in TTSLab. Upvote to help us prioritize and get notified when support is added.`}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<UpvoteButton
									modelSlug={model.slug}
									initialCount={upvoteCount}
								/>
								<Separator />
								<div className="space-y-2">
									<p className="text-sm font-medium">
										Get notified when this model is supported:
									</p>
									<SubscribeForm modelSlug={model.slug} />
								</div>
							</CardContent>
						</Card>
					</section>

					{/* Similar supported models */}
					{similarModels.length > 0 && (
						<section className="space-y-4">
							<h2 className="text-xl font-semibold">Try Similar Models</h2>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{similarModels.map((similar) => (
									<Link key={similar.id} href={`/models/${similar.slug}`}>
										<Card className="transition-colors hover:border-primary/50">
											<CardHeader>
												<CardTitle>{similar.name}</CardTitle>
												<CardDescription>{similar.description}</CardDescription>
											</CardHeader>
										</Card>
									</Link>
								))}
							</div>
						</section>
					)}
				</>
			)}

			<Separator />

			{/* External Links */}
			{(model.hfModelId || model.paperUrl || model.websiteUrl) && (
				<section className="space-y-4">
					<h2 className="text-xl font-semibold">Links</h2>
					<div className="flex flex-wrap gap-3">
						{model.hfModelId && (
							<a
								href={`https://huggingface.co/${model.hfModelId}`}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Button variant="outline" className="gap-2">
									<ExternalLink className="h-4 w-4" />
									HuggingFace
								</Button>
							</a>
						)}
						{model.paperUrl && (
							<a
								href={model.paperUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Button variant="outline" className="gap-2">
									<ExternalLink className="h-4 w-4" />
									Paper
								</Button>
							</a>
						)}
						{model.websiteUrl && (
							<a
								href={model.websiteUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Button variant="outline" className="gap-2">
									<ExternalLink className="h-4 w-4" />
									Website
								</Button>
							</a>
						)}
					</div>
				</section>
			)}

			{/* Compare With */}
			{comparisonModels.length > 0 && (
				<section className="space-y-4">
					<h2 className="text-xl font-semibold">Compare With</h2>
					<div className="flex flex-wrap gap-3">
						{comparisonModels.map(({ comparison, otherModel }) => {
							if (!otherModel) return null;
							return (
								<Link key={comparison.id} href={`/compare/${comparison.slug}`}>
									<Button variant="secondary" className="gap-2">
										{otherModel.name}
										<ArrowRight className="h-4 w-4" />
									</Button>
								</Link>
							);
						})}
					</div>
				</section>
			)}
		</div>
	);
}
