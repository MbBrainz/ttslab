import * as React from "react";
import { cn } from "@/lib/utils";

type SelectProps = React.ComponentProps<"select">;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
	({ className, children, ...props }, ref) => {
		return (
			<select
				className={cn(
					"flex h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
					"bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m4%206%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px_16px] bg-[position:right_8px_center] bg-no-repeat pr-8",
					className,
				)}
				ref={ref}
			>
				{children}
			</select>
		);
	},
);
Select.displayName = "Select";

type SelectOptionProps = React.ComponentProps<"option">;

const SelectOption = React.forwardRef<HTMLOptionElement, SelectOptionProps>(
	({ className, ...props }, ref) => {
		return (
			<option
				className={cn("bg-popover text-popover-foreground", className)}
				ref={ref}
				{...props}
			/>
		);
	},
);
SelectOption.displayName = "SelectOption";

export { Select, SelectOption };
export type { SelectProps, SelectOptionProps };
