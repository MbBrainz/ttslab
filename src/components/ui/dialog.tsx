"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function Dialog({
	open,
	onClose,
	children,
	className,
}: {
	open: boolean;
	onClose: () => void;
	children: React.ReactNode;
	className?: string;
}) {
	const ref = React.useRef<HTMLDialogElement>(null);

	React.useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;

		if (open) {
			dialog.showModal();
		} else {
			dialog.close();
		}
	}, [open]);

	React.useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;

		const handleClose = () => onClose();
		dialog.addEventListener("close", handleClose);
		return () => dialog.removeEventListener("close", handleClose);
	}, [onClose]);

	// Close on backdrop click
	const handleClick = (e: React.MouseEvent<HTMLDialogElement>) => {
		if (e.target === ref.current) {
			onClose();
		}
	};

	return (
		<dialog
			ref={ref}
			onClick={handleClick}
			className={cn(
				"w-full max-w-md rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50",
				className,
			)}
		>
			{children}
		</dialog>
	);
}

function DialogHeader({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex items-center justify-between border-b border-border px-6 py-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

function DialogTitle({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<h2 className={cn("text-lg font-semibold", className)}>{children}</h2>
	);
}

function DialogClose({
	onClose,
	className,
}: {
	onClose: () => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClose}
			className={cn(
				"rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
		>
			<X className="h-4 w-4" />
			<span className="sr-only">Close</span>
		</button>
	);
}

function DialogContent({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return <div className={cn("px-6 py-4", className)}>{children}</div>;
}

export { Dialog, DialogHeader, DialogTitle, DialogContent, DialogClose };
