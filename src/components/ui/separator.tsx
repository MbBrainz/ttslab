import * as React from "react";
import { cn } from "@/lib/utils";

type SeparatorProps = React.ComponentProps<"div"> & {
	orientation?: "horizontal" | "vertical";
	decorative?: boolean;
};

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
	(
		{ className, orientation = "horizontal", decorative = true, ...props },
		ref,
	) => (
		<div
			ref={ref}
			role={decorative ? "none" : "separator"}
			aria-orientation={decorative ? undefined : orientation}
			className={cn(
				"shrink-0 bg-border",
				orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
				className,
			)}
			{...props}
		/>
	),
);
Separator.displayName = "Separator";

export { Separator };
export type { SeparatorProps };
