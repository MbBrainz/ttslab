import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { models, subscriptions } from "@/lib/db/schema";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { email, modelSlug, comparisonSlug } = body;

		if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email)) {
			return NextResponse.json(
				{ error: "A valid email address is required" },
				{ status: 400 },
			);
		}

		let modelId: string | undefined;

		if (modelSlug) {
			const model = await db
				.select()
				.from(models)
				.where(eq(models.slug, modelSlug))
				.limit(1);

			if (model.length === 0) {
				return NextResponse.json({ error: "Model not found" }, { status: 404 });
			}

			modelId = model[0].id;
		}

		const verifyToken = crypto.randomUUID();

		try {
			await db.insert(subscriptions).values({
				email,
				modelId: modelId ?? null,
				comparisonKey: comparisonSlug ?? null,
				verified: false,
				verifyToken,
			});
		} catch (insertError: unknown) {
			// Handle unique constraint violation (duplicate subscription)
			if (
				(insertError instanceof Error &&
					insertError.message.includes("unique")) ||
				(insertError instanceof Error &&
					insertError.message.includes("duplicate"))
			) {
				return NextResponse.json({
					success: true,
					message: "Already subscribed",
				});
			}
			throw insertError;
		}

		// TODO: Send verification email via Resend
		// await resend.emails.send({
		//   to: email,
		//   subject: "Verify your TTSLab subscription",
		//   html: `<a href="${process.env.NEXT_PUBLIC_URL}/api/subscribe/verify?token=${verifyToken}">Verify</a>`,
		// });

		return NextResponse.json({
			success: true,
			message: "Check your email to verify",
		});
	} catch (error) {
		console.error("Failed to subscribe:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
