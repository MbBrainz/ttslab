"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function NavLinks() {
	const pathname = usePathname();

	return (
		<div className="hidden items-center gap-6 sm:flex">
			{NAV_LINKS.map((link) => (
				<Link
					key={link.href}
					href={link.href}
					className={cn(
						"border-b-2 border-transparent pb-0.5 text-sm transition-colors hover:text-foreground",
						pathname === link.href || pathname.startsWith(`${link.href}/`)
							? "border-primary text-foreground"
							: "text-muted-foreground",
					)}
				>
					{link.label}
				</Link>
			))}
		</div>
	);
}
