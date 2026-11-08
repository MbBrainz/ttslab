import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmModel } from "./llm-types";
import { WebLlmTransport } from "./webllm-transport";

/**
 * Epoch-guard semantics for WebLlmTransport.load().
 *
 * Regression context: the guard originally captured an epoch, then called
 * dispose() — which itself bumped the same counter — so every load() failed
 * its own staleness check and threw "WebLLM load cancelled by a newer load"
 * after a full download (observed in production verification: the 2B tier
 * reached 98% progress, then died). These tests pin the intended semantics:
 *
 * - a load() must NEVER be cancelled by its own internal teardown;
 * - a genuinely newer load() (model switch) or dispose() cancels the
 *   in-flight load, which must tear down its own worker/engine (no orphans);
 * - a failed engine creation must clean its worker and surface the original
 *   error.
 */

const h = vi.hoisted(() => {
	type Gate = {
		promise: Promise<void>;
		resolve: () => void;
		reject: (err: unknown) => void;
	};
	function deferred(): Gate {
		let resolve!: () => void;
		let reject!: (err: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}
	return { deferred, createGates: [] as Gate[] };
});

vi.mock("@mlc-ai/web-llm", () => ({
	CreateWebWorkerMLCEngine: vi.fn(
		async (_worker: unknown, _modelId: string) => {
			const gate = h.createGates.shift();
			if (gate) await gate.promise;
			return {
				unload: vi.fn(async () => {}),
				interruptGenerate: vi.fn(async () => {}),
			};
		},
	),
}));

class FakeWorker {
	static all: FakeWorker[] = [];
	terminated = false;
	constructor(public url: URL | string) {
		FakeWorker.all.push(this);
	}
	terminate() {
		this.terminated = true;
	}
}

const MODEL: LlmModel = {
	id: "qwen3.5-2b-webllm",
	name: "Qwen3.5 2B",
	engine: "webllm",
	mlcModelId: "Qwen3.5-2B-q4f16_1-MLC",
	isQwen3: true,
	sizeMb: 1080,
	contextTokens: 4096,
	requiresWebGPU: true,
	requiresShaderF16: true,
	note: "test",
};
const MODEL_B: LlmModel = { ...MODEL, id: "b" };
const MODEL_C: LlmModel = { ...MODEL, id: "c" };

const createMock = vi.mocked(CreateWebWorkerMLCEngine);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Client returned by the nth CreateWebWorkerMLCEngine call (0-based).
 *  settledResults, not results — the mock is async, so results holds the
 *  Promise while settledResults holds the resolved client ("fulfilled"). */
function clientOf(call: number): { unload: ReturnType<typeof vi.fn> } {
	const entry = createMock.mock.settledResults[call];
	if (!entry || entry.type !== "fulfilled")
		throw new Error(`call ${call} pending`);
	return entry.value as unknown as { unload: ReturnType<typeof vi.fn> };
}

/** Worker passed to the nth CreateWebWorkerMLCEngine call (0-based). */
function workerOf(call: number): FakeWorker {
	return createMock.mock.calls[call][0] as FakeWorker;
}

beforeEach(() => {
	vi.stubGlobal("Worker", FakeWorker);
	FakeWorker.all = [];
	createMock.mockClear();
	h.createGates.length = 0;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("WebLlmTransport load epochs", () => {
	it("completes a single load — its own teardown must not cancel it", async () => {
		const transport = new WebLlmTransport();
		// With the old guard this rejected with
		// "WebLLM load cancelled by a newer load" after a full download.
		const result = await transport.load(MODEL);
		expect(result.backend).toBe("webgpu");
		expect(result.loadTime).toBeGreaterThanOrEqual(0);
	});

	it("a newer load cancels the in-flight one, which tears itself down", async () => {
		const transport = new WebLlmTransport();
		const gateA = h.deferred();
		h.createGates.push(gateA);

		const pA = transport.load(MODEL);
		await tick(); // A parked inside engine creation

		const pB = transport.load(MODEL_B); // genuine model switch
		const resultB = await pB;
		expect(resultB.backend).toBe("webgpu");

		gateA.resolve();
		await expect(pA).rejects.toThrow(/cancelled by a newer load/);

		// A cleaned up its own artifacts via local refs...
		expect(workerOf(0).terminated).toBe(true);
		expect(clientOf(0).unload).toHaveBeenCalled();
		// ...without touching B's engine or worker.
		expect(workerOf(1).terminated).toBe(false);
		expect(clientOf(1).unload).not.toHaveBeenCalled();
	});

	it("dispose() cancels an in-flight load and releases its worker", async () => {
		const transport = new WebLlmTransport();
		const gate = h.deferred();
		h.createGates.push(gate);

		const pLoad = transport.load(MODEL);
		await tick();

		await transport.dispose();
		gate.resolve();
		await expect(pLoad).rejects.toThrow(/cancelled by a newer load/);

		expect(workerOf(0).terminated).toBe(true);
		expect(clientOf(0).unload).toHaveBeenCalled();
	});

	it("a failed engine creation terminates its worker and surfaces the original error", async () => {
		const transport = new WebLlmTransport();
		const gate = h.deferred();
		h.createGates.push(gate);

		const pLoad = transport.load(MODEL);
		await tick();
		gate.reject(new Error("engine boot failed"));

		// The original error — not a cancellation.
		const err = await pLoad.then(
			() => {
				throw new Error("load should have rejected");
			},
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe("engine boot failed");
		expect(workerOf(0).terminated).toBe(true);
	});

	it("rapid A→B→C switching leaves only C's engine alive", async () => {
		const transport = new WebLlmTransport();
		const gateA = h.deferred();
		const gateB = h.deferred();
		h.createGates.push(gateA, gateB);

		const pA = transport.load(MODEL);
		await tick();
		const pB = transport.load(MODEL_B);
		await tick();
		const pC = transport.load(MODEL_C);
		const resultC = await pC;
		expect(resultC.backend).toBe("webgpu");

		gateB.resolve();
		await expect(pB).rejects.toThrow(/cancelled by a newer load/);
		gateA.resolve();
		await expect(pA).rejects.toThrow(/cancelled by a newer load/);

		expect(workerOf(0).terminated).toBe(true);
		expect(workerOf(1).terminated).toBe(true);
		expect(clientOf(0).unload).toHaveBeenCalled();
		expect(clientOf(1).unload).toHaveBeenCalled();
		// The winner stays live — no orphan workers, engine usable.
		expect(workerOf(2).terminated).toBe(false);
		expect(clientOf(2).unload).not.toHaveBeenCalled();
	});

	it("sequential warm reloads both succeed", async () => {
		const transport = new WebLlmTransport();
		await transport.load(MODEL);
		await transport.load(MODEL_B);

		// B's load disposed A's engine + worker, and B stays live.
		expect(workerOf(0).terminated).toBe(true);
		expect(clientOf(0).unload).toHaveBeenCalled();
		expect(workerOf(1).terminated).toBe(false);
		expect(clientOf(1).unload).not.toHaveBeenCalled();
	});
});
