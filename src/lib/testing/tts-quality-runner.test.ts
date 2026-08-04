import { describe, expect, it, vi } from "vitest";
import { speechLike, withNaNAt } from "../audio-qa/synthetic-signals";
import { type InferenceWorkerAPI, runQualityTests } from "./tts-quality-runner";
import type { TestVariant } from "./types";

const SR = 24_000;
const TEXT =
	"Welcome to TTSLab, where you can test speech models right in your browser.";
const AUDIO = speechLike(SR, 6.2);

interface RecordedCall {
	kind: "synthesize" | "synthesizeStream";
	speakerEmbeddingUrl: string | null | undefined;
}

interface FakeOptions {
	supportsStreaming?: boolean;
	audio?: Float32Array;
	transcript?: string;
	/** Emit no chunks before onEnd — a stream that produced nothing. */
	emitNoChunks?: boolean;
	/** Never call onEnd — a hung generation. */
	hang?: boolean;
	/** Drop cancelStream from the adapter. */
	noCancel?: boolean;
	/** Records cancelStream() calls. */
	cancels?: { count: number };
}

function fakeWorker(
	calls: RecordedCall[],
	options: FakeOptions = {},
): InferenceWorkerAPI {
	const audio = options.audio ?? AUDIO;
	const transcript = options.transcript ?? TEXT;

	const base: InferenceWorkerAPI = {
		loadModel: async () => ({
			backend: "wasm",
			loadTime: 10,
			voices: [{ id: "v", name: "v" }],
			languages: ["en"],
		}),
		synthesize: async (_slug, _text, _voice, speakerEmbeddingUrl) => {
			calls.push({ kind: "synthesize", speakerEmbeddingUrl });
			return {
				audio,
				sampleRate: SR,
				duration: audio.length / SR,
				metrics: { totalMs: 120, backend: "wasm" },
			};
		},
		transcribe: async () => ({ text: transcript, metrics: { totalMs: 10 } }),
		disposeModel: async () => {},
	};

	if (options.supportsStreaming === false) return base;

	return {
		...base,
		...(options.noCancel
			? {}
			: {
					cancelStream: () => {
						if (options.cancels) options.cancels.count++;
					},
				}),
		synthesizeStream: (
			_slug,
			_text,
			_voice,
			speakerEmbeddingUrl,
			callbacks,
		) => {
			calls.push({ kind: "synthesizeStream", speakerEmbeddingUrl });
			if (options.hang) return; // never calls onEnd
			setTimeout(() => {
				if (!options.emitNoChunks) {
					const chunkLength = Math.floor(audio.length / 4);
					for (let i = 0; i < 4; i++) {
						callbacks.onChunk({
							audio: audio.slice(i * chunkLength, (i + 1) * chunkLength),
							sampleRate: SR,
							chunkIndex: i,
							totalChunks: 4,
							sentenceText: TEXT,
						});
					}
				}
				callbacks.onEnd({ totalMs: 300, sampleRate: SR, totalChunks: 4 });
			}, 0);
		},
	};
}

const run = (worker: InferenceWorkerAPI, variants: TestVariant[]) =>
	runQualityTests(worker, {
		models: ["fake"],
		phrases: [{ text: TEXT, category: "test" }],
		sttModel: "fake-stt",
		variants,
	});

describe("coverage matrix", () => {
	it("produces one report per variant, tagged with the variant id", async () => {
		const calls: RecordedCall[] = [];
		const reports = await run(fakeWorker(calls), [
			{ id: "stock/non-streaming" },
			{ id: "stock/streaming", streaming: true },
			{ id: "cloned/non-streaming", speakerEmbeddingUrl: "/e.bin" },
			{
				id: "cloned/streaming",
				speakerEmbeddingUrl: "/e.bin",
				streaming: true,
			},
		]);

		expect(reports.map((r) => r.variant)).toEqual([
			"stock/non-streaming",
			"stock/streaming",
			"cloned/non-streaming",
			"cloned/streaming",
		]);
	});

	it("defaults to the stock non-streaming variant", async () => {
		const calls: RecordedCall[] = [];
		const reports = await runQualityTests(fakeWorker(calls), {
			models: ["fake"],
			phrases: [{ text: TEXT, category: "test" }],
			sttModel: "fake-stt",
		});
		expect(reports[0].variant).toBe("stock/non-streaming");
	});
});

describe("cloned-voice path", () => {
	// Before step 6 this was structurally untestable: testPhrase called
	// synthesize(slug, text, voice) and nothing else, so the known-broken
	// cloned configuration could not be exercised at all.
	it("passes speakerEmbeddingUrl through to synthesize", async () => {
		const calls: RecordedCall[] = [];
		await run(fakeWorker(calls), [
			{ id: "cloned", speakerEmbeddingUrl: "/e.bin" },
		]);

		expect(calls).toHaveLength(1);
		expect(calls[0].speakerEmbeddingUrl).toBe("/e.bin");
	});

	it("passes speakerEmbeddingUrl through to the streaming path too", async () => {
		const calls: RecordedCall[] = [];
		await run(fakeWorker(calls), [
			{
				id: "cloned/streaming",
				speakerEmbeddingUrl: "/e.bin",
				streaming: true,
			},
		]);

		expect(calls[0].kind).toBe("synthesizeStream");
		expect(calls[0].speakerEmbeddingUrl).toBe("/e.bin");
	});

	it("sends no embedding for a stock variant", async () => {
		const calls: RecordedCall[] = [];
		await run(fakeWorker(calls), [{ id: "stock" }]);
		expect(calls[0].speakerEmbeddingUrl).toBeUndefined();
	});
});

describe("streaming path", () => {
	it("calls synthesizeStream and records chunk count and first-chunk latency", async () => {
		const calls: RecordedCall[] = [];
		const [report] = await run(fakeWorker(calls), [
			{ id: "s", streaming: true },
		]);

		expect(calls[0].kind).toBe("synthesizeStream");
		expect(report.tests[0].streaming?.chunkCount).toBe(4);
		expect(report.tests[0].streaming?.firstChunkMs).toBeGreaterThanOrEqual(0);
	});

	it("joins the chunks so whole-utterance metrics see the boundaries", async () => {
		// A model that streams each chunk correctly but mis-joins them produces
		// clicks and gaps only a joined analysis can catch.
		const calls: RecordedCall[] = [];
		const [streamed] = await run(fakeWorker(calls), [
			{ id: "s", streaming: true },
		]);
		const [whole] = await run(fakeWorker([]), [{ id: "n" }]);

		expect(streamed.tests[0].qa.duration?.actualSec).toBeCloseTo(
			whole.tests[0].qa.duration?.actualSec ?? 0,
			1,
		);
	});

	it("does not report a streaming block for non-streaming variants", async () => {
		const [report] = await run(fakeWorker([]), [{ id: "n" }]);
		expect(report.tests[0].streaming).toBeUndefined();
	});

	it("FAILS when the adapter cannot stream, rather than testing the wrong path", async () => {
		// Silently falling back to synthesize() would report streaming coverage
		// that never happened — worse than an explicit failure.
		const calls: RecordedCall[] = [];
		const [report] = await run(
			fakeWorker(calls, { supportsStreaming: false }),
			[{ id: "s", streaming: true }],
		);

		expect(report.overall).toBe("fail");
		expect(report.errors[0]).toMatch(/no synthesizeStream/);
		expect(calls.filter((c) => c.kind === "synthesize")).toHaveLength(0);
	});

	it("CANCELS a hung stream instead of abandoning it", async () => {
		// Rejecting without cancelling leaves the generation running inside the
		// worker while the runner disposes the model and loads the next one, so
		// an orphan can contaminate the following model's results.
		vi.useFakeTimers();
		try {
			const cancels = { count: 0 };
			const promise = run(fakeWorker([], { hang: true, cancels }), [
				{ id: "s", streaming: true },
			]);
			await vi.advanceTimersByTimeAsync(121_000);
			const [report] = await promise;

			expect(cancels.count).toBe(1);
			expect(report.overall).toBe("fail");
			expect(report.errors[0]).toMatch(/did not finish/);
			expect(report.errors[0]).toMatch(/\(cancelled\)/);
		} finally {
			vi.useRealTimers();
		}
	});

	it("says so explicitly when the adapter cannot cancel", async () => {
		vi.useFakeTimers();
		try {
			const promise = run(fakeWorker([], { hang: true, noCancel: true }), [
				{ id: "s", streaming: true },
			]);
			await vi.advanceTimersByTimeAsync(121_000);
			const [report] = await promise;
			expect(report.errors[0]).toMatch(/NOT cancelled/);
		} finally {
			vi.useRealTimers();
		}
	});

	it("ignores callbacks that fire after a timeout", async () => {
		// Cancellation is not instantaneous; a late onEnd must not resolve a
		// promise that already rejected, nor double-settle.
		vi.useFakeTimers();
		try {
			let late: (() => void) | undefined;
			const worker: InferenceWorkerAPI = {
				...fakeWorker([], { hang: true }),
				synthesizeStream: (_s, _t, _v, _e, callbacks) => {
					late = () =>
						callbacks.onEnd({ totalMs: 1, sampleRate: SR, totalChunks: 0 });
				},
			};
			const promise = run(worker, [{ id: "s", streaming: true }]);
			await vi.advanceTimersByTimeAsync(121_000);
			late?.();
			const [report] = await promise;
			expect(report.errors[0]).toMatch(/did not finish/);
		} finally {
			vi.useRealTimers();
		}
	});

	it("fails a stream that ends without emitting audio", async () => {
		const [report] = await run(fakeWorker([], { emitNoChunks: true }), [
			{ id: "s", streaming: true },
		]);
		expect(report.overall).toBe("fail");
		expect(report.errors[0]).toMatch(/without emitting any audio/);
	});
});

describe("verdict rollup", () => {
	it("passes clean audio with a matching transcript", async () => {
		const [report] = await run(fakeWorker([]), [{ id: "n" }]);
		expect(report.overall).toBe("pass");
		expect(report.tests[0].failures).toEqual([]);
	});

	it("fails on a NaN-poisoned buffer via the integrity check", async () => {
		const [report] = await run(
			fakeWorker([], { audio: withNaNAt(AUDIO, 100) }),
			[{ id: "n" }],
		);
		expect(report.overall).toBe("fail");
		expect(report.tests[0].failures.map((f) => f.check)).toContain("integrity");
	});

	it("the INTEGRITY rule itself catches an empty buffer", async () => {
		// An empty buffer has usable:false but nanCount + infiniteCount === 0, so
		// a sum-based rule misses it. It is caught today only because silence and
		// energy independently tank — an accidental safety net, not the integrity
		// gate doing its named job. Assert integrity by name.
		const [report] = await run(fakeWorker([], { audio: new Float32Array(0) }), [
			{ id: "n" },
		]);
		const checks = report.tests[0].failures.map((f) => f.check);

		expect(checks).toContain("integrity");
		expect(report.tests[0].qa.integrity.nanCount).toBe(0);
		expect(report.tests[0].qa.integrity.infiniteCount).toBe(0);
		expect(report.tests[0].qa.integrity.usable).toBe(false);
	});

	it("the DURATION rule itself catches a model that emitted no audio", async () => {
		const [report] = await run(fakeWorker([], { audio: new Float32Array(0) }), [
			{ id: "n" },
		]);
		expect(report.tests[0].failures.map((f) => f.check)).toContain("duration");
	});

	it("fails on a looping transcript via insertion rate", async () => {
		const [report] = await run(
			fakeWorker([], { transcript: `${TEXT} ${TEXT}` }),
			[{ id: "n" }],
		);
		expect(report.overall).toBe("fail");
		expect(report.tests[0].failures.map((f) => f.check)).toContain(
			"insertion_rate",
		);
	});
});

describe("artifact sink", () => {
	it("hands every generated buffer to the caller, tagged by variant", async () => {
		// This is what makes failures listenable and re-scorable without
		// regenerating the audio.
		const dumped: Array<{ slug: string; variant: string; length: number }> = [];
		await runQualityTests(
			fakeWorker([]),
			{
				models: ["fake"],
				phrases: [{ text: TEXT, category: "test" }],
				sttModel: "fake-stt",
				variants: [
					{ id: "stock" },
					{ id: "cloned", speakerEmbeddingUrl: "/e.bin" },
				],
			},
			{
				onAudio: (item) =>
					void dumped.push({
						slug: item.slug,
						variant: item.variant,
						length: item.audio.length,
					}),
			},
		);

		expect(dumped.map((d) => d.variant)).toEqual(["stock", "cloned"]);
		expect(dumped[0].length).toBe(AUDIO.length);
	});

	it("AWAITS the sink, so a failed artifact write fails the case", async () => {
		// Dropping the rejection would leave the report citing a WAV that was
		// never written, with nothing in the verdict to show for it.
		const [report] = await runQualityTests(
			fakeWorker([]),
			{
				models: ["fake"],
				phrases: [{ text: TEXT, category: "test" }],
				sttModel: "fake-stt",
				variants: [{ id: "stock" }],
			},
			{
				onAudio: async () => {
					throw new Error("disk full");
				},
			},
		);

		expect(report.overall).toBe("fail");
		expect(report.errors[0]).toMatch(/disk full/);
	});
});

describe("incremental reporting", () => {
	it("emits each cell as it completes, not once at the end", async () => {
		// A long matrix run can die partway. Batching every verdict until the
		// end loses the cells that already finished, even though their audio is
		// already on disk.
		const seen: string[] = [];
		const reports = await runQualityTests(
			fakeWorker([]),
			{
				models: ["fake"],
				phrases: [{ text: TEXT, category: "test" }],
				sttModel: "fake-stt",
				variants: [{ id: "a" }, { id: "b" }, { id: "c" }],
			},
			{ onReport: (report) => void seen.push(report.variant) },
		);

		expect(seen).toEqual(["a", "b", "c"]);
		expect(seen).toEqual(reports.map((r) => r.variant));
	});

	it("has already emitted the finished cells when a later one throws", async () => {
		const seen: string[] = [];
		const worker = fakeWorker([]);
		let calls = 0;
		const flaky: InferenceWorkerAPI = {
			...worker,
			loadModel: async (...loadArgs) => {
				calls++;
				if (calls > 2) throw new Error("browser died");
				return worker.loadModel(...loadArgs);
			},
		};

		await runQualityTests(
			flaky,
			{
				models: ["fake"],
				phrases: [{ text: TEXT, category: "test" }],
				sttModel: "fake-stt",
				variants: [{ id: "a" }, { id: "b" }, { id: "c" }],
			},
			{ onReport: (report) => void seen.push(report.variant) },
		);

		// "c" fails to load, but a and b are already out.
		expect(seen).toEqual(["a", "b", "c"]);
	});
});
