"use client";

import { Check } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function VerifiedDialog() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const isVerified = searchParams.get("verified") === "true";

	const handleClose = useCallback(() => {
		router.replace("/", { scroll: false });
	}, [router]);

	return (
		<Dialog open={isVerified} onClose={handleClose}>
			<DialogHeader>
				<DialogTitle>Email Verified</DialogTitle>
				<DialogClose onClose={handleClose} />
			</DialogHeader>
			<DialogContent className="flex flex-col items-center gap-4 pb-6 text-center">
				<div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
					<Check className="h-6 w-6 text-green-500" />
				</div>
				<p className="text-sm text-muted-foreground">
					Your subscription is confirmed. You'll receive updates on new
					models, features, and benchmarks from TTSLab.
				</p>
				<Button onClick={handleClose} className="mt-2">
					Got it
				</Button>
			</DialogContent>
		</Dialog>
	);
}
