"use client";

import { Check, Loader2 } from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SubscribeFormProps = {
	modelSlug?: string;
	comparisonSlug?: string;
};

export function SubscribeForm({
	modelSlug,
	comparisonSlug,
}: SubscribeFormProps) {
	const [email, setEmail] = useState("");
	const [status, setStatus] = useState<
		"idle" | "loading" | "success" | "error"
	>("idle");
	const [errorMessage, setErrorMessage] = useState("");

	const handleSubmit = useCallback(
		async (e: FormEvent) => {
			e.preventDefault();
			if (!email || status === "loading") return;

			setStatus("loading");
			setErrorMessage("");

			try {
				const response = await fetch("/api/subscribe", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						email,
						...(modelSlug && { modelSlug }),
						...(comparisonSlug && { comparisonSlug }),
					}),
				});

				if (!response.ok) {
					const data = await response.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error || "Failed to subscribe",
					);
				}

				setStatus("success");
				setEmail("");
			} catch (err) {
				setStatus("error");
				setErrorMessage(
					err instanceof Error ? err.message : "Something went wrong",
				);
			}
		},
		[email, status, modelSlug, comparisonSlug],
	);

	if (status === "success") {
		return (
			<div
				role="status"
				className="flex items-center justify-center gap-2 text-sm text-success"
			>
				<Check className="h-4 w-4" />
				<span>Subscribed! Check your email to confirm.</span>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex items-start gap-2">
			<div className="flex-1">
				<Input
					type="email"
					placeholder="your@email.com"
					aria-label="Email address"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
					disabled={status === "loading"}
				/>
				{status === "error" && errorMessage && (
					<p role="alert" className="mt-1 text-xs text-destructive">
						{errorMessage}
					</p>
				)}
			</div>
			<Button
				type="submit"
				size="sm"
				disabled={status === "loading"}
				aria-label={status === "loading" ? "Subscribing..." : undefined}
			>
				{status === "loading" ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					"Notify me"
				)}
			</Button>
		</form>
	);
}
