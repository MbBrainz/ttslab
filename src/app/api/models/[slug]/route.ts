import { NextResponse } from "next/server";
import { getModelBySlugWithUpvotes } from "@/lib/db/queries";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ slug: string }> },
) {
	try {
		const { slug } = await params;

		const result = await getModelBySlugWithUpvotes(slug);

		if (!result) {
			return NextResponse.json({ error: "Model not found" }, { status: 404 });
		}

		return NextResponse.json({
			...result.model,
			upvoteCount: Number(result.upvoteCount),
		});
	} catch (error) {
		console.error("Failed to fetch model:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
