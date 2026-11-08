/**
 * Finetune Lab trainer — a real gradient-descent loop over raw WebGPU.
 *
 * Owns the device, the buffers, the materialized op cache (pipelines + bind
 * groups are static — every dispatch's uniform except Adam's is constant),
 * and the per-frame training/diagnostics submits. Pure planning lives in
 * plan.ts; the reference math in mlp.ts; the kernels in kernels.ts.
 *
 * Robustness contract (mirrors the site's Woof GPU backend):
 *   - no adapter -> `probe()` returns null, the page says WebGPU is required
 *     (no CPU fallback in v1, by design);
 *   - adapter/device requests and readback maps are bounded with timeouts;
 *   - `device.lost` is surfaced through `onLost` so the UI can offer a
 *     re-initialize button;
 *   - steps per tick are capped by the caller (the UI slider) so the tab
 *     stays responsive; one submit per training step (backprop + Adam are
 *     sequential and Adam's bias correction changes every step), diagnostics
 *     once per UI tick.
 */
import {
	FT_BUFFER_USAGE,
	FT_MAP_MODE_READ,
	type FtAdapter,
	type FtBindGroup,
	type FtBuffer,
	type FtComputePipeline,
	type FtDevice,
	navigatorGpu,
} from "./gpu-types";
import { FT_KERNEL_COUNT, FT_KERNELS } from "./kernels";
import { createParams, MLP_SHAPE, type MlpShape, paramSegments } from "./mlp";
import {
	adamUniformWords,
	type FtOp,
	histogramUniformWords,
	PARAM_SEGMENTS_ORDER,
	planBuffers,
	planDiagnostics,
	planStep,
	round16,
} from "./plan";
import { BATCH_SIZE } from "./tasks";

/** Reject with a clear error if a promise does not settle in `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`finetune: ${label} timed out after ${ms}ms`)),
			ms,
		);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

export interface TickData {
	/** Mean squared error of the most recent training step. */
	loss: number;
	/** L2 norm of the gradient from the most recent training step. */
	gradNorm: number;
	/** Model predictions at the batch sample positions. */
	preds: Float32Array;
	/** 32-bin weight histogram. */
	bins: Uint32Array;
	/** Total training steps executed so far. */
	steps: number;
}

export interface TrainerOptions {
	lr: number;
	beta1?: number;
	beta2?: number;
	eps?: number;
	seed?: number;
	/** Cap on internal awaits, ms. */
	timeoutMs?: number;
}

const ADAM_UNIFORM_BYTES = round16(9 * 4); // adam struct: 9 scalar words
const HIST_UNIFORM_BYTES = round16(5 * 4); // histogram struct: 5 words

interface MaterializedOp {
	pipeline: FtComputePipeline;
	bindGroup: FtBindGroup;
	dispatch: [number, number, number];
}

export class FinetuneTrainer {
	readonly kernelCount = FT_KERNEL_COUNT;
	readonly adapterInfo: {
		vendor?: string;
		architecture?: string;
		description?: string;
	};
	/** Training steps executed (1-indexed inside Adam's bias correction). */
	steps = 0;
	lr: number;
	/** Fires once when the GPU device is lost while the trainer is alive. */
	onLost?: (info: unknown) => void;

	private device: FtDevice;
	private batch: number;
	private shape: MlpShape;
	private beta1: number;
	private beta2: number;
	private eps: number;
	private timeoutMs: number;
	private owned: FtBuffer[] = [];
	private buffers = new Map<string, FtBuffer>();
	private pipelines = new Map<string, FtComputePipeline>();
	private ops = new Map<string, MaterializedOp>();
	private stepOps: FtOp[];
	private diagOps: FtOp[];
	private staging: {
		sq: FtBuffer;
		err2: FtBuffer;
		pred: FtBuffer;
		bins: FtBuffer;
	};
	private destroyed = false;

	private constructor(
		device: FtDevice,
		adapterInfo: FinetuneTrainer["adapterInfo"],
		options: TrainerOptions,
	) {
		this.device = device;
		this.adapterInfo = adapterInfo;
		this.batch = BATCH_SIZE;
		this.shape = MLP_SHAPE;
		this.lr = options.lr;
		this.beta1 = options.beta1 ?? 0.9;
		this.beta2 = options.beta2 ?? 0.999;
		this.eps = options.eps ?? 1e-8;
		this.timeoutMs = options.timeoutMs ?? 5000;
		this.stepOps = planStep(this.batch, this.shape);
		this.diagOps = planDiagnostics(this.batch, this.shape);
		this.checkLimits();
		this.createBuffers();
		const { params, paramMin, paramMax } = createParams(
			this.shape,
			options.seed ?? 0,
		);
		this.uploadInitialWeights(params);
		this.applyHistogramWindow(paramMin, paramMax);
		this.staging = {
			sq: this.createStaging("read.sq", round16(6 * 4)),
			err2: this.createStaging("read.err2", round16(this.batch * 4)),
			pred: this.createStaging("read.pred", round16(this.batch * 4)),
			bins: this.createStaging("read.bins", round16(32 * 4)),
		};
		this.installLostHandler();
	}

	/** Full browser path: adapter probe -> device -> trainer. Null when
	 * WebGPU is unavailable (no navigator.gpu, no adapter, or timeout). */
	static async probe(options: TrainerOptions): Promise<FinetuneTrainer | null> {
		const gpu = navigatorGpu();
		if (!gpu) return null;
		let adapter: FtAdapter | null = null;
		try {
			adapter = await withTimeout(
				gpu.requestAdapter({ powerPreference: "high-performance" }),
				5000,
				"adapter request",
			);
		} catch {
			return null;
		}
		if (!adapter) return null;
		let device: FtDevice;
		try {
			device = await withTimeout(
				adapter.requestDevice({
					requiredLimits: {
						maxStorageBufferBindingSize:
							adapter.limits.maxStorageBufferBindingSize,
						maxBufferSize: adapter.limits.maxBufferSize,
					},
				}),
				5000,
				"device request",
			);
		} catch {
			return null;
		}
		return new FinetuneTrainer(device, adapter.info ?? {}, options);
	}

	/** Test/dev path with an injected device (the mock-device pattern of
	 * woof-gpu.test.ts). */
	static fromDevice(
		device: FtDevice,
		adapterInfo: FinetuneTrainer["adapterInfo"],
		options: TrainerOptions,
	): FinetuneTrainer {
		return new FinetuneTrainer(device, adapterInfo, options);
	}

	private checkLimits(): void {
		const lim = this.device.limits;
		for (const [name, elems] of planBuffers(this.batch, this.shape)) {
			const bytes = round16(elems * 4);
			if (bytes > lim.maxBufferSize) {
				throw new Error(
					`finetune: buffer ${name} (${bytes} B) exceeds maxBufferSize ${lim.maxBufferSize}`,
				);
			}
			if (bytes > lim.maxStorageBufferBindingSize) {
				throw new Error(
					`finetune: buffer ${name} (${bytes} B) exceeds maxStorageBufferBindingSize`,
				);
			}
		}
	}

	private createBuffers(): void {
		const storageUsage =
			FT_BUFFER_USAGE.STORAGE |
			FT_BUFFER_USAGE.COPY_DST |
			FT_BUFFER_USAGE.COPY_SRC;
		for (const [name, elems] of planBuffers(this.batch, this.shape)) {
			const isU32 = name.endsWith(":u32");
			const key = isU32 ? name.slice(0, -4) : name;
			const b = this.device.createBuffer({
				size: round16(elems * 4),
				usage: storageUsage,
				label: key,
			});
			this.owned.push(b);
			this.buffers.set(key, b);
		}
		// Adam uniforms: one per parameter segment (the kernel guards on the
		// segment's n, which lives in the uniform), rewritten every step.
		for (const seg of PARAM_SEGMENTS_ORDER) {
			this.createUniform(
				`adamU.${seg.name}`,
				ADAM_UNIFORM_BYTES,
				adamUniformWords(
					this.segmentSize(seg.name),
					this.lr,
					this.beta1,
					this.beta2,
					this.eps,
					1,
				),
			);
		}
		// Histogram uniforms: one per parameter segment, rewritten on reset.
		for (const seg of PARAM_SEGMENTS_ORDER) {
			this.createUniform(
				`histU.${seg.name}`,
				HIST_UNIFORM_BYTES,
				histogramUniformWords(this.segmentSize(seg.name), 0, 1),
			);
		}
	}

	private createUniform(name: string, bytes: number, words: number[]): void {
		const b = this.device.createBuffer({
			size: bytes,
			usage: FT_BUFFER_USAGE.UNIFORM | FT_BUFFER_USAGE.COPY_DST,
			mappedAtCreation: true,
			label: name,
		});
		new Uint32Array(b.getMappedRange()).set(words);
		b.unmap();
		this.owned.push(b);
		this.buffers.set(name, b);
	}

	private createStaging(name: string, bytes: number): FtBuffer {
		const b = this.device.createBuffer({
			size: bytes,
			usage: FT_BUFFER_USAGE.COPY_DST | FT_BUFFER_USAGE.MAP_READ,
			label: name,
		});
		this.owned.push(b);
		return b;
	}

	private segmentSize(name: string): number {
		const n = planBuffers(this.batch, this.shape).get(name);
		if (n === undefined) throw new Error(`finetune: unknown segment ${name}`);
		return n;
	}

	private applyHistogramWindow(paramMin: number, paramMax: number): void {
		const spread = Math.max(Math.abs(paramMin), Math.abs(paramMax));
		const half = Math.min(2, Math.max(0.3, spread * 2));
		const min = -half;
		const invSpan = 32 / (2 * half);
		for (const seg of PARAM_SEGMENTS_ORDER) {
			this.device.queue.writeBuffer(
				this.buf(`histU.${seg.name}`),
				0,
				new Uint32Array(
					histogramUniformWords(this.segmentSize(seg.name), min, invSpan),
				),
			);
		}
	}

	/** Upload freshly initialized weights + zeroed grads/moments. */
	private uploadInitialWeights(params: Float32Array): void {
		const segments = paramSegments(this.shape);
		const put = (name: string, arr: Float32Array): void => {
			this.device.queue.writeBuffer(this.buf(name), 0, arr);
		};
		const seg = (s: { offset: number; size: number }): Float32Array =>
			params.subarray(s.offset, s.offset + s.size);
		put("w1", seg(segments.w1));
		put("b1", seg(segments.b1));
		put("w2", seg(segments.w2));
		put("b2", seg(segments.b2));
		put("w3", seg(segments.w3));
		put("b3", seg(segments.b3));
		const zeros = new Float32Array(segments.total);
		for (const p of ["g", "m", "v"] as const) {
			put(`${p}w1`, zeros.subarray(0, segments.w1.size));
			put(`${p}b1`, zeros.subarray(0, segments.b1.size));
			put(`${p}w2`, zeros.subarray(0, segments.w2.size));
			put(`${p}b2`, zeros.subarray(0, segments.b2.size));
			put(`${p}w3`, zeros.subarray(0, segments.w3.size));
			put(`${p}b3`, zeros.subarray(0, segments.b3.size));
		}
	}

	private buf(name: string): FtBuffer {
		const b = this.buffers.get(name);
		if (!b) throw new Error(`finetune: unknown buffer ${name}`);
		return b;
	}

	setLearningRate(lr: number): void {
		this.lr = lr;
	}

	/** Re-initialize weights from a seed (also resets Adam state and the
	 * step counter). */
	resetWeights(seed?: number): void {
		const { params, paramMin, paramMax } = createParams(this.shape, seed ?? 0);
		this.uploadInitialWeights(params);
		this.applyHistogramWindow(paramMin, paramMax);
		this.steps = 0;
	}

	setDataset(features: Float32Array, targets: Float32Array): void {
		this.device.queue.writeBuffer(this.buf("feats"), 0, features);
		this.device.queue.writeBuffer(this.buf("target"), 0, targets);
	}

	private installLostHandler(): void {
		this.device.lost
			?.then((info) => {
				if (!this.destroyed) {
					this.onLost?.(info);
				}
			})
			.catch(() => {
				// device.lost rejection around explicit destroy — ignore
			});
	}

	/** Rewrite the six Adam uniform contents for step t. */
	private syncAdamUniforms(t: number): void {
		for (const seg of PARAM_SEGMENTS_ORDER) {
			this.device.queue.writeBuffer(
				this.buf(`adamU.${seg.name}`),
				0,
				new Uint32Array(
					adamUniformWords(
						this.segmentSize(seg.name),
						this.lr,
						this.beta1,
						this.beta2,
						this.eps,
						t,
					),
				),
			);
		}
	}

	private materialize(op: FtOp): MaterializedOp {
		const cached = this.ops.get(op.label);
		if (cached) return cached;
		const code = FT_KERNELS[op.kernel];
		if (!code) throw new Error(`finetune: unknown kernel ${op.kernel}`);
		let pipeline = this.pipelines.get(op.kernel);
		if (!pipeline) {
			pipeline = this.device.createComputePipeline({
				layout: "auto",
				compute: {
					module: this.device.createShaderModule({ code, label: op.kernel }),
					entryPoint: "main",
				},
				label: `ft.${op.kernel}`,
			});
			this.pipelines.set(op.kernel, pipeline);
		}
		let uniform: FtBuffer;
		if (op.sharedUniform) {
			uniform = this.buf(op.sharedUniform);
		} else {
			uniform = this.device.createBuffer({
				size: round16(op.uniforms.length * 4),
				usage: FT_BUFFER_USAGE.UNIFORM | FT_BUFFER_USAGE.COPY_DST,
				mappedAtCreation: true,
				label: `u.${op.label}`,
			});
			new Uint32Array(uniform.getMappedRange()).set(op.uniforms);
			uniform.unmap();
			// static per-op uniforms are one-shot: keep them alive for the
			// session lifetime so the bind group stays valid
			this.owned.push(uniform);
		}
		const entries: Array<{
			binding: number;
			resource: { buffer: FtBuffer };
		}> = [{ binding: 0, resource: { buffer: uniform } }];
		op.buffers.forEach((name, i) => {
			entries.push({ binding: i + 1, resource: { buffer: this.buf(name) } });
		});
		const bindGroup = this.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries,
			label: op.label,
		});
		const mat: MaterializedOp = { pipeline, bindGroup, dispatch: op.dispatch };
		this.ops.set(op.label, mat);
		return mat;
	}

	private submitPass(ops: FtOp[], label: string): void {
		const encoder = this.device.createCommandEncoder({ label });
		const pass = encoder.beginComputePass();
		for (const op of ops) {
			const mat = this.materialize(op);
			pass.setPipeline(mat.pipeline);
			pass.setBindGroup(0, mat.bindGroup);
			pass.dispatchWorkgroups(
				mat.dispatch[0],
				mat.dispatch[1],
				mat.dispatch[2],
			);
		}
		pass.end();
		this.device.queue.submit([encoder.finish()]);
	}

	/**
	 * Run `n` training steps (one submit per step: backprop + Adam are
	 * sequential and Adam's bias-correction uniform changes per step), then
	 * the diagnostics pass + readback for the UI. The caller caps n.
	 */
	async tick(n: number): Promise<TickData> {
		if (this.destroyed) throw new Error("finetune: trainer disposed");
		const steps = Math.max(0, Math.floor(n));
		for (let i = 0; i < steps; i++) {
			const t = this.steps + 1;
			this.syncAdamUniforms(t);
			this.submitPass(this.stepOps, `ft.step.${t}`);
			this.steps = t;
		}
		return withTimeout(
			this.diagnostics(),
			this.timeoutMs,
			"diagnostics readback",
		);
	}

	private async diagnostics(): Promise<TickData> {
		// zero the histogram bins before the submit (queue-ordered writes land
		// before the encoder executes)
		this.device.queue.writeBuffer(this.buf("bins"), 0, new Uint32Array(32));
		const encoder = this.device.createCommandEncoder({ label: "ft.diag" });
		const sqPass = encoder.beginComputePass();
		for (const op of this.diagOps) {
			if (!op.label.startsWith("sq.")) continue;
			const mat = this.materialize(op);
			sqPass.setPipeline(mat.pipeline);
			sqPass.setBindGroup(0, mat.bindGroup);
			sqPass.dispatchWorkgroups(
				mat.dispatch[0],
				mat.dispatch[1],
				mat.dispatch[2],
			);
		}
		sqPass.end();
		// histogram: one pass per segment so the atomic bin counts are exact
		for (const op of this.diagOps) {
			if (!op.label.startsWith("hist.")) continue;
			const pass = encoder.beginComputePass();
			const mat = this.materialize(op);
			pass.setPipeline(mat.pipeline);
			pass.setBindGroup(0, mat.bindGroup);
			pass.dispatchWorkgroups(
				mat.dispatch[0],
				mat.dispatch[1],
				mat.dispatch[2],
			);
			pass.end();
		}
		const sqBytes = round16(6 * 4);
		const batchBytes = round16(this.batch * 4);
		const binsBytes = round16(32 * 4);
		encoder.copyBufferToBuffer(
			this.buf("sqout"),
			0,
			this.staging.sq,
			0,
			sqBytes,
		);
		encoder.copyBufferToBuffer(
			this.buf("err2"),
			0,
			this.staging.err2,
			0,
			batchBytes,
		);
		encoder.copyBufferToBuffer(
			this.buf("pred"),
			0,
			this.staging.pred,
			0,
			batchBytes,
		);
		encoder.copyBufferToBuffer(
			this.buf("bins"),
			0,
			this.staging.bins,
			0,
			binsBytes,
		);
		this.device.queue.submit([encoder.finish()]);
		const [sqWords, errWords, predWords, binWords] = await Promise.all([
			this.readStaging(this.staging.sq),
			this.readStaging(this.staging.err2),
			this.readStaging(this.staging.pred),
			this.readStaging(this.staging.bins),
		]);
		const sq = new Float32Array(sqWords, 0, 6);
		let sqSum = 0;
		for (let i = 0; i < 6; i++) sqSum += sq[i];
		const err2 = new Float32Array(errWords, 0, this.batch);
		let loss = 0;
		for (let i = 0; i < this.batch; i++) loss += err2[i];
		loss /= this.batch;
		const bins = new Uint32Array(binWords, 0, 32).slice();
		const preds = new Float32Array(predWords, 0, this.batch).slice();
		return {
			loss,
			gradNorm: Math.sqrt(Math.max(0, sqSum)),
			preds,
			bins,
			steps: this.steps,
		};
	}

	private async readStaging(b: FtBuffer): Promise<ArrayBuffer> {
		await b.mapAsync(FT_MAP_MODE_READ);
		const copy = b.getMappedRange().slice(0);
		b.unmap();
		return copy;
	}

	dispose(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const b of this.owned) b.destroy();
		this.owned = [];
		this.buffers.clear();
		this.ops.clear();
		this.pipelines.clear();
		this.device.destroy();
	}
}
