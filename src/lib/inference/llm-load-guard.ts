/**
 * Dedupe guard for LLM (re)loads, keyed on model id string.
 *
 * Guarantees one selection starts at most one load: a duplicate trigger for
 * the model already in flight (React effect re-run, drawer re-set, boot
 * Retry click racing the effect) is a no-op, while a genuine switch to a
 * different id always begins. Combined with the transport loadEpoch guards
 * (which cancel a superseded in-flight load), this keeps rapid
 * A→B→C switching correct without orphaning workers.
 */
export class LlmLoadGuard {
	private inFlightId: string | null = null;

	/** Mark `id` as loading. Returns false when a load for this exact id is
	 *  already in flight — the caller must not start a second one. */
	begin(id: string): boolean {
		if (this.inFlightId === id) return false;
		this.inFlightId = id;
		return true;
	}

	/** Release the slot after a load settles (success or failure). Only the
	 *  owner id may clear it, so a newer switch's slot survives an older
	 *  load's late settle. */
	end(id: string): void {
		if (this.inFlightId === id) this.inFlightId = null;
	}

	/** The id currently loading, or null. */
	get activeId(): string | null {
		return this.inFlightId;
	}
}
