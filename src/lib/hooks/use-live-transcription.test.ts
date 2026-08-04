import { describe, expect, it, vi } from "vitest";
import { releaseVad } from "./use-live-transcription";

/**
 * Minimal MicVAD stand-in. Only the teardown surface matters here — the real
 * class throws from both pause() and destroy() when start() never finished
 * building the audio graph, which is exactly the state a failed start leaves
 * behind.
 */
function fakeVad(failing: { pause?: boolean; destroy?: boolean } = {}): {
	pause: () => Promise<void>;
	destroy: () => Promise<void>;
} {
	return {
		pause: vi.fn(async () => {
			if (failing.pause) throw new Error("pause: no audio instances");
		}),
		destroy: vi.fn(async () => {
			if (failing.destroy) throw new Error("destroy: no audio instances");
		}),
	};
}

// releaseVad is typed against MicVAD; the fake only implements what it calls.
// biome-ignore lint/suspicious/noExplicitAny: structural stand-in for MicVAD
const release = (vad: unknown) => releaseVad(vad as any);

describe("releaseVad", () => {
	it("pauses then destroys on the happy path", async () => {
		const vad = fakeVad();
		await expect(release(vad)).resolves.toBeUndefined();
		expect(vad.pause).toHaveBeenCalledOnce();
		expect(vad.destroy).toHaveBeenCalledOnce();
	});

	it("still destroys when pause() rejects", async () => {
		const vad = fakeVad({ pause: true });
		await expect(release(vad)).resolves.toBeUndefined();
		// The guarantee that matters: a thrown pause must not skip the step
		// that releases the ONNX session and the microphone.
		expect(vad.destroy).toHaveBeenCalledOnce();
	});

	it("swallows a rejecting destroy()", async () => {
		const vad = fakeVad({ destroy: true });
		await expect(release(vad)).resolves.toBeUndefined();
		expect(vad.destroy).toHaveBeenCalledOnce();
	});

	it("resolves when both steps reject", async () => {
		const vad = fakeVad({ pause: true, destroy: true });
		// A rejection here would propagate into the caller's teardown and
		// strand the capture claim, disabling both mic paths until a reload.
		await expect(release(vad)).resolves.toBeUndefined();
		expect(vad.pause).toHaveBeenCalledOnce();
		expect(vad.destroy).toHaveBeenCalledOnce();
	});

	it("attempts destroy() even when pause() throws synchronously", async () => {
		const vad = {
			pause: vi.fn(() => {
				throw new Error("sync throw before any promise");
			}),
			destroy: vi.fn(async () => {}),
		};
		await expect(release(vad)).resolves.toBeUndefined();
		expect(vad.destroy).toHaveBeenCalledOnce();
	});
});
