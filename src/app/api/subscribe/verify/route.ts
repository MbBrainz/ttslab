import { NextResponse } from "next/server";
import { verifySubscription } from "@/lib/db/queries";

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

		const verified = await verifySubscription(token);

		if (!verified) {
			return NextResponse.json(
				{ error: "Invalid or expired verification token" },
				{ status: 400 },
			);
		}

		return NextResponse.redirect(new URL("/?verified=true", request.url));
	} catch (error) {
		console.error("Failed to verify subscription:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
