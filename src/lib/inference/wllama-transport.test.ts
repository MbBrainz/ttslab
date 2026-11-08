import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmModel } from "./llm-types";
import { WllamaTransport } from "./wllama-transport";

/**
 * Epoch-guard semantics for WllamaTransport.load().
 *
 * Regression context: the guard originally captured an epoch, then called
 * dispose() — which itself bumped the same counter — so every load() failed
 * its own staleness check and threw "wllama load cancelled by a newer load"
 * after a full download (observed in production verification: the 0.8B WASM
 * tier reached 94% progress, then died; a warm cached retry died in 3.3s).
 * These tests pin the intended semantics:
 *
 * - a load() must NEVER be cancelled by its own internal teardown;
 * - a genuinely newer load() (model switch) or dispose() cancels the
 *   in-flight load, which must exit its own instance (no WASM/worker leak);
 * - a failed loadModelFromHF must exit its instance and surface the original
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
	// Every Wllama instance the transport constructs, in construction order.
	const instances: Array<{
		exited: boolean;
		exitCalls: number;
	}> = [];
	return { deferred, loadGates: [] as Gate[], instances };
});

vi.mock("@wllama/wllama/esm/index.js", () => ({
	LoggerWithoutDebug: {},
	Wllama: class {
		exited = false;
		exitCalls = 0;
		constructor(_configs: unknown, _options: unknown) {
			h.instances.push(this);
		}
		setCompat(_assets: unknown, _mode: unknown) {}
		async loadModelFromHF(_meta: unknown, _run: unknown) {
			const gate = h.loadGates.shift();
			if (gate) await gate.promise;
		}
		async exit() {
			this.exited = true;
			this.exitCalls++;
		}
	},
}));

/** Instance created by the nth transport.load() (0-based). */
function instanceOf(call: number): { exited: boolean; exitCalls: number } {
	const instance = h.instances[call];
	if (!instance) throw new Error(`instance ${call} not created yet`);
	return instance;
}

const MODEL: LlmModel = {
	id: "qwen3.5-0.8b-wllama",
	name: "Qwen3.5 0.8B (WASM)",
	engine: "wllama",
	hfId: "unused",
	ggufRepo: "unsloth/Qwen3.5-0.8B-GGUF",
	ggufFile: "Qwen3.5-0.8B-Q4_K_M.gguf",
	isQwen3: true,
	sizeMb: 533,
	contextTokens: 4096,
	requiresWebGPU: false,
	requiresShaderF16: false,
	note: "test",
};
const MODEL_B: LlmModel = { ...MODEL, id: "b" };
const MODEL_C: LlmModel = { ...MODEL, id: "c" };

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
	h.instances.length = 0;
	h.loadGates.length = 0;
});

describe("WllamaTransport load epochs", () => {
	it("completes a single load — its own teardown must not cancel it", async () => {
		const transport = new WllamaTransport();
		// With the old guard this rejected with
		// "wllama load cancelled by a newer load" after a full download.
		const result = await transport.load(MODEL);
		expect(result.backend).toBe("wasm");
		expect(result.loadTime).toBeGreaterThanOrEqual(0);
	});

	it("a newer load cancels the in-flight one, which exits its own instance", async () => {
		const transport = new WllamaTransport();
		const gateA = h.deferred();
		h.loadGates.push(gateA);

		const pA = transport.load(MODEL);
		await tick(); // A parked inside loadModelFromHF

		const pB = transport.load(MODEL_B); // genuine model switch
		const resultB = await pB;
		expect(resultB.backend).toBe("wasm");

		gateA.resolve();
		await expect(pA).rejects.toThrow(/cancelled by a newer load/);

		// A exited only its own instance; B's stays alive.
		expect(instanceOf(0).exited).toBe(true);
		expect(instanceOf(1).exited).toBe(false);
	});

	it("dispose() cancels an in-flight load and exits its instance", async () => {
		const transport = new WllamaTransport();
		const gate = h.deferred();
		h.loadGates.push(gate);

		const pLoad = transport.load(MODEL);
		await tick();

		await transport.dispose();
		gate.resolve();
		await expect(pLoad).rejects.toThrow(/cancelled by a newer load/);
		expect(instanceOf(0).exited).toBe(true);
	});

	it("a failed loadModelFromHF exits its instance and surfaces the original error", async () => {
		const transport = new WllamaTransport();
		const gate = h.deferred();
		h.loadGates.push(gate);

		const pLoad = transport.load(MODEL);
		await tick();
		gate.reject(new Error("gguf download failed"));

		// The original error — not a cancellation.
		const err = await pLoad.then(
			() => {
				throw new Error("load should have rejected");
			},
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe("gguf download failed");
		expect(instanceOf(0).exited).toBe(true);
	});

	it("rapid A→B→C switching leaves only C's instance alive", async () => {
		const transport = new WllamaTransport();
		const gateA = h.deferred();
		const gateB = h.deferred();
		h.loadGates.push(gateA, gateB);

		const pA = transport.load(MODEL);
		await tick();
		const pB = transport.load(MODEL_B);
		await tick();
		const pC = transport.load(MODEL_C);
		const resultC = await pC;
		expect(resultC.backend).toBe("wasm");

		gateB.resolve();
		await expect(pB).rejects.toThrow(/cancelled by a newer load/);
		gateA.resolve();
		await expect(pA).rejects.toThrow(/cancelled by a newer load/);

		expect(instanceOf(0).exited).toBe(true);
		expect(instanceOf(1).exited).toBe(true);
		expect(instanceOf(2).exited).toBe(false);
	});

	it("sequential warm reloads both succeed", async () => {
		const transport = new WllamaTransport();
		await transport.load(MODEL);
		await transport.load(MODEL_B);

		// B's load exited A's instance; B stays live.
		expect(instanceOf(0).exited).toBe(true);
		expect(instanceOf(1).exited).toBe(false);
	});
});
