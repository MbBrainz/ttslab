export async function selectBackend(
	supportsWebgpu: boolean,
	supportsWasm: boolean,
	preferredBackend: "webgpu" | "wasm" | "auto" = "auto",
): Promise<"webgpu" | "wasm"> {
	if (preferredBackend === "wasm") return "wasm";
	if (preferredBackend === "webgpu" && supportsWebgpu) {
		const available = await isWebGPUAvailable();
		if (available) return "webgpu";
	}

	if (preferredBackend === "auto" && supportsWebgpu) {
		const available = await isWebGPUAvailable();
		if (available) return "webgpu";
	}

	if (supportsWasm) return "wasm";

	throw new Error("No compatible backend available for this model");
}

async function isWebGPUAvailable(): Promise<boolean> {
	if (typeof navigator === "undefined") return false;
	if (!("gpu" in navigator)) return false;

	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const gpu = (navigator as any).gpu;
		const adapter = await gpu.requestAdapter();
		return adapter !== null;
	} catch {
		return false;
	}
}
