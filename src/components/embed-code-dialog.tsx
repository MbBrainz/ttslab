"use client";

import { Check, Code, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { APP_URL } from "@/lib/constants";

type EmbedCodeDialogProps = {
	modelSlug: string;
	modelName: string;
};

export function EmbedCodeDialog({
	modelSlug,
	modelName,
}: EmbedCodeDialogProps) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const embedCode = `<iframe src="${APP_URL}/embed/${modelSlug}" width="100%" height="400" frameborder="0" allow="autoplay"></iframe>`;

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(embedCode);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement("textarea");
			textarea.value = embedCode;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand("copy");
			document.body.removeChild(textarea);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}, [embedCode]);

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={() => setOpen(true)}
				className="gap-2"
			>
				<Code className="h-4 w-4" />
				Embed
			</Button>

			<Dialog open={open} onClose={() => setOpen(false)}>
				<DialogHeader>
					<DialogTitle>Embed {modelName}</DialogTitle>
					<DialogClose onClose={() => setOpen(false)} />
				</DialogHeader>
				<DialogContent>
					<p className="mb-3 text-sm text-muted-foreground">
						Copy the code below to embed this TTS demo on your website.
					</p>
					<div className="relative rounded-md border border-border bg-secondary/50 p-3">
						<pre className="overflow-x-auto text-xs text-foreground">
							<code>{embedCode}</code>
						</pre>
						<Button
							variant="ghost"
							size="icon"
							className="absolute right-2 top-2 h-7 w-7"
							onClick={handleCopy}
						>
							{copied ? (
								<Check className="h-3.5 w-3.5 text-success" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
