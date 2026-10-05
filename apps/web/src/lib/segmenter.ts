export type SpeechSegment = {
	samples: Float32Array;
	/** Offset of the first sample from the start of this segmenter's stream. */
	startOffsetMs: number;
	durationMs: number;
};

export type SegmenterOptions = {
	sampleRate: number;
	frameMs?: number;
	/** Consecutive loud frames needed to open a segment. */
	onsetMs?: number;
	/** Silence that closes a segment (a pause between turns). */
	hangoverMs?: number;
	/** Audio kept from before the onset so first syllables are not clipped. */
	prerollMs?: number;
	/** Voiced audio below this is discarded (coughs, clicks). */
	minSpeechMs?: number;
	maxSegmentMs: number;
	/** Speech must be this far above the tracked noise floor. */
	marginDb?: number;
	minThresholdDb?: number;
};

/**
 * Energy-based voice activity detection that cuts a continuous microphone stream
 * into utterances at pauses. Deliberately simple: the ASR service runs a proper VAD
 * on each utterance; this only decides where to cut and what to upload.
 */
export class SpeechSegmenter {
	private readonly frameSize: number;
	private readonly frameMs: number;
	private readonly onsetFrames: number;
	private readonly hangoverFrames: number;
	private readonly prerollFrames: number;
	private readonly minSpeechFrames: number;
	private readonly maxFrames: number;
	private readonly marginDb: number;
	private readonly minThresholdDb: number;

	private pending = new Float32Array(0);
	private framesSeen = 0;
	private noiseFloorDb = -60;
	private recent: Float32Array[] = [];
	private loudRun = 0;
	private segment: Float32Array[] | null = null;
	private segmentStartFrame = 0;
	private voicedFrames = 0;
	private silentRun = 0;
	/** Latest frame level in dBFS, for a level meter. */
	levelDb = -100;

	constructor(private readonly options: SegmenterOptions) {
		this.frameMs = options.frameMs ?? 20;
		this.frameSize = Math.round((options.sampleRate * this.frameMs) / 1000);
		const frames = (ms: number) => Math.max(1, Math.round(ms / this.frameMs));
		this.onsetFrames = frames(options.onsetMs ?? 60);
		this.hangoverFrames = frames(options.hangoverMs ?? 700);
		this.prerollFrames = frames(options.prerollMs ?? 300);
		this.minSpeechFrames = frames(options.minSpeechMs ?? 300);
		this.maxFrames = frames(options.maxSegmentMs);
		this.marginDb = options.marginDb ?? 12;
		this.minThresholdDb = options.minThresholdDb ?? -52;
	}

	get speaking(): boolean {
		return this.segment !== null;
	}

	push(chunk: Float32Array): SpeechSegment[] {
		const out: SpeechSegment[] = [];
		const merged = new Float32Array(this.pending.length + chunk.length);
		merged.set(this.pending);
		merged.set(chunk, this.pending.length);
		let offset = 0;
		while (merged.length - offset >= this.frameSize) {
			const frame = merged.slice(offset, offset + this.frameSize);
			offset += this.frameSize;
			const segment = this.processFrame(frame);
			if (segment) out.push(segment);
		}
		this.pending = merged.slice(offset);
		return out;
	}

	/** Close any open segment (pause/stop). */
	flush(): SpeechSegment | null {
		const segment = this.segment ? this.emit(this.segment.length) : null;
		this.segment = null;
		this.pending = new Float32Array(0);
		return segment;
	}

	private processFrame(frame: Float32Array): SpeechSegment | null {
		let sum = 0;
		for (const sample of frame) sum += sample * sample;
		const db = 10 * Math.log10(sum / frame.length + 1e-12);
		this.levelDb = db;
		const threshold = Math.max(this.noiseFloorDb + this.marginDb, this.minThresholdDb);
		const loud = db > threshold;
		const index = this.framesSeen++;

		if (!this.segment) {
			// Track the floor quickly downwards and slowly upwards, only outside speech.
			this.noiseFloorDb = db < this.noiseFloorDb ? this.noiseFloorDb * 0.7 + db * 0.3 : this.noiseFloorDb * 0.995 + db * 0.005;
			this.recent.push(frame);
			if (this.recent.length > this.prerollFrames) this.recent.shift();
			this.loudRun = loud ? this.loudRun + 1 : 0;
			if (this.loudRun >= this.onsetFrames) {
				this.segment = [...this.recent];
				this.segmentStartFrame = index - this.recent.length + 1;
				this.recent = [];
				this.voicedFrames = this.loudRun;
				this.silentRun = 0;
				this.loudRun = 0;
			}
			return null;
		}

		this.segment.push(frame);
		if (loud) {
			this.voicedFrames++;
			this.silentRun = 0;
		} else {
			this.silentRun++;
		}

		if (this.silentRun >= this.hangoverFrames) {
			// Keep a short tail of the pause, drop the rest.
			const keep = this.segment.length - this.silentRun + Math.min(this.silentRun, Math.round(200 / this.frameMs));
			const segment = this.emit(keep);
			this.segment = null;
			return segment;
		}
		if (this.segment.length >= this.maxFrames) {
			// Continuous speech: cut here and keep listening without a new onset.
			const segment = this.emit(this.segment.length);
			this.segment = [];
			this.segmentStartFrame = index + 1;
			this.voicedFrames = 0;
			this.silentRun = 0;
			return segment;
		}
		return null;
	}

	private emit(frameCount: number): SpeechSegment | null {
		const frames = (this.segment ?? []).slice(0, frameCount);
		if (this.voicedFrames < this.minSpeechFrames || frames.length === 0) return null;
		const samples = new Float32Array(frames.length * this.frameSize);
		frames.forEach((frame, i) => samples.set(frame, i * this.frameSize));
		return {
			samples,
			startOffsetMs: Math.round(this.segmentStartFrame * this.frameMs),
			durationMs: Math.round(frames.length * this.frameMs)
		};
	}
}
