"use client";

import { useEffect, useState } from "react";
import {
	type LlmCapability,
	probeLlmCapability,
} from "@/lib/inference/llm-engine-select";

/**
 * Probe WebGPU capability once on mount for LLM engine gating. Returns null
 * while probing; components should treat unprobed as "only WASM-capable
 * entries shown" to avoid flashing GPU-only models that then get gated off.
 */
export function useLlmCapability(): LlmCapability | null {
	const [capability, setCapability] = useState<LlmCapability | null>(null);

	useEffect(() => {
		let cancelled = false;
		probeLlmCapability().then((cap) => {
			if (!cancelled) setCapability(cap);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return capability;
}
