import { vi } from "vitest";

export class FakeTrack {
	stopped = false;
	stop() {
		this.stopped = true;
	}
}

export class FakeStream {
	readonly tracks = [new FakeTrack()];
	getTracks() {
		return this.tracks;
	}
}

export class FakeMediaRecorder {
	static instances: FakeMediaRecorder[] = [];
	static supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
	static isTypeSupported(type: string) {
		return FakeMediaRecorder.supported.has(type);
	}

	state: "inactive" | "recording" = "inactive";
	readonly mimeType: string;
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(
		readonly stream: FakeStream,
		options?: { mimeType?: string }
	) {
		this.mimeType = options?.mimeType ?? "";
		FakeMediaRecorder.instances.push(this);
	}

	start() {
		this.state = "recording";
	}

	emitData(text = "audio-chunk") {
		this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) });
	}

	stop() {
		if (this.state === "inactive") return;
		this.state = "inactive";
		this.emitData("final-chunk");
		queueMicrotask(() => this.onstop?.());
	}
}

/** Install fake MediaRecorder + getUserMedia on the jsdom window. */
export function installFakeMedia(options: { deny?: boolean } = {}) {
	FakeMediaRecorder.instances = [];
	const streams: FakeStream[] = [];
	vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
	const getUserMedia = vi.fn(async () => {
		if (options.deny) throw new DOMException("denied", "NotAllowedError");
		const stream = new FakeStream();
		streams.push(stream);
		return stream;
	});
	Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
	return { streams, getUserMedia };
}
