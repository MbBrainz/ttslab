import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comparisons, models, upvotes } from "@/lib/db/schema";

export async function GET() {
	try {
		const [totalModelsResult] = await db
			.select({ value: count() })
			.from(models);

		const [supportedModelsResult] = await db
			.select({ value: count() })
			.from(models)
			.where(eq(models.status, "supported"));

		const [totalUpvotesResult] = await db
			.select({ value: count() })
			.from(upvotes);

		const [totalComparisonsResult] = await db
			.select({ value: count() })
			.from(comparisons);

		return NextResponse.json({
			totalModels: Number(totalModelsResult.value),
			supportedModels: Number(supportedModelsResult.value),
			totalUpvotes: Number(totalUpvotesResult.value),
			totalComparisons: Number(totalComparisonsResult.value),
		});
	} catch (error) {
		console.error("Failed to fetch stats:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
