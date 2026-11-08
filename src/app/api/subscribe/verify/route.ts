import { NextResponse } from "next/server";
import { verifySubscription } from "@/lib/db/queries";
import {
	getClientIp,
	subscribeVerifyIpLimiter,
	tooManyRequests,
} from "@/lib/rate-limit";

export async function GET(request: Request) {
	try {
		// Gate token guessing: per-IP, per serverless instance
		// (see src/lib/rate-limit.ts for the honest limitation).
		const ipCheck = subscribeVerifyIpLimiter.check(getClientIp(request));
		if (!ipCheck.ok) {
			return tooManyRequests(ipCheck.retryAfterSeconds);
		}

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
