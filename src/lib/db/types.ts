import type { Comparison, Model } from "./schema";

/** A model row joined with its upvote count. */
export type ModelWithUpvotes = {
	model: Model;
	upvoteCount: number;
};

/** Flattened model with upvoteCount merged in (used by client components). */
export type ModelWithUpvoteCount = Model & { upvoteCount: number };

/** A comparison row together with both related model rows. */
export type ComparisonWithModels = {
	comparison: Comparison;
	modelA: Model;
	modelB: Model;
};

/** Site-wide aggregate statistics. */
export type SiteStats = {
	totalModels: number;
	supportedModels: number;
	totalUpvotes: number;
	totalComparisons: number;
};
