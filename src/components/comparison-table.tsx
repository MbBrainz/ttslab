import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Model } from "@/lib/db/schema";

type ComparisonTableProps = {
	modelA: Model;
	modelB: Model;
};

function BoolCell({ value }: { value: boolean | null }) {
	if (value === true)
		return <Check className="mx-auto h-4 w-4 text-success" aria-label="Yes" />;
	if (value === false)
		return <X className="mx-auto h-4 w-4 text-destructive" aria-label="No" />;
	return <span className="text-muted-foreground">&mdash;</span>;
}

function ValueCell({
	value,
	suffix,
}: {
	value: string | number | null | undefined;
	suffix?: string;
}) {
	if (value == null) {
		return <span className="text-muted-foreground">&mdash;</span>;
	}
	return (
		<span className="font-mono tabular-nums">
			{value}
			{suffix && <span className="text-muted-foreground">{suffix}</span>}
		</span>
	);
}

type Row = {
	label: string;
	renderA: React.ReactNode;
	renderB: React.ReactNode;
};

function buildRows(modelA: Model, modelB: Model): Row[] {
	return [
		{
			label: "Size",
			renderA: (
				<ValueCell
					value={modelA.sizeMb != null ? modelA.sizeMb.toFixed(0) : null}
					suffix=" MB"
				/>
			),
			renderB: (
				<ValueCell
					value={modelB.sizeMb != null ? modelB.sizeMb.toFixed(0) : null}
					suffix=" MB"
				/>
			),
		},
		{
			label: "Parameters",
			renderA: (
				<ValueCell
					value={modelA.paramsMillions != null ? modelA.paramsMillions : null}
					suffix="M"
				/>
			),
			renderB: (
				<ValueCell
					value={modelB.paramsMillions != null ? modelB.paramsMillions : null}
					suffix="M"
				/>
			),
		},
		{
			label: "Voices",
			renderA: <ValueCell value={modelA.voices} />,
			renderB: <ValueCell value={modelB.voices} />,
		},
		{
			label: "Streaming",
			renderA: <BoolCell value={modelA.supportsStreaming ?? null} />,
			renderB: <BoolCell value={modelB.supportsStreaming ?? null} />,
		},
		{
			label: "WebGPU",
			renderA: <BoolCell value={modelA.supportsWebgpu ?? null} />,
			renderB: <BoolCell value={modelB.supportsWebgpu ?? null} />,
		},
		{
			label: "WASM",
			renderA: <BoolCell value={modelA.supportsWasm ?? null} />,
			renderB: <BoolCell value={modelB.supportsWasm ?? null} />,
		},
		{
			label: "Languages",
			renderA: modelA.languages?.length ? (
				<div className="flex flex-wrap gap-1">
					{modelA.languages.map((lang) => (
						<Badge key={lang} variant="outline" className="text-[10px]">
							{lang}
						</Badge>
					))}
				</div>
			) : (
				<span className="text-muted-foreground">&mdash;</span>
			),
			renderB: modelB.languages?.length ? (
				<div className="flex flex-wrap gap-1">
					{modelB.languages.map((lang) => (
						<Badge key={lang} variant="outline" className="text-[10px]">
							{lang}
						</Badge>
					))}
				</div>
			) : (
				<span className="text-muted-foreground">&mdash;</span>
			),
		},
		{
			label: "License",
			renderA: <ValueCell value={modelA.license} />,
			renderB: <ValueCell value={modelB.license} />,
		},
	];
}

export function ComparisonTable({ modelA, modelB }: ComparisonTableProps) {
	const rows = buildRows(modelA, modelB);

	return (
		<div className="overflow-x-auto rounded-lg border border-border">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border bg-secondary/50">
						<th className="px-4 py-3 text-left font-medium text-muted-foreground">
							Spec
						</th>
						<th className="px-4 py-3 text-center font-medium">{modelA.name}</th>
						<th className="px-4 py-3 text-center font-medium">{modelB.name}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.label}
							className="border-b border-border last:border-b-0"
						>
							<td className="px-4 py-3 font-medium text-muted-foreground">
								{row.label}
							</td>
							<td className="px-4 py-3 text-center">{row.renderA}</td>
							<td className="px-4 py-3 text-center">{row.renderB}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
