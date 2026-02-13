import { desc, eq, or, sql } from "drizzle-orm";
import { db } from "..";
import { comparisons, models } from "../schema";
import type { ModelWithUpvotes } from "../types";

/**
 * SQL fragment that counts upvotes for each model row.
 * Re-used across multiple queries to avoid duplication.
 */
const upvoteCountSql = sql<number>`(SELECT count(*) FROM upvotes WHERE model_id = models.id)`;

/** Fetch all models with their upvote counts. */
export async function getAllModelsWithUpvotes(): Promise<ModelWithUpvotes[]> {
	return db
		.select({
			model: models,
			upvoteCount: upvoteCountSql.as("upvote_count"),
		})
		.from(models);
}

/** Fetch all models with upvotes, ordered by upvote count descending. */
export async function getAllModelsWithUpvotesOrdered(): Promise<
	ModelWithUpvotes[]
> {
	return db
		.select({
			model: models,
			upvoteCount: upvoteCountSql,
		})
		.from(models)
		.orderBy(desc(upvoteCountSql));
}

/** Fetch a single model by slug with its upvote count. Returns null if not found. */
export async function getModelBySlugWithUpvotes(
	slug: string,
): Promise<ModelWithUpvotes | null> {
	const [result] = await db
		.select({
			model: models,
			upvoteCount: upvoteCountSql.as("upvote_count"),
		})
		.from(models)
		.where(eq(models.slug, slug))
		.limit(1);

	return result ?? null;
}

/** Fetch a single model by slug (without upvotes). Returns null if not found. */
export async function getModelBySlug(slug: string) {
	const [result] = await db
		.select()
		.from(models)
		.where(eq(models.slug, slug))
		.limit(1);

	return result ?? null;
}

/** Fetch a single model by ID. Returns null if not found. */
export async function getModelById(id: string) {
	const [result] = await db
		.select()
		.from(models)
		.where(eq(models.id, id))
		.limit(1);

	return result ?? null;
}

/** Fetch all model slugs (for static params generation). */
export async function getAllModelSlugs(): Promise<{ slug: string }[]> {
	return db.select({ slug: models.slug }).from(models);
}

/** Fetch all models (without upvote counts). */
export async function getAllModels() {
	return db.select().from(models);
}

/**
 * Fetch comparisons that include a given model, with the "other" model resolved.
 * Avoids N+1 by fetching all other model IDs in one go.
 */
export async function getComparisonsForModel(modelId: string): Promise<
	{
		comparison: typeof comparisons.$inferSelect;
		otherModel: typeof models.$inferSelect;
	}[]
> {
	const modelComparisons = await db
		.select()
		.from(comparisons)
		.where(
			or(eq(comparisons.modelAId, modelId), eq(comparisons.modelBId, modelId)),
		);

	if (modelComparisons.length === 0) return [];

	// Collect all "other" model IDs
	const otherIds = new Set<string>();
	for (const c of modelComparisons) {
		otherIds.add(c.modelAId === modelId ? c.modelBId : c.modelAId);
	}

	// Batch fetch all other models
	const otherModels = await db
		.select()
		.from(models)
		.where(or(...[...otherIds].map((id) => eq(models.id, id))));

	const otherMap = new Map(otherModels.map((m) => [m.id, m]));

	return modelComparisons
		.map((c) => {
			const otherId = c.modelAId === modelId ? c.modelBId : c.modelAId;
			const otherModel = otherMap.get(otherId);
			if (!otherModel) return null;
			return { comparison: c, otherModel };
		})
		.filter(
			(
				item,
			): item is {
				comparison: typeof comparisons.$inferSelect;
				otherModel: typeof models.$inferSelect;
			} => item !== null,
		);
}

/**
 * Fetch similar supported models of the same type (excluding a given model ID).
 */
export async function getSimilarSupportedModels(
	type: string,
	excludeModelId: string,
	limit = 3,
) {
	const results = await db
		.select()
		.from(models)
		.where(eq(models.type, type as "tts" | "stt"))
		.limit(limit + 1);

	return results
		.filter((m) => m.status === "supported" && m.id !== excludeModelId)
		.slice(0, limit);
}
