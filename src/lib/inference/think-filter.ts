/**
 * Streaming filter that strips <think>...</think> blocks from token streams.
 *
 * Same intent as the inline filter in llm-worker.ts (transformers.js path):
 * only text outside think blocks is surfaced. The WebLLM and wllama transports
 * feed this class because their chunk deltas can contain multiple tokens (or
 * none), so this version also loops over several blocks within one chunk and
 * buffers exact tag-prefix suffixes at the boundaries — e.g. a "</think>"
 * split as "</thi" + "nk>" still closes the block.
 */
export class ThinkTagFilter {
	private insideThinkBlock = false;
	private buffer = "";

	/** Feed one streamed chunk; returns the surfaced text (possibly empty). */
	push(token: string): string {
		let combined = this.buffer + token;
		this.buffer = "";
		let surfaced = "";

		while (true) {
			if (this.insideThinkBlock) {
				const endIdx = combined.indexOf("</think>");
				if (endIdx === -1) {
					// Hold back a suffix that could be the start of "</think>"
					// so a boundary-split closing tag still matches next push.
					const hold = longestTagPrefixSuffix(combined, "</think>");
					this.buffer = hold;
					return surfaced;
				}
				this.insideThinkBlock = false;
				combined = combined.slice(endIdx + "</think>".length);
				continue;
			}

			const thinkIdx = combined.indexOf("<think>");
			if (thinkIdx === -1) break;
			surfaced += combined.slice(0, thinkIdx);
			this.insideThinkBlock = true;
			combined = combined.slice(thinkIdx + "<think>".length);
		}

		// Outside a block: hold back a trailing partial "<think>" prefix, emit
		// the rest immediately so plain text is not delayed.
		const hold = longestTagPrefixSuffix(combined, "<think>");
		if (hold) {
			this.buffer = hold;
			return surfaced + combined.slice(0, combined.length - hold.length);
		}
		return surfaced + combined;
	}

	/**
	 * Flush at end of generation. Returns trailing buffered text if a partial
	 * tag turned out not to be a think block; nothing if the stream ended
	 * inside a think block.
	 */
	flush(): string {
		const buffered = this.buffer;
		this.buffer = "";
		if (this.insideThinkBlock) return "";
		return buffered;
	}

	/** Reset state for a new generation. */
	reset(): void {
		this.insideThinkBlock = false;
		this.buffer = "";
	}
}

/**
 * If `text` ends with a prefix of `tag`, return that suffix; otherwise "".
 * E.g. ("abc<thi", "<think>") returns "<thi"; ("a < b", "<think>") returns "".
 */
function longestTagPrefixSuffix(text: string, tag: string): string {
	const max = Math.min(text.length, tag.length - 1);
	for (let len = max; len > 0; len--) {
		const suffix = text.slice(text.length - len);
		if (tag.startsWith(suffix)) return suffix;
	}
	return "";
}
