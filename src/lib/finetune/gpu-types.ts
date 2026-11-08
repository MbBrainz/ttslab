/**
 * Minimal structural WebGPU types for the Finetune Lab trainer — the same
 * approach as `src/lib/inference/loaders/woof-gpu.ts` (the DOM lib in this
 * repo does not include WebGPU types and we carry no @webgpu/types
 * dependency). Numeric usage constants follow the WebGPU spec. Written fresh
 * for this module; nothing is imported from the Woof loader.
 */

export const FT_BUFFER_USAGE = {
	MAP_READ: 0x0001,
	COPY_SRC: 0x0004,
	COPY_DST: 0x0008,
	UNIFORM: 0x0040,
	STORAGE: 0x0080,
} as const;

export const FT_MAP_MODE_READ = 0x0001;

export interface FtBuffer {
	size: number;
	label?: string;
	mapAsync(mode: number): Promise<void>;
	getMappedRange(): ArrayBuffer;
	unmap(): void;
	destroy(): void;
}

export interface FtBufferDescriptor {
	size: number;
	usage: number;
	label?: string;
	mappedAtCreation?: boolean;
}

export interface FtQueue {
	writeBuffer(
		buffer: FtBuffer,
		bufferOffset: number,
		data: ArrayBufferView | ArrayBuffer,
		dataOffset?: number,
		size?: number,
	): void;
	submit(commandBuffers: unknown[]): void;
}

export type FtBindGroupLayout = Record<string, never>;

export type FtBindGroup = Record<string, never>;

export interface FtComputePipeline {
	getBindGroupLayout(index: number): FtBindGroupLayout;
}

export interface FtBindGroupDescriptor {
	layout: FtBindGroupLayout;
	entries: Array<{
		binding: number;
		resource: { buffer: FtBuffer; offset?: number; size?: number };
	}>;
	label?: string;
}

export interface FtComputePipelineDescriptor {
	layout: "auto";
	compute: { module: FtShaderModule; entryPoint: string };
	label?: string;
}

export type FtShaderModule = Record<string, never>;

export interface FtCommandEncoder {
	beginComputePass(): FtComputePassEncoder;
	copyBufferToBuffer(
		source: FtBuffer,
		sourceOffset: number,
		destination: FtBuffer,
		destinationOffset: number,
		size: number,
	): void;
	finish(): unknown;
}

export interface FtComputePassEncoder {
	setPipeline(pipeline: FtComputePipeline): void;
	setBindGroup(index: number, bindGroup: FtBindGroup): void;
	dispatchWorkgroups(x: number, y?: number, z?: number): void;
	end(): void;
}

export interface FtDevice {
	/** `device.lost` resolves when the GPU device is removed (driver reset,
	 * tab GPU pressure). The trainer surfaces this as a resettable error. */
	lost?: Promise<unknown>;
	limits: {
		maxBufferSize: number;
		maxStorageBufferBindingSize: number;
	};
	queue: FtQueue;
	createBuffer(descriptor: FtBufferDescriptor): FtBuffer;
	createShaderModule(descriptor: {
		code: string;
		label?: string;
	}): FtShaderModule;
	createComputePipeline(
		descriptor: FtComputePipelineDescriptor,
	): FtComputePipeline;
	createBindGroup(descriptor: FtBindGroupDescriptor): FtBindGroup;
	createCommandEncoder(descriptor?: { label?: string }): FtCommandEncoder;
	destroy(): void;
}

export interface FtAdapter {
	limits: {
		maxBufferSize: number;
		maxStorageBufferBindingSize: number;
	};
	info?: { vendor?: string; architecture?: string; description?: string };
	requestDevice(descriptor?: {
		requiredLimits?: Record<string, number>;
	}): Promise<FtDevice>;
}

export interface FtGPUNamespace {
	requestAdapter(descriptor?: {
		powerPreference?: string;
	}): Promise<FtAdapter | null>;
}

export function navigatorGpu(): FtGPUNamespace | undefined {
	if (typeof navigator === "undefined") return undefined;
	return (navigator as unknown as { gpu?: FtGPUNamespace }).gpu;
}
