import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { models } from "@/lib/db/schema";
import { ModelGrid } from "./model-grid";

export const metadata: Metadata = {
	title: "Model Directory",
	description:
		"Browse and test TTS and STT models that run directly in your browser.",
};

export default async function ModelsPage() {
	let allModels: { model: typeof models.$inferSelect; upvoteCount: number }[] =
		[];
	try {
		allModels = await db
			.select({
				model: models,
				upvoteCount:
					sql<number>`(SELECT count(*) FROM upvotes WHERE model_id = models.id)`.as(
						"upvote_count",
					),
			})
			.from(models);
	} catch {
		// DB not configured yet
	}

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-3xl font-bold tracking-tight">Model Directory</h1>
				<p className="mt-2 text-muted-foreground">
					Browse and test TTS and STT models that run directly in your browser.
				</p>
			</div>
			<ModelGrid
				models={allModels.map(({ model, upvoteCount }) => ({
					...model,
					upvoteCount,
				}))}
			/>
		</div>
	);
}
