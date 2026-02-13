import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
	{
		variants: {
			variant: {
				default:
					"border-transparent bg-primary text-primary-foreground shadow-sm",
				secondary: "border-transparent bg-secondary text-secondary-foreground",
				outline: "border-border text-foreground",
				success:
					"border-transparent bg-success text-success-foreground shadow-sm",
				warning:
					"border-transparent bg-warning text-warning-foreground shadow-sm",
				destructive:
					"border-transparent bg-destructive text-destructive-foreground shadow-sm",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

type BadgeProps = React.ComponentProps<"div"> &
	VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
	return (
		<div className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, badgeVariants };
export type { BadgeProps };
