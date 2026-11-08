import { getWebGPUDiagnostics, type WebGPUDiagnostics } from "./backend-select";
import type { LlmModel } from "./llm-types";

/**
 * Minimal structural types for the WebGPU adapter — the project's TS DOM lib
 * does not ship WebGPU declarations, and we only need the feature set here.
 */
interface MinimalGPUAdapter {
	features: { has(feature: string): boolean };
}

/**
 * Client capability snapshot used to gate LLM engine entries. Probed once on
 * mount; `null` while probing. Pure functions below do the actual gating so
 * they are unit-testable without a GPU.
 */
export interface LlmCapability {
	/** True once the probe has completed (successfully or not). */
	probed: boolean;
	/** A usable WebGPU adapter was found. */
	webgpu: boolean;
	/** Adapter supports the shader-f16 feature (required by q4f16 weights). */
	shaderF16: boolean;
	/** Adapter vendor string when known (for honest UI display). */
	vendor?: string;
	maxBufferSize?: number;
	diagnostics?: WebGPUDiagnostics;
}

/** Capability while probing or in non-DOM environments: only WASM entries. */
export const CAPABILITY_UNPROBED: LlmCapability = {
	probed: false,
	webgpu: false,
	shaderF16: false,
};

/**
 * Probe the client for LLM-relevant GPU capability. Reuses the existing
 * backend-select diagnostics helper (availability, vendor, limits), then
 * requests the adapter once more for the feature set, which
 * getWebGPUDiagnostics does not expose — features live on the adapter, not
 * the device.
 */
export async function probeLlmCapability(): Promise<LlmCapability> {
	const diagnostics = await getWebGPUDiagnostics();
	if (!diagnostics.available) {
		return {
			probed: true,
			webgpu: false,
			shaderF16: false,
			diagnostics,
		};
	}

	let shaderF16 = false;
	try {
		const gpu = (
			navigator as {
				gpu?: { requestAdapter(): Promise<MinimalGPUAdapter | null> };
			}
		).gpu;
		const adapter = await gpu?.requestAdapter();
		shaderF16 = adapter?.features.has("shader-f16") ?? false;
	} catch {
		// Adapter vanished between probes — treat as no shader-f16.
	}

	return {
		probed: true,
		webgpu: true,
		shaderF16,
		vendor:
			diagnostics.vendor && diagnostics.vendor !== "unknown"
				? diagnostics.vendor
				: undefined,
		maxBufferSize: diagnostics.maxBufferSize,
		diagnostics,
	};
}

/**
 * Honest gating: WebGPU-only entries are offered only when the adapter and
 * its shader-f16 feature are present. WASM-capable entries (transformers.js
 * tier, wllama tier) are always available in a browser.
 */
export function isModelAvailable(
	model: LlmModel,
	cap: LlmCapability | null,
): boolean {
	if (!model.requiresWebGPU) return true;
	if (!cap?.probed) return false;
	if (!cap.webgpu) return false;
	if (model.requiresShaderF16 && !cap.shaderF16) return false;
	return true;
}

/** Filter the model list down to entries this client can actually run. */
export function availableLlmModels(
	models: LlmModel[],
	cap: LlmCapability | null,
): LlmModel[] {
	return models.filter((m) => isModelAvailable(m, cap));
}
