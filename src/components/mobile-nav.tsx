"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_LINKS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function MobileNav() {
	const [open, setOpen] = useState(false);
	const pathname = usePathname();

	// Close on route change — pathname is intentionally a dependency trigger
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers close on navigation
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	// Lock body scroll when open
	useEffect(() => {
		if (open) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [open]);

	return (
		<div className="sm:hidden">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
				aria-label={open ? "Close menu" : "Open menu"}
			>
				{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
			</button>

			{open && (
				<>
					{/* Backdrop — fully opaque */}
					<div
						className="fixed top-14 right-0 bottom-0 left-0 z-40 bg-background"
						onClick={() => setOpen(false)}
						onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
						role="button"
						tabIndex={-1}
						aria-label="Close menu"
					/>
					{/* Menu panel */}
					<div className="fixed inset-x-0 top-14 z-[60] border-b border-border bg-background p-4 shadow-lg">
						<nav className="flex flex-col gap-1">
							{NAV_LINKS.map((link) => (
								<Link
									key={link.href}
									href={link.href}
									onClick={() => setOpen(false)}
									className={cn(
										"rounded-md px-3 py-2.5 text-base font-medium transition-colors",
										pathname === link.href ||
											pathname.startsWith(`${link.href}/`)
											? "bg-secondary text-foreground"
											: "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
									)}
								>
									{link.label}
								</Link>
							))}
						</nav>
					</div>
				</>
			)}
		</div>
	);
}
