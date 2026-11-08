"use client";

import { X } from "lucide-react";
import { Select, SelectOption } from "@/components/ui/select";
import type { ConversationTurn } from "@/lib/hooks/use-voice-agent";
import type { LlmCapability } from "@/lib/inference/llm-engine-select";
import type { LlmEngine, LlmModel } from "@/lib/inference/llm-types";
import type { Voice } from "@/lib/inference/types";
import { cn } from "@/lib/utils";

const ENGINE_LABELS: Record<LlmEngine, string> = {
	transformersjs: "transformers.js",
	webllm: "WebLLM",
	wllama: "wllama",
};

/** Honest picker label: model · engine · download size (· VRAM when GPU-only). */
function modelLabel(m: LlmModel): string {
	const size =
		m.sizeMb >= 1000 ? `${(m.sizeMb / 1000).toFixed(1)}GB` : `${m.sizeMb}MB`;
	const vram = m.vramMb
		? ` · ${m.vramMb >= 1000 ? `${(m.vramMb / 1000).toFixed(1)}GB` : `${m.vramMb}MB`} VRAM`
		: "";
	return `${m.name} · ${ENGINE_LABELS[m.engine]} · ${size}${vram}`;
}

interface SettingsDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Voice
	voices: Voice[];
	selectedVoice: string;
	onVoiceChange: (voice: string) => void;
	// LLM — list is pre-gated by client capability
	models: LlmModel[];
	capability: LlmCapability | null;
	selectedLlm: LlmModel;
	onLlmChange: (model: LlmModel) => void;
	// Conversation
	turns: ConversationTurn[];
	// Disabled state (when agent is active)
	disabled: boolean;
}

export function SettingsDrawer({
	open,
	onOpenChange,
	voices,
	selectedVoice,
	onVoiceChange,
	models,
	capability,
	selectedLlm,
	onLlmChange,
	turns,
	disabled,
}: SettingsDrawerProps) {
	return (
		<>
			{/* Backdrop */}
			{open && (
				<div
					className="fixed inset-0 z-50 bg-black/40"
					onClick={() => onOpenChange(false)}
				/>
			)}

			{/* Drawer */}
			<div
				className={cn(
					"fixed right-0 top-0 z-50 h-full w-80 border-l border-border bg-card p-6 transition-transform duration-300 ease-out",
					open ? "translate-x-0" : "translate-x-full",
				)}
			>
				{/* Close button */}
				<button
					type="button"
					aria-label="Close settings"
					onClick={() => onOpenChange(false)}
					className="absolute right-4 top-4 p-1 text-muted-foreground hover:text-foreground"
				>
					<X className="h-5 w-5" />
				</button>

				<h2 className="mb-6 text-lg font-semibold">Settings</h2>

				{/* Voice & LLM selectors */}
				<div className="space-y-4">
					<div className="space-y-2">
						<label
							htmlFor="voice-select"
							className="text-sm font-medium text-muted-foreground"
						>
							Voice
						</label>
						<Select
							id="voice-select"
							value={selectedVoice}
							onChange={(e) =>
								onVoiceChange((e.target as HTMLSelectElement).value)
							}
							disabled={disabled}
						>
							{voices.map((v) => (
								<SelectOption key={v.id} value={v.id}>
									{v.name}
								</SelectOption>
							))}
						</Select>
					</div>

					<div className="space-y-2">
						<label
							htmlFor="llm-model-select"
							className="text-sm font-medium text-muted-foreground"
						>
							LLM Model
						</label>
						<Select
							id="llm-model-select"
							value={selectedLlm.id}
							onChange={(e) => {
								const model = models.find(
									(m) => m.id === (e.target as HTMLSelectElement).value,
								);
								if (model) onLlmChange(model);
							}}
							disabled={disabled}
						>
							{models.map((m) => (
								<SelectOption key={m.id} value={m.id}>
									{modelLabel(m)}
								</SelectOption>
							))}
						</Select>
						{/* Honest tier note + capability summary */}
						<p className="text-xs text-muted-foreground/70">
							{selectedLlm.note}
						</p>
						<p className="text-xs text-muted-foreground/70">
							{capability?.probed
								? `WebGPU: ${capability.webgpu ? "available" : "not available"}${
										capability.webgpu
											? ` · shader-f16: ${capability.shaderF16 ? "yes" : "no"}${capability.vendor ? ` · ${capability.vendor}` : ""}`
											: ""
									}`
								: "Probing GPU capability…"}
						</p>
						<p className="text-xs text-muted-foreground/70">
							Context pinned at {selectedLlm.contextTokens} tokens for all
							engines.
						</p>
					</div>
				</div>

				{/* Full conversation transcript */}
				<div className="mt-8">
					<h3 className="mb-3 text-sm font-medium text-muted-foreground">
						Conversation History
					</h3>
					<div className="max-h-[calc(100vh-280px)] space-y-3 overflow-y-auto">
						{turns.length === 0 ? (
							<p className="text-sm text-muted-foreground/50">
								No conversation yet.
							</p>
						) : (
							turns.map((turn) => (
								<div key={turn.id}>
									<span className="text-xs font-medium text-muted-foreground">
										{turn.role === "user" ? "You" : "Agent"}
									</span>
									<p className="text-sm text-foreground/80">{turn.content}</p>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</>
	);
}
