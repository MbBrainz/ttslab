import { unstable_cache } from "next/cache";
import { asc, desc, eq, or, sql } from "drizzle-orm";
import { db } from "..";
import { comparisons, models } from "../schema";
import type { ModelWithUpvotes } from "../types";

/**
 * SQL fragment that counts upvotes for each model row.
 * Re-used across multiple queries to avoid duplication.
 */
const upvoteCountSql = sql<number>`(SELECT count(*) FROM upvotes WHERE model_id = models.id)`;

const CACHE_OPTIONS = { tags: ["models"], revalidate: 3600 };

/** Fetch all models with their upvote counts. */
async function _getAllModelsWithUpvotes(): Promise<ModelWithUpvotes[]> {
	return db
		.select({
			model: models,
			upvoteCount: upvoteCountSql.as("upvote_count"),
		})
		.from(models);
}
export const getAllModelsWithUpvotes = unstable_cache(
	_getAllModelsWithUpvotes,
	["models:getAllModelsWithUpvotes"],
	CACHE_OPTIONS,
);

/** Fetch all models with upvotes, ordered by upvote count descending. */
async function _getAllModelsWithUpvotesOrdered(): Promise<ModelWithUpvotes[]> {
	return db
		.select({
			model: models,
			upvoteCount: upvoteCountSql,
		})
		.from(models)
		.orderBy(desc(upvoteCountSql), asc(models.name));
}
export const getAllModelsWithUpvotesOrdered = unstable_cache(
	_getAllModelsWithUpvotesOrdered,
	["models:getAllModelsWithUpvotesOrdered"],
	CACHE_OPTIONS,
);

/** Fetch a single model by slug with its upvote count. Returns null if not found. */
async function _getModelBySlugWithUpvotes(
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
export const getModelBySlugWithUpvotes = unstable_cache(
	_getModelBySlugWithUpvotes,
	["models:getModelBySlugWithUpvotes"],
	CACHE_OPTIONS,
);

/** Fetch a single model by slug (without upvotes). Returns null if not found. */
async function _getModelBySlug(slug: string) {
	const [result] = await db
		.select()
		.from(models)
		.where(eq(models.slug, slug))
		.limit(1);

	return result ?? null;
}
export const getModelBySlug = unstable_cache(
	_getModelBySlug,
	["models:getModelBySlug"],
	CACHE_OPTIONS,
);

/** Fetch a single model by ID. Returns null if not found. */
async function _getModelById(id: string) {
	const [result] = await db
		.select()
		.from(models)
		.where(eq(models.id, id))
		.limit(1);

	return result ?? null;
}
export const getModelById = unstable_cache(
	_getModelById,
	["models:getModelById"],
	CACHE_OPTIONS,
);

/** Fetch all model slugs (for static params generation). */
async function _getAllModelSlugs(): Promise<{ slug: string }[]> {
	return db.select({ slug: models.slug }).from(models);
}
export const getAllModelSlugs = unstable_cache(
	_getAllModelSlugs,
	["models:getAllModelSlugs"],
	CACHE_OPTIONS,
);

/** Fetch all models (without upvote counts). */
async function _getAllModels() {
	return db.select().from(models);
}
export const getAllModels = unstable_cache(
	_getAllModels,
	["models:getAllModels"],
	CACHE_OPTIONS,
);

/**
 * Fetch comparisons that include a given model, with the "other" model resolved.
 * Avoids N+1 by fetching all other model IDs in one go.
 */
async function _getComparisonsForModel(modelId: string): Promise<
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
export const getComparisonsForModel = unstable_cache(
	_getComparisonsForModel,
	["models:getComparisonsForModel"],
	CACHE_OPTIONS,
);

/**
 * Fetch similar supported models of the same type (excluding a given model ID).
 */
async function _getSimilarSupportedModels(
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
export const getSimilarSupportedModels = unstable_cache(
	_getSimilarSupportedModels,
	["models:getSimilarSupportedModels"],
	CACHE_OPTIONS,
);
