import { and, count, eq } from "drizzle-orm";
import { db } from "..";
import { upvotes } from "../schema";

/** Get the total upvote count for a model. */
export async function getUpvoteCount(modelId: string): Promise<number> {
	const [result] = await db
		.select({ value: count() })
		.from(upvotes)
		.where(eq(upvotes.modelId, modelId));

	return Number(result.value);
}

/** Check whether a specific fingerprint has upvoted a model. */
export async function hasUserUpvoted(
	modelId: string,
	fingerprint: string,
): Promise<boolean> {
	const [result] = await db
		.select({ value: count() })
		.from(upvotes)
		.where(
			and(eq(upvotes.modelId, modelId), eq(upvotes.fingerprint, fingerprint)),
		);

	return Number(result.value) > 0;
}

/** Get the upvote count and whether a user has voted. */
export async function getUpvoteStatus(
	modelId: string,
	fingerprint: string,
): Promise<{ count: number; userVoted: boolean }> {
	const [upvoteCount, userVoted] = await Promise.all([
		getUpvoteCount(modelId),
		hasUserUpvoted(modelId, fingerprint),
	]);

	return { count: upvoteCount, userVoted };
}

/** Record an upvote (idempotent via onConflictDoNothing). Returns the new count. */
export async function recordUpvote(
	modelId: string,
	fingerprint: string,
): Promise<number> {
	await db
		.insert(upvotes)
		.values({ modelId, fingerprint })
		.onConflictDoNothing({
			target: [upvotes.modelId, upvotes.fingerprint],
		});

	return getUpvoteCount(modelId);
}
