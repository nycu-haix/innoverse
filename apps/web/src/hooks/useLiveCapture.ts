import { useCallback, useEffect, useRef, useState } from "react";
import { ClientError } from "../lib/errors";
import { SpeechSegmenter, type SpeechSegment } from "../lib/segmenter";
import { encodeWav, resample } from "../lib/wav";

export type CaptureState = "idle" | "starting" | "recording" | "paused";

export type CapturedUtterance = { audio: Blob; startedAt: number; durationMs: number };

type Session = {
	stream: MediaStream;
	context: AudioContext;
	node: AudioWorkletNode;
	segmenter: SpeechSegmenter;
	/** Wall-clock time the current segmenter stream started (reset on resume). */
	streamStartedAt: number;
	recordedMs: number;
	runningSince: number | null;
};

const METER_BARS = 6;

/**
 * Continuous microphone capture cut into utterances at pauses. Each utterance is
 * delivered as a 16 kHz WAV with its wall-clock start time.
 */
export function useLiveCapture(options: { maxUtteranceMs: number; onUtterance: (utterance: CapturedUtterance) => void }) {
	const [state, setState] = useState<CaptureState>("idle");
	const [elapsedMs, setElapsedMs] = useState(0);
	const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0));
	const [speaking, setSpeaking] = useState(false);
	const session = useRef<Session | null>(null);
	const onUtterance = useRef(options.onUtterance);

	useEffect(() => {
		onUtterance.current = options.onUtterance;
	}, [options.onUtterance]);

	const deliver = useCallback((current: Session, segment: SpeechSegment | null) => {
		if (!segment) return;
		const audio = encodeWav(resample(segment.samples, current.context.sampleRate));
		onUtterance.current({ audio, startedAt: current.streamStartedAt + segment.startOffsetMs, durationMs: segment.durationMs });
	}, []);

	const newSegmenter = useCallback((sampleRate: number) => new SpeechSegmenter({ sampleRate, maxSegmentMs: options.maxUtteranceMs }), [options.maxUtteranceMs]);

	const teardown = useCallback((current: Session) => {
		current.node.port.onmessage = null;
		current.node.disconnect();
		current.stream.getTracks().forEach(track => track.stop());
		void current.context.close().catch(() => undefined);
	}, []);

	const start = useCallback(async () => {
		if (session.current) return;
		if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") throw new ClientError("MIC_UNSUPPORTED");
		setState("starting");
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
		} catch (error) {
			setState("idle");
			const name = error instanceof DOMException ? error.name : "";
			throw new ClientError(name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError" ? "MIC_PERMISSION" : "MIC_FAILED");
		}
		try {
			const context = new AudioContext();
			await context.audioWorklet.addModule("/pcm-capture.js");
			const source = context.createMediaStreamSource(stream);
			const node = new AudioWorkletNode(context, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
			// Keep the graph pulled without playing the microphone back.
			const mute = context.createGain();
			mute.gain.value = 0;
			source.connect(node).connect(mute).connect(context.destination);
			const current: Session = { stream, context, node, segmenter: newSegmenter(context.sampleRate), streamStartedAt: Date.now(), recordedMs: 0, runningSince: performance.now() };
			node.port.onmessage = (event: MessageEvent<Float32Array>) => {
				for (const segment of current.segmenter.push(event.data)) deliver(current, segment);
			};
			session.current = current;
			setState("recording");
		} catch {
			stream.getTracks().forEach(track => track.stop());
			setState("idle");
			throw new ClientError("MIC_FAILED");
		}
	}, [deliver, newSegmenter]);

	const pause = useCallback(async () => {
		const current = session.current;
		if (!current || current.runningSince === null) return;
		current.recordedMs += performance.now() - current.runningSince;
		current.runningSince = null;
		setElapsedMs(current.recordedMs);
		setSpeaking(false);
		deliver(current, current.segmenter.flush());
		await current.context.suspend();
		setState("paused");
	}, [deliver]);

	const resume = useCallback(async () => {
		const current = session.current;
		if (!current || current.runningSince !== null) return;
		await current.context.resume();
		current.segmenter = newSegmenter(current.context.sampleRate);
		current.streamStartedAt = Date.now();
		current.runningSince = performance.now();
		setState("recording");
	}, [newSegmenter]);

	const stop = useCallback(() => {
		const current = session.current;
		if (!current) return;
		session.current = null;
		if (current.runningSince !== null) deliver(current, current.segmenter.flush());
		teardown(current);
		setElapsedMs(0);
		setLevels(Array(METER_BARS).fill(0));
		setSpeaking(false);
		setState("idle");
	}, [deliver, teardown]);

	// Elapsed time and level meter at ~8 fps.
	useEffect(() => {
		if (state !== "recording") return;
		const timer = window.setInterval(() => {
			const current = session.current;
			if (!current || current.runningSince === null) return;
			setElapsedMs(current.recordedMs + performance.now() - current.runningSince);
			const level = Math.max(0, Math.min(1, (current.segmenter.levelDb + 70) / 55));
			setLevels(previous => [...previous.slice(1), level]);
			setSpeaking(current.segmenter.speaking);
		}, 125);
		return () => window.clearInterval(timer);
	}, [state]);

	// Release the microphone on unmount.
	useEffect(
		() => () => {
			const current = session.current;
			session.current = null;
			if (current) teardown(current);
		},
		[teardown]
	);

	return { state, elapsedMs, levels, speaking, start, pause, resume, stop };
}
