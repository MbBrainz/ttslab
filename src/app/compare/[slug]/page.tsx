import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ComparisonTable } from "@/components/comparison-table";
import { SttDemo } from "@/components/stt-demo";
import { SubscribeForm } from "@/components/subscribe-form";
import { TtsCompare } from "@/components/tts-compare";
import { TtsDemo } from "@/components/tts-demo";
import { Badge } from "@/components/ui/badge";
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
	getAllComparisonSlugs,
	getComparisonBySlug,
	getModelById,
} from "@/lib/db/queries";

type PageProps = {
	params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
	const allComparisons = await getAllComparisonSlugs();
	return allComparisons.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { slug } = await params;

	const comparison = await getComparisonBySlug(slug);

	if (!comparison) {
		return { title: "Comparison Not Found" };
	}

	const [modelA, modelB] = await Promise.all([
		getModelById(comparison.modelAId),
		getModelById(comparison.modelBId),
	]);

	if (!modelA || !modelB) {
		return { title: "Comparison Not Found" };
	}

	const title = `${modelA.name} vs ${modelB.name}`;
	const description = `Compare ${modelA.name} and ${modelB.name} side by side in your browser. No server, no data collection.`;

	return {
		title,
		description,
		openGraph: {
			title: `${title} | ${APP_NAME}`,
			description,
			url: `${APP_URL}/compare/${slug}`,
			siteName: APP_NAME,
			type: "website",
		},
	};
}

export default async function ComparisonPage({ params }: PageProps) {
	const { slug } = await params;

	const comparison = await getComparisonBySlug(slug);

	if (!comparison) {
		notFound();
	}

	const [modelA, modelB] = await Promise.all([
		getModelById(comparison.modelAId),
		getModelById(comparison.modelBId),
	]);

	if (!modelA || !modelB) {
		notFound();
	}

	const modelASupported = modelA.status === "supported";
	const modelBSupported = modelB.status === "supported";

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="text-3xl font-bold tracking-tight">
						{modelA.name} <span className="text-muted-foreground">vs</span>{" "}
						{modelB.name}
					</h1>
				</div>
				<p className="text-muted-foreground">
					Compare {modelA.name} and {modelB.name} side by side in your browser.
				</p>
			</div>

			<Separator />

			{/* Side-by-side demo area */}
			<section className="space-y-6">
				<h2 className="text-xl font-semibold">Try Both Models</h2>
				{modelASupported && modelBSupported && modelA.type === "tts" && modelB.type === "tts" ? (
					<TtsCompare modelA={modelA} modelB={modelB} />
				) : (
					<div className="grid gap-6 md:grid-cols-2">
						{/* Model A */}
						<div className="space-y-4">
							<div className="flex items-center gap-3">
								<Link
									href={`/models/${modelA.slug}`}
									className="text-lg font-semibold hover:underline"
								>
									{modelA.name}
								</Link>
								<Badge variant="outline">{modelA.type.toUpperCase()}</Badge>
							</div>
							{modelASupported ? (
								modelA.type === "tts" ? (
									<TtsDemo model={modelA} />
								) : (
									<SttDemo model={modelA} />
								)
							) : (
								<Card className="border-dashed">
									<CardHeader>
										<CardTitle>
											{modelA.status === "planned"
												? "Coming Soon"
												: "Not Yet Supported"}
										</CardTitle>
										<CardDescription>
											{modelA.name} is not yet available for testing. Upvote to
											help us prioritize.
										</CardDescription>
									</CardHeader>
									<CardContent className="space-y-4">
										<UpvoteButton modelSlug={modelA.slug} initialCount={0} />
										<SubscribeForm modelSlug={modelA.slug} />
									</CardContent>
								</Card>
							)}
						</div>

						{/* Model B */}
						<div className="space-y-4">
							<div className="flex items-center gap-3">
								<Link
									href={`/models/${modelB.slug}`}
									className="text-lg font-semibold hover:underline"
								>
									{modelB.name}
								</Link>
								<Badge variant="outline">{modelB.type.toUpperCase()}</Badge>
							</div>
							{modelBSupported ? (
								modelB.type === "tts" ? (
									<TtsDemo model={modelB} />
								) : (
									<SttDemo model={modelB} />
								)
							) : (
								<Card className="border-dashed">
									<CardHeader>
										<CardTitle>
											{modelB.status === "planned"
												? "Coming Soon"
												: "Not Yet Supported"}
										</CardTitle>
										<CardDescription>
											{modelB.name} is not yet available for testing. Upvote to
											help us prioritize.
										</CardDescription>
									</CardHeader>
									<CardContent className="space-y-4">
										<UpvoteButton modelSlug={modelB.slug} initialCount={0} />
										<SubscribeForm modelSlug={modelB.slug} />
									</CardContent>
								</Card>
							)}
						</div>
					</div>
				)}
			</section>

			<Separator />

			{/* Comparison Table */}
			<section className="space-y-4">
				<h2 className="text-xl font-semibold">Specs Comparison</h2>
				<ComparisonTable modelA={modelA} modelB={modelB} />
			</section>

			<Separator />

			{/* Subscribe for updates */}
			<section className="space-y-4">
				<Card>
					<CardHeader>
						<CardTitle>Stay Updated</CardTitle>
						<CardDescription>
							Get notified when this comparison is updated or new features are
							added.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<SubscribeForm comparisonSlug={comparison.slug} />
					</CardContent>
				</Card>
			</section>
		</div>
	);
}
