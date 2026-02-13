import { eq, or } from "drizzle-orm";
import { db } from "..";
import { comparisons, models } from "../schema";
import type { ComparisonWithModels } from "../types";

/** Fetch all comparison slugs (for static params generation). */
export async function getAllComparisonSlugs(): Promise<{ slug: string }[]> {
	return db.select({ slug: comparisons.slug }).from(comparisons);
}

/** Fetch all comparisons (without model details). */
export async function getAllComparisons() {
	return db.select().from(comparisons);
}

/** Fetch a single comparison by slug. Returns null if not found. */
export async function getComparisonBySlug(slug: string) {
	const [result] = await db
		.select()
		.from(comparisons)
		.where(eq(comparisons.slug, slug))
		.limit(1);

	return result ?? null;
}

/**
 * Fetch all comparisons with both model A and model B resolved.
 * Uses a batched approach to avoid N+1 queries.
 */
export async function getAllComparisonsWithModels(): Promise<
	ComparisonWithModels[]
> {
	const allComparisons = await db.select().from(comparisons);
	if (allComparisons.length === 0) return [];

	// Collect all unique model IDs
	const modelIds = new Set<string>();
	for (const c of allComparisons) {
		modelIds.add(c.modelAId);
		modelIds.add(c.modelBId);
	}

	// Batch fetch all referenced models
	const allModels = await db
		.select()
		.from(models)
		.where(or(...[...modelIds].map((id) => eq(models.id, id))));

	const modelMap = new Map(allModels.map((m) => [m.id, m]));

	return allComparisons
		.map((c) => {
			const modelA = modelMap.get(c.modelAId);
			const modelB = modelMap.get(c.modelBId);
			if (!modelA || !modelB) return null;
			return { comparison: c, modelA, modelB };
		})
		.filter((item): item is ComparisonWithModels => item !== null);
}

/**
 * Fetch a limited set of comparisons with model details (for homepage).
 */
export async function getPopularComparisons(
	limit: number,
): Promise<ComparisonWithModels[]> {
	const limitedComparisons = await db.select().from(comparisons).limit(limit);

	if (limitedComparisons.length === 0) return [];

	// Collect all unique model IDs
	const modelIds = new Set<string>();
	for (const c of limitedComparisons) {
		modelIds.add(c.modelAId);
		modelIds.add(c.modelBId);
	}

	// Batch fetch all referenced models
	const allModels = await db
		.select()
		.from(models)
		.where(or(...[...modelIds].map((id) => eq(models.id, id))));

	const modelMap = new Map(allModels.map((m) => [m.id, m]));

	return limitedComparisons
		.map((c) => {
			const modelA = modelMap.get(c.modelAId);
			const modelB = modelMap.get(c.modelBId);
			if (!modelA || !modelB) return null;
			return { comparison: c, modelA, modelB };
		})
		.filter((item): item is ComparisonWithModels => item !== null);
}
