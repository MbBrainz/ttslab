import { NextResponse } from "next/server";
import { getAllModelsWithUpvotesOrdered } from "@/lib/db/queries";

export async function GET() {
	try {
		const result = await getAllModelsWithUpvotesOrdered();

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
