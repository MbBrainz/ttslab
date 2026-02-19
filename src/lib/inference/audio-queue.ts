/**
 * AudioQueue manages sequential playback of audio chunks using Web Audio API.
 * As new chunks arrive via `enqueue`, they are scheduled for gapless playback
 * in order. Call `stop()` to halt playback and release resources.
 *
 * Audio is routed through a GainNode → AnalyserNode → destination so that
 * real-time frequency data can be read for visualization.
 */
export class AudioQueue {
	private context: AudioContext;
	private gain: GainNode;
	private analyser: AnalyserNode;
	private nextStartTime = 0;
	private sources: AudioBufferSourceNode[] = [];
	private _isPlaying = false;
	private _disposed = false;
	private _totalDuration = 0;

	/** Fires when all enqueued sources have finished playing. */
	onAllEnded: (() => void) | null = null;

	constructor(sampleRate: number = 24000) {
		this.context = new AudioContext({ sampleRate });

		this.gain = this.context.createGain();
		this.analyser = this.context.createAnalyser();
		this.analyser.fftSize = 256;
		this.analyser.smoothingTimeConstant = 0.8;

		this.gain.connect(this.analyser);
		this.analyser.connect(this.context.destination);
	}

	/**
	 * Schedule a chunk of audio for playback immediately after any
	 * previously-enqueued chunks finish.
	 */
	enqueue(audioData: Float32Array, sampleRate: number): void {
		if (this._disposed) return;

		// Ensure AudioContext is running (Chrome suspends by default)
		if (this.context.state === "suspended") {
			this.context.resume();
		}

		const buffer = this.context.createBuffer(
			1,
			audioData.length,
			sampleRate,
		);
		buffer.getChannelData(0).set(audioData);

		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.connect(this.gain);

		const startTime = Math.max(
			this.nextStartTime,
			this.context.currentTime,
		);
		source.start(startTime);
		this.nextStartTime = startTime + buffer.duration;
		this._totalDuration += buffer.duration;

		this.sources.push(source);
		source.onended = () => {
			const idx = this.sources.indexOf(source);
			if (idx !== -1) this.sources.splice(idx, 1);
			if (this.sources.length === 0) {
				this._isPlaying = false;
				this.onAllEnded?.();
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

	/** Pause playback by suspending the audio context. */
	pause(): void {
		if (!this._disposed) this.context.suspend();
	}

	/** Resume playback after a pause. */
	resume(): void {
		if (!this._disposed) this.context.resume();
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

	get totalDuration(): number {
		return this._totalDuration;
	}

	get analyserNode(): AnalyserNode {
		return this.analyser;
	}

	get audioContext(): AudioContext {
		return this.context;
	}
}
