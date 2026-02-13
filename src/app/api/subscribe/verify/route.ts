import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const token = searchParams.get("token");

		if (!token) {
			return NextResponse.json(
				{ error: "Verification token is required" },
				{ status: 400 },
			);
		}

		const result = await db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.verifyToken, token))
			.limit(1);

		if (result.length === 0) {
			return NextResponse.json(
				{ error: "Invalid or expired verification token" },
				{ status: 400 },
			);
		}

		await db
			.update(subscriptions)
			.set({ verified: true, verifyToken: null })
			.where(eq(subscriptions.id, result[0].id));

		return NextResponse.redirect(new URL("/?verified=true", request.url));
	} catch (error) {
		console.error("Failed to verify subscription:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
