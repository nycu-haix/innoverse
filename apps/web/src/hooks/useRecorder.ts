import { useCallback, useEffect, useRef, useState } from "react";
import { ClientError } from "../lib/errors";
import { pickRecorderMimeType } from "../lib/recorder-mime";

export type RecorderState = "idle" | "requesting" | "recording" | "stopping";

export type UseRecorderOptions = {
	maxDurationMs: number;
	/** Called with the finished recording when the maximum duration is reached. */
	onAutoStop: (blob: Blob | null) => void;
};

type Session = {
	recorder: MediaRecorder;
	stream: MediaStream;
	chunks: Blob[];
	canceled: boolean;
	startedAt: number;
	stopped: Promise<Blob | null>;
};

function stopTracks(stream: MediaStream | null | undefined) {
	stream?.getTracks().forEach(track => track.stop());
}

/**
 * MediaRecorder lifecycle. Microphone tracks are released on stop, cancel, error
 * and unmount. A canceled recording never produces a Blob.
 */
export function useRecorder({ maxDurationMs, onAutoStop }: UseRecorderOptions) {
	const [state, setState] = useState<RecorderState>("idle");
	const [elapsedMs, setElapsedMs] = useState(0);
	const session = useRef<Session | null>(null);
	const pendingRequest = useRef<{ canceled: boolean } | null>(null);
	const onAutoStopRef = useRef(onAutoStop);
	const tickTimer = useRef<number | undefined>(undefined);
	const limitTimer = useRef<number | undefined>(undefined);

	useEffect(() => {
		onAutoStopRef.current = onAutoStop;
	}, [onAutoStop]);

	const clearTimers = useCallback(() => {
		window.clearInterval(tickTimer.current);
		window.clearTimeout(limitTimer.current);
	}, []);

	const stop = useCallback((): Promise<Blob | null> => {
		const current = session.current;
		if (!current) return Promise.resolve(null);
		clearTimers();
		setState("stopping");
		if (current.recorder.state !== "inactive") current.recorder.stop();
		return current.stopped;
	}, [clearTimers]);

	const cancel = useCallback(() => {
		if (pendingRequest.current) pendingRequest.current.canceled = true;
		const current = session.current;
		clearTimers();
		if (current) {
			current.canceled = true;
			current.chunks.length = 0;
			if (current.recorder.state !== "inactive") current.recorder.stop();
			stopTracks(current.stream);
		}
		session.current = null;
		setElapsedMs(0);
		setState("idle");
	}, [clearTimers]);

	const start = useCallback(async (): Promise<void> => {
		if (session.current || pendingRequest.current) return;
		if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new ClientError("MIC_UNSUPPORTED");

		const request = { canceled: false };
		pendingRequest.current = request;
		setState("requesting");
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
		} catch (error) {
			pendingRequest.current = null;
			setState("idle");
			const name = error instanceof DOMException ? error.name : "";
			throw new ClientError(name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError" ? "MIC_PERMISSION" : "MIC_FAILED");
		}
		pendingRequest.current = null;
		if (request.canceled) {
			stopTracks(stream);
			setState("idle");
			return;
		}

		let recorder: MediaRecorder;
		try {
			const mimeType = pickRecorderMimeType();
			recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 }) : new MediaRecorder(stream);
		} catch {
			stopTracks(stream);
			setState("idle");
			throw new ClientError("MIC_UNSUPPORTED");
		}

		const chunks: Blob[] = [];
		let resolveStopped!: (blob: Blob | null) => void;
		const stopped = new Promise<Blob | null>(resolve => {
			resolveStopped = resolve;
		});
		const current: Session = { recorder, stream, chunks, canceled: false, startedAt: performance.now(), stopped };

		recorder.ondataavailable = event => {
			if (!current.canceled && event.data.size > 0) chunks.push(event.data);
		};
		recorder.onstop = () => {
			stopTracks(stream);
			if (session.current === current) session.current = null;
			clearTimers();
			setElapsedMs(0);
			setState("idle");
			if (current.canceled || chunks.length === 0) resolveStopped(null);
			else resolveStopped(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" }));
		};
		recorder.onerror = () => {
			current.canceled = true;
			stopTracks(stream);
			if (session.current === current) session.current = null;
			clearTimers();
			setState("idle");
			resolveStopped(null);
		};

		session.current = current;
		// A timeslice keeps memory bounded for long recordings and makes data arrive steadily.
		recorder.start(1_000);
		setElapsedMs(0);
		setState("recording");
		tickTimer.current = window.setInterval(() => setElapsedMs(performance.now() - current.startedAt), 500);
		limitTimer.current = window.setTimeout(() => {
			void stop().then(blob => onAutoStopRef.current(blob));
		}, maxDurationMs);
	}, [clearTimers, maxDurationMs, stop]);

	// Release the microphone if the component unmounts mid-recording.
	useEffect(() => cancel, [cancel]);

	return { state, elapsedMs, start, stop, cancel };
}
