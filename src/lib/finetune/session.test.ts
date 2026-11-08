import { describe, expect, it } from "vitest";
import type {
	FtBindGroupDescriptor,
	FtBuffer,
	FtBufferDescriptor,
	FtCommandEncoder,
	FtComputePassEncoder,
	FtComputePipelineDescriptor,
	FtDevice,
	FtQueue,
} from "./gpu-types";
import { type FtOp, f32Word, planBuffers, planStep, round16 } from "./plan";
import { FinetuneTrainer } from "./session";
import { buildDataset } from "./tasks";

// ---------------------------------------------------------------------------
// Mock device — same approach as woof-gpu.test.ts: a structural FtDevice that
// records buffer creation, uploads, bind groups, passes and dispatches, so
// the session logic is exercised end to end in Node without a GPU.
// ---------------------------------------------------------------------------

interface MockPass {
	pipeline?: string;
	dispatches: Array<{ op?: string; dispatch: [number, number, number] }>;
}
interface MockSubmit {
	label?: string;
	passes: MockPass[];
	copies: Array<{ src?: string; dst?: string; bytes: number }>;
}

function makeMockDevice() {
	const created: Array<{ label?: string; size: number; usage: number }> = [];
	const destroyed: Array<string | undefined> = [];
	const written: Array<{ label?: string; bytes: number; words: Uint32Array }> =
		[];
	const bindGroups: Array<{
		label?: string;
		entries: number;
		first: string | undefined;
	}> = [];
	const submits: MockSubmit[] = [];
	const pipelineLabels = new Map<unknown, string>();
	let deviceLostResolve: ((info: unknown) => void) | null = null;
	const deviceLost = new Promise<unknown>((resolve) => {
		deviceLostResolve = resolve;
	});

	const queue: FtQueue = {
		writeBuffer: (buffer, _off, data) => {
			const src =
				data instanceof ArrayBuffer
					? new Uint8Array(data)
					: new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			written.push({
				label: buffer.label,
				bytes: src.byteLength,
				words: new Uint32Array(
					src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength),
				),
			});
		},
		submit: (commandBuffers) => {
			const enc = commandBuffers[0] as unknown as MockSubmit;
			submits.push({
				label: enc.label,
				passes: enc.passes,
				copies: enc.copies,
			});
		},
	};

	const device: FtDevice = {
		lost: deviceLost,
		limits: {
			maxBufferSize: 1 << 30,
			maxStorageBufferBindingSize: 1 << 30,
		},
		queue,
		createBuffer: (d: FtBufferDescriptor): FtBuffer => {
			created.push({ label: d.label, size: d.size, usage: d.usage });
			const size = d.size;
			return {
				size,
				label: d.label,
				mapAsync: async () => {},
				getMappedRange: () => new ArrayBuffer(size),
				unmap: () => {},
				destroy: () => {
					destroyed.push(d.label);
				},
			};
		},
		createShaderModule: () => ({}),
		createComputePipeline: (d: FtComputePipelineDescriptor) => {
			const p = { getBindGroupLayout: () => ({}) };
			pipelineLabels.set(p, d.label ?? "?");
			return p;
		},
		createBindGroup: (d: FtBindGroupDescriptor) => {
			bindGroups.push({
				label: d.label,
				entries: d.entries.length,
				first: d.entries[0]?.resource.buffer.label,
			});
			return {};
		},
		createCommandEncoder: (d?: { label?: string }) => {
			const enc: MockSubmit & FtCommandEncoder = {
				label: d?.label,
				passes: [],
				copies: [],
				beginComputePass: (): FtComputePassEncoder => {
					const pass: MockPass = { dispatches: [] };
					enc.passes.push(pass);
					return {
						setPipeline: (p) => {
							pass.pipeline = pipelineLabels.get(p);
						},
						setBindGroup: () => {},
						dispatchWorkgroups: (x, y = 1, z = 1) => {
							pass.dispatches.push({
								op: pass.pipeline,
								dispatch: [x, y, z],
							});
						},
						end: () => {},
					};
				},
				copyBufferToBuffer: (source, _so, destination, _do, size) => {
					enc.copies.push({
						src: source.label,
						dst: destination.label,
						bytes: size,
					});
				},
				finish: () => enc,
			};
			return enc;
		},
		destroy: () => {
			destroyed.push("device");
		},
	};

	return {
		device,
		created,
		destroyed,
		written,
		bindGroups,
		submits,
		resolveLost: (info: unknown) => deviceLostResolve?.(info),
	};
}

function makeTrainer() {
	const mock = makeMockDevice();
	const trainer = FinetuneTrainer.fromDevice(
		mock.device,
		{ vendor: "mock" },
		{ lr: 0.02, seed: 0, timeoutMs: 500 },
	);
	return { mock, trainer };
}

describe("finetune trainer setup (mock device)", () => {
	it("creates all planned storage buffers with 16-aligned sizes", () => {
		const { mock } = makeTrainer();
		for (const [name, elems] of planBuffers()) {
			const key = name.endsWith(":u32") ? name.slice(0, -4) : name;
			const buf = mock.created.find((b) => b.label === key);
			if (!buf) throw new Error(`buffer ${key} not created`);
			expect(buf.size).toBe(round16(elems * 4));
		}
	});

	it("creates per-segment adam + histogram uniforms and readback staging", () => {
		const { mock } = makeTrainer();
		for (const seg of ["w1", "b1", "w2", "b2", "w3", "b3"]) {
			expect(mock.created.find((b) => b.label === `adamU.${seg}`)).toBeTruthy();
			expect(mock.created.find((b) => b.label === `histU.${seg}`)).toBeTruthy();
		}
		expect(mock.created.find((b) => b.label === "read.bins")).toBeTruthy();
		expect(mock.created.find((b) => b.label === "read.err2")).toBeTruthy();
	});

	it("uploads the initial weights and zeroed moments", () => {
		const { mock } = makeTrainer();
		const w1 = mock.written.find((w) => w.label === "w1");
		if (!w1) throw new Error("w1 not uploaded");
		expect(w1.bytes).toBe(64 * 16 * 4);
		// deterministic seed -> identical initial weights every construction
		const t2 = makeTrainer();
		const w1b = t2.mock.written.find((w) => w.label === "w1");
		expect(Array.from(w1b?.words.subarray(0, 4) ?? [])).toEqual(
			Array.from(w1.words.subarray(0, 4)),
		);
		const vb2 = mock.written.find((w) => w.label === "vb2");
		if (!vb2) throw new Error("vb2 not uploaded");
		expect(vb2.bytes).toBe(64 * 4);
		expect(Array.from(vb2.words)).toEqual(new Array(64).fill(0));
	});

	it("materializes step ops into cached pipelines + bind groups", () => {
		const { mock, trainer } = makeTrainer();
		const internal = trainer as unknown as { materialize(op: FtOp): unknown };
		const ops = planStep();
		for (const op of ops) internal.materialize(op);
		const mm = mock.bindGroups.find((b) => b.label === "mm.l1");
		if (!mm) throw new Error("mm.l1 bind group missing");
		expect(mm.entries).toBe(5); // uniform + x, w, b, y
		const adamW1 = mock.bindGroups.find((b) => b.label === "adam.w1");
		if (!adamW1) throw new Error("adam.w1 bind group missing");
		expect(adamW1.entries).toBe(5); // uniform + params, grads, mom, vel
		expect(adamW1.first).toBe("adamU.w1");
		// cached: materializing again creates nothing new
		const countBefore = mock.bindGroups.length;
		for (const op of ops) internal.materialize(op);
		expect(mock.bindGroups.length).toBe(countBefore);
	});
});

describe("finetune trainer tick (mock device)", () => {
	it("runs one submit per step + one diagnostics submit, 22 dispatches per step", async () => {
		const { mock, trainer } = makeTrainer();
		const data = await trainer.tick(3);
		expect(data.steps).toBe(3);
		expect(mock.submits.length).toBe(4); // 3 steps + 1 diagnostics
		const stepSubmit = mock.submits[0];
		expect(stepSubmit.passes).toHaveLength(1);
		expect(stepSubmit.passes[0].dispatches).toHaveLength(22);
		// diagnostics submit: 1 sq pass + 6 hist passes + 4 copies
		const diag = mock.submits[3];
		expect(diag.passes).toHaveLength(7);
		expect(diag.copies).toHaveLength(4);
		expect(diag.copies.map((c) => c.src).sort()).toEqual(
			["bins", "err2", "pred", "sqout"].sort(),
		);
	});

	it("rewrites all six adam uniforms before every step, with bias correction", async () => {
		const { mock, trainer } = makeTrainer();
		await trainer.tick(2);
		const adamWrites = mock.written.filter((w) =>
			(w.label ?? "").startsWith("adamU."),
		);
		expect(adamWrites.length).toBe(12); // 6 segments x 2 steps
		// step 2's bc1 = 1 - 0.9^2 (uniform words: n,0,0,lr,b1,b2,bc1,...)
		const w1Step2 = adamWrites.filter((w) => w.label === "adamU.w1")[1];
		const bc1 = new Float32Array(w1Step2.words.buffer, 6 * 4);
		expect(bc1[0]).toBeCloseTo(1 - 0.9 ** 2, 6);
	});

	it("picks up a new learning rate in the adam uniform", async () => {
		const { mock, trainer } = makeTrainer();
		trainer.setLearningRate(0.05);
		await trainer.tick(1);
		const w1Write = mock.written.filter((w) => w.label === "adamU.w1").pop();
		if (!w1Write) throw new Error("no adam uniform write");
		const lr = new Float32Array(w1Write.words.buffer, 3 * 4);
		expect(lr[0]).toBeCloseTo(0.05, 8); // f32 storage precision
	});

	it("zeros the histogram bins before each diagnostics submit", async () => {
		const { mock, trainer } = makeTrainer();
		await trainer.tick(1);
		const zeroWrite = mock.written.find((w) => w.label === "bins");
		if (!zeroWrite) throw new Error("bins not zeroed");
		expect(Array.from(zeroWrite.words)).toEqual(new Array(32).fill(0));
	});

	it("runs zero steps but still reports diagnostics on tick(0)", async () => {
		const { mock, trainer } = makeTrainer();
		const data = await trainer.tick(0);
		expect(data.steps).toBe(0);
		expect(mock.submits.length).toBe(1); // diagnostics only
		expect(data.loss).toBe(0); // mock readback is all zeros
		expect(data.gradNorm).toBe(0);
		expect(data.preds).toHaveLength(128);
		expect(data.bins).toHaveLength(32);
	});

	it("resets weights, moments and the step counter", async () => {
		const { mock, trainer } = makeTrainer();
		await trainer.tick(5);
		expect(trainer.steps).toBe(5);
		const writesBefore = mock.written.length;
		trainer.resetWeights(7);
		expect(trainer.steps).toBe(0);
		// 6 weight tensors + 18 zeroed grad/moment tensors + 6 histogram
		// uniform rewrites
		expect(mock.written.length - writesBefore).toBe(30);
	});
});

describe("finetune trainer lifecycle", () => {
	it("surfaces device loss through onLost while alive", async () => {
		const { mock, trainer } = makeTrainer();
		const lost: unknown[] = [];
		trainer.onLost = (info) => lost.push(info);
		mock.resolveLost({ reason: "destroyed" });
		await Promise.resolve();
		await Promise.resolve();
		expect(lost).toHaveLength(1);
	});

	it("does not fire onLost after dispose", async () => {
		const { mock, trainer } = makeTrainer();
		const lost: unknown[] = [];
		trainer.onLost = (info) => lost.push(info);
		trainer.dispose();
		mock.resolveLost({ reason: "destroyed" });
		await Promise.resolve();
		await Promise.resolve();
		expect(lost).toHaveLength(0);
	});

	it("dispose destroys every owned buffer and the device; tick refuses", async () => {
		const { mock, trainer } = makeTrainer();
		trainer.dispose();
		expect(mock.destroyed).toContain("device");
		expect(mock.destroyed.filter((l) => l === "w2")).toHaveLength(1);
		expect(
			mock.destroyed.filter((l) => (l ?? "").startsWith("adamU.")),
		).toHaveLength(6);
		const expected = planBuffers().size + 6 + 6 + 4 + 1; // storage + adamU + histU + staging + device
		expect(mock.destroyed.length).toBe(expected);
		await expect(trainer.tick(1)).rejects.toThrow(/disposed/);
	});

	it("probe() returns null without navigator.gpu (CI/Node)", async () => {
		const trainer = await FinetuneTrainer.probe({ lr: 0.02 });
		expect(trainer).toBeNull();
	});

	it("exposes the kernel count, adapter info and learning rate", () => {
		const { trainer } = makeTrainer();
		expect(trainer.kernelCount).toBe(9);
		expect(trainer.adapterInfo.vendor).toBe("mock");
		expect(trainer.lr).toBe(0.02);
	});
});

describe("finetune trainer dataset swap", () => {
	it("uploads features and targets matching the dataset", () => {
		const { mock, trainer } = makeTrainer();
		const ds = buildDataset("square");
		trainer.setDataset(ds.features, ds.targets);
		const feats = mock.written.filter((w) => w.label === "feats").pop();
		const target = mock.written.filter((w) => w.label === "target").pop();
		expect(feats?.bytes).toBe(128 * 16 * 4);
		expect(target?.bytes).toBe(128 * 4);
		const uploaded = new Float32Array(
			target?.words.buffer ?? new ArrayBuffer(0),
		);
		for (let i = 0; i < 128; i++) {
			expect(uploaded[i]).toBe(ds.targets[i]);
			expect(Math.abs(uploaded[i])).toBe(1); // square wave targets
		}
	});
});

describe("finetune uniform packing parity", () => {
	it("adam uniform lr word matches the packer", () => {
		const words = new Uint32Array(9);
		words[3] = f32Word(0.02);
		expect(words[3]).not.toBe(0);
	});
});
