import { NextResponse } from "next/server";
import { getSiteStats } from "@/lib/db/queries";

export async function GET() {
	try {
		const stats = await getSiteStats();

		return NextResponse.json(stats);
	} catch (error) {
		console.error("Failed to fetch stats:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
