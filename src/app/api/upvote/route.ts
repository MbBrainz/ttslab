import { and, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { models, upvotes } from "@/lib/db/schema";

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

		const model = await db
			.select()
			.from(models)
			.where(eq(models.slug, modelSlug))
			.limit(1);

		if (model.length === 0) {
			return NextResponse.json({ error: "Model not found" }, { status: 404 });
		}

		const modelId = model[0].id;

		const [countResult] = await db
			.select({ value: count() })
			.from(upvotes)
			.where(eq(upvotes.modelId, modelId));

		const [userVoteResult] = await db
			.select({ value: count() })
			.from(upvotes)
			.where(
				and(eq(upvotes.modelId, modelId), eq(upvotes.fingerprint, fingerprint)),
			);

		return NextResponse.json({
			count: Number(countResult.value),
			userVoted: Number(userVoteResult.value) > 0,
		});
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

		const model = await db
			.select()
			.from(models)
			.where(eq(models.slug, modelSlug))
			.limit(1);

		if (model.length === 0) {
			return NextResponse.json({ error: "Model not found" }, { status: 404 });
		}

		const modelId = model[0].id;

		await db
			.insert(upvotes)
			.values({ modelId, fingerprint })
			.onConflictDoNothing({
				target: [upvotes.modelId, upvotes.fingerprint],
			});

		const [countResult] = await db
			.select({ value: count() })
			.from(upvotes)
			.where(eq(upvotes.modelId, modelId));

		return NextResponse.json({
			count: Number(countResult.value),
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
