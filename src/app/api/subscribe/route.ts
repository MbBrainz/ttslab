import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSubscription, getModelBySlug } from "@/lib/db/queries";

const resend = new Resend(process.env.RESEND_API_KEY);

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

		let modelId: string | null = null;

		if (modelSlug) {
			const model = await getModelBySlug(modelSlug);

			if (!model) {
				return NextResponse.json({ error: "Model not found" }, { status: 404 });
			}

			modelId = model.id;
		}

		const verifyToken = crypto.randomUUID();

		try {
			await createSubscription({
				email,
				modelId,
				comparisonKey: comparisonSlug ?? null,
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

		const verifyUrl = `https://ttslab.dev/api/subscribe/verify?token=${verifyToken}`;

		await resend.emails.send({
			from: "TTSLab <noreply@ttslab.dev>",
			to: email,
			subject: "Verify your TTSLab subscription",
			html: [
				'<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">',
				"<h2>Welcome to TTSLab</h2>",
				"<p>Click the button below to verify your email and complete your subscription.</p>",
				`<a href="${verifyUrl}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500">Verify Email</a>`,
				'<p style="margin-top:24px;font-size:13px;color:#71717a">If you didn\'t subscribe to TTSLab, you can safely ignore this email.</p>',
				"</div>",
			].join(""),
		});

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
