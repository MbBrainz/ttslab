"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Native Select (kept for backwards compatibility, e.g. tts-demo)           */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  CustomSelect -- dark-mode-friendly, no native <select> dropdown           */
/* -------------------------------------------------------------------------- */

type CustomSelectProps = {
	value: string;
	onValueChange: (value: string) => void;
	options: { value: string; label: string }[];
	placeholder?: string;
	className?: string;
};

function CustomSelect({
	value,
	onValueChange,
	options,
	placeholder = "Select...",
	className,
}: CustomSelectProps) {
	const [open, setOpen] = React.useState(false);
	const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
	const containerRef = React.useRef<HTMLDivElement>(null);
	const triggerRef = React.useRef<HTMLButtonElement>(null);
	const listboxId = React.useId();

	const selectedLabel =
		options.find((o) => o.value === value)?.label ?? placeholder;

	// Close on outside click
	React.useEffect(() => {
		if (!open) return;

		function handleClick(e: MouseEvent) {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setOpen(false);
			}
		}

		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	// Reset highlight when opening
	React.useEffect(() => {
		if (open) {
			const idx = options.findIndex((o) => o.value === value);
			setHighlightedIndex(idx >= 0 ? idx : 0);
		}
	}, [open, options, value]);

	function handleKeyDown(e: React.KeyboardEvent) {
		if (!open) {
			if (
				e.key === "ArrowDown" ||
				e.key === "ArrowUp" ||
				e.key === "Enter" ||
				e.key === " "
			) {
				e.preventDefault();
				setOpen(true);
			}
			return;
		}

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setHighlightedIndex((prev) =>
					prev < options.length - 1 ? prev + 1 : 0,
				);
				break;
			case "ArrowUp":
				e.preventDefault();
				setHighlightedIndex((prev) =>
					prev > 0 ? prev - 1 : options.length - 1,
				);
				break;
			case "Home":
				e.preventDefault();
				setHighlightedIndex(0);
				break;
			case "End":
				e.preventDefault();
				setHighlightedIndex(options.length - 1);
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				if (highlightedIndex >= 0 && highlightedIndex < options.length) {
					onValueChange(options[highlightedIndex].value);
					setOpen(false);
					triggerRef.current?.focus();
				}
				break;
			case "Escape":
				e.preventDefault();
				setOpen(false);
				triggerRef.current?.focus();
				break;
		}
	}

	return (
		<div
			ref={containerRef}
			className={cn("relative", className)}
			onKeyDown={handleKeyDown}
		>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listboxId : undefined}
				className={cn(
					"flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-sm transition-colors",
					"hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				)}
			>
				<span className="truncate">{selectedLabel}</span>
				<ChevronDown
					className={cn(
						"ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
				/>
			</button>

			{open && (
				<div
					role="listbox"
					tabIndex={-1}
					id={listboxId}
					aria-label={selectedLabel}
					aria-activedescendant={
						highlightedIndex >= 0
							? `${listboxId}-option-${highlightedIndex}`
							: undefined
					}
					className={cn(
						"absolute left-0 top-full z-50 mt-1 w-full min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg",
						"animate-in fade-in-0 zoom-in-95",
					)}
				>
					{options.map((option, index) => (
						<button
							type="button"
							key={option.value}
							id={`${listboxId}-option-${index}`}
							role="option"
							aria-selected={option.value === value}
							className={cn(
								"w-full cursor-pointer select-none rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
								option.value === value && "bg-accent text-accent-foreground",
								index === highlightedIndex &&
									option.value !== value &&
									"bg-accent",
							)}
							onClick={() => {
								onValueChange(option.value);
								setOpen(false);
								triggerRef.current?.focus();
							}}
							onMouseEnter={() => setHighlightedIndex(index)}
						>
							{option.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
CustomSelect.displayName = "CustomSelect";

export { Select, SelectOption, CustomSelect };
export type { SelectProps, SelectOptionProps, CustomSelectProps };
