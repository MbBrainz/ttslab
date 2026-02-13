import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { models } from "@/lib/db/schema";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ slug: string }> },
) {
	try {
		const { slug } = await params;

		const result = await db
			.select({
				model: models,
				upvoteCount: sql<number>`(SELECT count(*) FROM upvotes WHERE model_id = models.id)`,
			})
			.from(models)
			.where(eq(models.slug, slug))
			.limit(1);

		if (result.length === 0) {
			return NextResponse.json({ error: "Model not found" }, { status: 404 });
		}

		return NextResponse.json({
			...result[0].model,
			upvoteCount: Number(result[0].upvoteCount),
		});
	} catch (error) {
		console.error("Failed to fetch model:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
