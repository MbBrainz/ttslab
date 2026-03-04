export interface WebGPUDiagnostics {
	available: boolean;
	vendor?: string;
	architecture?: string;
	description?: string;
	maxBufferSize?: number;
	maxStorageBufferBindingSize?: number;
	error?: string;
}

export async function selectBackend(
	supportsWebgpu: boolean,
	supportsWasm: boolean,
	preferredBackend: "webgpu" | "wasm" | "auto" = "auto",
): Promise<"webgpu" | "wasm"> {
	if (preferredBackend === "wasm") return "wasm";

	if (preferredBackend === "webgpu" && supportsWebgpu) {
		const diag = await getWebGPUDiagnostics();
		if (diag.available) return "webgpu";
		// User explicitly chose WebGPU — throw instead of silent fallback
		throw new Error(
			`WebGPU is not available on this device. ${diag.error ?? "No GPU adapter found."}`,
		);
	}

	if (preferredBackend === "auto" && supportsWebgpu) {
		const diag = await getWebGPUDiagnostics();
		if (diag.available) return "webgpu";
		// Auto mode: silently fall back to WASM
	}

	if (supportsWasm) return "wasm";

	throw new Error("No compatible backend available for this model");
}

export async function getWebGPUDiagnostics(): Promise<WebGPUDiagnostics> {
	if (typeof navigator === "undefined" || !("gpu" in navigator)) {
		const result: WebGPUDiagnostics = {
			available: false,
			error: "WebGPU API not present in this environment",
		};
		console.log("[backend-select] WebGPU probe:", result);
		return result;
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const gpu = (navigator as any).gpu;
		const adapter = await gpu.requestAdapter();
		if (!adapter) {
			const result: WebGPUDiagnostics = {
				available: false,
				error: "requestAdapter() returned null — no GPU adapter available",
			};
			console.log("[backend-select] WebGPU probe:", result);
			return result;
		}

		// Extract adapter info
		const info = adapter.info ?? (await adapter.requestAdapterInfo?.()) ?? {};

		// Validate by requesting a device (proves real capability)
		const device = await adapter.requestDevice();
		const limits = device.limits;

		const result: WebGPUDiagnostics = {
			available: true,
			vendor: info.vendor ?? "unknown",
			architecture: info.architecture ?? "unknown",
			description: info.description ?? info.device ?? "unknown",
			maxBufferSize: limits?.maxBufferSize,
			maxStorageBufferBindingSize: limits?.maxStorageBufferBindingSize,
		};

		console.log("[backend-select] WebGPU available:", result);

		// Clean up the device — we only needed it for probing
		device.destroy();

		return result;
	} catch (err) {
		const result: WebGPUDiagnostics = {
			available: false,
			error: err instanceof Error ? err.message : "Unknown WebGPU error",
		};
		console.log("[backend-select] WebGPU probe failed:", result);
		return result;
	}
}
