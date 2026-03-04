"use client";

import { X } from "lucide-react";
import { Select, SelectOption } from "@/components/ui/select";
import { LLM_MODELS, type LlmModel } from "@/lib/inference/llm-types";
import type { Voice } from "@/lib/inference/types";
import type { ConversationTurn } from "@/lib/hooks/use-voice-agent";
import { cn } from "@/lib/utils";

interface SettingsDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// Voice
	voices: Voice[];
	selectedVoice: string;
	onVoiceChange: (voice: string) => void;
	// LLM
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
					onClick={() => onOpenChange(false)}
					className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
				>
					<X className="h-5 w-5" />
				</button>

				<h2 className="mb-6 text-lg font-semibold">Settings</h2>

				{/* Voice & LLM selectors */}
				<div className="space-y-4">
					<div className="space-y-2">
						<label className="text-sm font-medium text-muted-foreground">
							Voice
						</label>
						<Select
							value={selectedVoice}
							onChange={(e) =>
								onVoiceChange(
									(e.target as HTMLSelectElement).value,
								)
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
						<label className="text-sm font-medium text-muted-foreground">
							LLM Model
						</label>
						<Select
							value={selectedLlm.id}
							onChange={(e) => {
								const model = LLM_MODELS.find(
									(m) =>
										m.id ===
										(e.target as HTMLSelectElement).value,
								);
								if (model) onLlmChange(model);
							}}
							disabled={disabled}
						>
							{LLM_MODELS.map((m) => (
								<SelectOption key={m.id} value={m.id}>
									{m.name}
								</SelectOption>
							))}
						</Select>
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
										{turn.role === "user"
											? "You"
											: "Agent"}
									</span>
									<p className="text-sm text-foreground/80">
										{turn.content}
									</p>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</>
	);
}
