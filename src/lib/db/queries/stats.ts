import { count, eq } from "drizzle-orm";
import { db } from "..";
import { comparisons, models, upvotes } from "../schema";
import type { SiteStats } from "../types";

/** Fetch aggregate site statistics. */
export async function getSiteStats(): Promise<SiteStats> {
	const [
		totalModelsResult,
		supportedModelsResult,
		totalUpvotesResult,
		totalComparisonsResult,
	] = await Promise.all([
		db.select({ value: count() }).from(models),
		db
			.select({ value: count() })
			.from(models)
			.where(eq(models.status, "supported")),
		db.select({ value: count() }).from(upvotes),
		db.select({ value: count() }).from(comparisons),
	]);

	return {
		totalModels: Number(totalModelsResult[0].value),
		supportedModels: Number(supportedModelsResult[0].value),
		totalUpvotes: Number(totalUpvotesResult[0].value),
		totalComparisons: Number(totalComparisonsResult[0].value),
	};
}
