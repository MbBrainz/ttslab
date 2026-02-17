import { BarChart3, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getAllComparisonsWithModels } from "@/lib/db/queries";
import type { ComparisonWithModels } from "@/lib/db/types";

export const metadata: Metadata = {
	title: "Compare Models",
	description: "Compare TTS and STT models side by side in your browser.",
};

export default async function ComparePage() {
	let comparisonDetails: ComparisonWithModels[] = [];

	try {
		comparisonDetails = await getAllComparisonsWithModels();
	} catch {
		// DB not configured yet
	}

	const ttsComparisons = comparisonDetails.filter(
		(c) => c.modelA.type === "tts" && c.modelB.type === "tts",
	);
	const sttComparisons = comparisonDetails.filter(
		(c) => c.modelA.type === "stt" && c.modelB.type === "stt",
	);
	const crossTypeComparisons = comparisonDetails.filter(
		(c) => c.modelA.type !== c.modelB.type,
	);

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">Compare Models</h1>
				<p className="mt-2 text-muted-foreground">
					Compare TTS and STT models side by side in your browser.
				</p>
			</div>

			{ttsComparisons.length > 0 && (
				<section className="space-y-4">
					<div className="flex items-center gap-3">
						<h2 className="text-xl font-semibold">TTS Comparisons</h2>
						<Badge variant="secondary">{ttsComparisons.length}</Badge>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{ttsComparisons.map(({ comparison, modelA, modelB }) => (
							<Link key={comparison.id} href={`/compare/${comparison.slug}`}>
								<Card className="transition-colors hover:border-primary/50">
									<CardHeader>
										<CardTitle className="flex items-center justify-between text-base">
											<span className="flex items-center gap-2">
												{modelA.name}
												<span className="text-sm font-normal text-muted-foreground">
													vs
												</span>
												{modelB.name}
											</span>
											<ChevronRight className="h-4 w-4 text-muted-foreground" />
										</CardTitle>
									</CardHeader>
								</Card>
							</Link>
						))}
					</div>
				</section>
			)}

			{sttComparisons.length > 0 && (
				<>
					<Separator />
					<section className="space-y-4">
						<div className="flex items-center gap-3">
							<h2 className="text-xl font-semibold">STT Comparisons</h2>
							<Badge variant="secondary">{sttComparisons.length}</Badge>
						</div>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{sttComparisons.map(({ comparison, modelA, modelB }) => (
								<Link key={comparison.id} href={`/compare/${comparison.slug}`}>
									<Card className="transition-colors hover:border-primary/50">
										<CardHeader>
											<CardTitle className="flex items-center justify-between text-base">
												<span className="flex items-center gap-2">
													{modelA.name}
													<span className="text-sm font-normal text-muted-foreground">
														vs
													</span>
													{modelB.name}
												</span>
												<ChevronRight className="h-4 w-4 text-muted-foreground" />
											</CardTitle>
										</CardHeader>
									</Card>
								</Link>
							))}
						</div>
					</section>
				</>
			)}

			{crossTypeComparisons.length > 0 && (
				<>
					<Separator />
					<section className="space-y-4">
						<div className="flex items-center gap-3">
							<h2 className="text-xl font-semibold">Cross-Type Comparisons</h2>
							<Badge variant="secondary">{crossTypeComparisons.length}</Badge>
						</div>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{crossTypeComparisons.map(({ comparison, modelA, modelB }) => (
								<Link key={comparison.id} href={`/compare/${comparison.slug}`}>
									<Card className="transition-colors hover:border-primary/50">
										<CardHeader>
											<CardTitle className="flex items-center justify-between text-base">
												<span className="flex items-center gap-2">
													{modelA.name}
													<span className="text-sm font-normal text-muted-foreground">
														vs
													</span>
													{modelB.name}
												</span>
												<ChevronRight className="h-4 w-4 text-muted-foreground" />
											</CardTitle>
										</CardHeader>
									</Card>
								</Link>
							))}
						</div>
					</section>
				</>
			)}

			{comparisonDetails.length === 0 && (
				<div className="flex flex-col items-center gap-4 py-16 text-center">
					<BarChart3 className="h-12 w-12 text-muted-foreground" />
					<div className="space-y-2">
						<h3 className="text-lg font-semibold">No comparisons yet</h3>
						<p className="text-sm text-muted-foreground">
							Comparisons will appear here once models are added to the
							database.
						</p>
					</div>
					<Link
						href="/models"
						className={buttonVariants({ variant: "default" })}
					>
						Browse Models
					</Link>
				</div>
			)}
		</div>
	);
}
