import { eq } from "drizzle-orm";
import { db } from "..";
import { subscriptions } from "../schema";

/** Create a new subscription. Throws on unique constraint violation. */
export async function createSubscription(data: {
	email: string;
	modelId: string | null;
	comparisonKey: string | null;
	verifyToken: string;
}): Promise<void> {
	await db.insert(subscriptions).values({
		email: data.email,
		modelId: data.modelId,
		comparisonKey: data.comparisonKey,
		verified: false,
		verifyToken: data.verifyToken,
	});
}

/** Verify a subscription by token. Returns true if the token was found and verified. */
export async function verifySubscription(token: string): Promise<boolean> {
	const [result] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.verifyToken, token))
		.limit(1);

	if (!result) return false;

	await db
		.update(subscriptions)
		.set({ verified: true, verifyToken: null })
		.where(eq(subscriptions.id, result.id));

	return true;
}
