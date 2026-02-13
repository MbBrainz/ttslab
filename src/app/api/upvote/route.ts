import { NextResponse } from "next/server";
import {
	getModelBySlug,
	getUpvoteStatus,
	recordUpvote,
} from "@/lib/db/queries";

const FINGERPRINT_REGEX = /^[a-f0-9]{64}$/;

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const modelSlug = searchParams.get("model");
		const fingerprint = searchParams.get("fingerprint");

		if (!modelSlug || !fingerprint) {
			return NextResponse.json(
				{ error: "model and fingerprint query params are required" },
				{ status: 400 },
			);
		}

		const model = await getModelBySlug(modelSlug);

		if (!model) {
			return NextResponse.json({ error: "Model not found" }, { status: 404 });
		}

		const status = await getUpvoteStatus(model.id, fingerprint);

		return NextResponse.json(status);
	} catch (error) {
		console.error("Failed to get upvote status:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { modelSlug, fingerprint } = body;

		if (!modelSlug || !fingerprint) {
			return NextResponse.json(
				{ error: "modelSlug and fingerprint are required" },
				{ status: 400 },
			);
		}

		if (
			typeof fingerprint !== "string" ||
			!FINGERPRINT_REGEX.test(fingerprint)
		) {
			return NextResponse.json(
				{ error: "fingerprint must be a 64-character hex string" },
				{ status: 400 },
			);
		}

		const model = await getModelBySlug(modelSlug);

		if (!model) {
			return NextResponse.json({ error: "Model not found" }, { status: 404 });
		}

		const count = await recordUpvote(model.id, fingerprint);

		return NextResponse.json({
			count,
			userVoted: true,
		});
	} catch (error) {
		console.error("Failed to upvote:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
