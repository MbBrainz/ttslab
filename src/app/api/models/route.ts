import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { models } from "@/lib/db/schema";

export async function GET() {
	try {
		const result = await db
			.select({
				model: models,
				upvoteCount: sql<number>`(SELECT count(*) FROM upvotes WHERE model_id = models.id)`,
			})
			.from(models)
			.orderBy(
				desc(sql`(SELECT count(*) FROM upvotes WHERE model_id = models.id)`),
			);

		return NextResponse.json(
			result.map((r) => ({
				...r.model,
				upvoteCount: Number(r.upvoteCount),
			})),
		);
	} catch (error) {
		console.error("Failed to fetch models:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
