/**
 * AudioQueue manages sequential playback of audio chunks using Web Audio API.
 * As new chunks arrive via `enqueue`, they are scheduled for gapless playback
 * in order. Call `stop()` to halt playback and release resources.
 */
export class AudioQueue {
	private context: AudioContext;
	private nextStartTime = 0;
	private sources: AudioBufferSourceNode[] = [];
	private _isPlaying = false;
	private _disposed = false;

	constructor(sampleRate: number = 24000) {
		this.context = new AudioContext({ sampleRate });
	}

	/**
	 * Schedule a chunk of audio for playback immediately after any
	 * previously-enqueued chunks finish.
	 */
	enqueue(audioData: Float32Array, sampleRate: number): void {
		if (this._disposed) return;

		const buffer = this.context.createBuffer(
			1,
			audioData.length,
			sampleRate,
		);
		buffer.getChannelData(0).set(audioData);

		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.connect(this.context.destination);

		const startTime = Math.max(
			this.nextStartTime,
			this.context.currentTime,
		);
		source.start(startTime);
		this.nextStartTime = startTime + buffer.duration;

		this.sources.push(source);
		source.onended = () => {
			const idx = this.sources.indexOf(source);
			if (idx !== -1) this.sources.splice(idx, 1);
			if (this.sources.length === 0) {
				this._isPlaying = false;
			}
		};

		this._isPlaying = true;
	}

	/** Stop all playback and close the AudioContext. */
	stop(): void {
		if (this._disposed) return;
		this._disposed = true;

		for (const source of this.sources) {
			try {
				source.stop();
			} catch {
				// already stopped
			}
		}
		this.sources = [];
		this._isPlaying = false;
		this.context.close();
	}

	get isPlaying(): boolean {
		return this._isPlaying;
	}

	get currentTime(): number {
		return this.context.currentTime;
	}

	/** Total scheduled duration (from context start to last enqueued chunk end). */
	get scheduledEndTime(): number {
		return this.nextStartTime;
	}
}
