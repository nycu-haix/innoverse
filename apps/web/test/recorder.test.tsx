import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "../src/hooks/useRecorder";
import { ClientError } from "../src/lib/errors";
import { pickRecorderMimeType } from "../src/lib/recorder-mime";
import { FakeMediaRecorder, installFakeMedia } from "./fake-media";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("pickRecorderMimeType", () => {
	it("prefers webm/opus, falls back for Safari, and lets the browser choose otherwise", () => {
		expect(pickRecorderMimeType({ isTypeSupported: type => type === "audio/webm;codecs=opus" })).toBe("audio/webm;codecs=opus");
		expect(pickRecorderMimeType({ isTypeSupported: type => type === "audio/mp4" })).toBe("audio/mp4");
		expect(pickRecorderMimeType({ isTypeSupported: () => false })).toBe("");
		expect(pickRecorderMimeType(undefined)).toBe("");
	});
});

describe("useRecorder", () => {
	it("records and returns a Blob on stop, releasing the microphone", async () => {
		const { streams } = installFakeMedia();
		const { result } = renderHook(() => useRecorder({ maxDurationMs: 60_000, onAutoStop: vi.fn() }));
		await act(() => result.current.start());
		expect(result.current.state).toBe("recording");
		const recorder = FakeMediaRecorder.instances[0]!;
		expect(recorder.mimeType).toBe("audio/webm;codecs=opus");
		recorder.emitData("a");

		let blob: Blob | null = null;
		await act(async () => {
			blob = await result.current.stop();
		});
		expect(blob).toBeInstanceOf(Blob);
		expect((blob as unknown as Blob).size).toBeGreaterThan(0);
		expect(streams[0]!.tracks.every(track => track.stopped)).toBe(true);
		expect(result.current.state).toBe("idle");
	});

	it("cancel stops tracks, discards chunks and never produces a Blob", async () => {
		const { streams } = installFakeMedia();
		const { result } = renderHook(() => useRecorder({ maxDurationMs: 60_000, onAutoStop: vi.fn() }));
		await act(() => result.current.start());
		FakeMediaRecorder.instances[0]!.emitData("secret speech");
		act(() => result.current.cancel());
		expect(streams[0]!.tracks.every(track => track.stopped)).toBe(true);
		expect(result.current.state).toBe("idle");
		// A later stop call has nothing to return.
		await expect(result.current.stop()).resolves.toBeNull();
	});

	it("reports denied microphone permission", async () => {
		installFakeMedia({ deny: true });
		const { result } = renderHook(() => useRecorder({ maxDurationMs: 60_000, onAutoStop: vi.fn() }));
		await act(async () => {
			await expect(result.current.start()).rejects.toMatchObject({ code: "MIC_PERMISSION", message: "無法使用麥克風，請確認瀏覽器權限。" });
		});
		expect(result.current.state).toBe("idle");
	});

	it("reports unsupported MediaRecorder", async () => {
		vi.stubGlobal("MediaRecorder", undefined);
		const { result } = renderHook(() => useRecorder({ maxDurationMs: 60_000, onAutoStop: vi.fn() }));
		await expect(result.current.start()).rejects.toBeInstanceOf(ClientError);
	});

	it("stops automatically at the maximum duration and hands over the recording", async () => {
		installFakeMedia();
		const onAutoStop = vi.fn();
		const { result } = renderHook(() => useRecorder({ maxDurationMs: 30, onAutoStop }));
		await act(() => result.current.start());
		await vi.waitFor(() => expect(onAutoStop).toHaveBeenCalledTimes(1));
		expect(onAutoStop.mock.calls[0]![0]).toBeInstanceOf(Blob);
	});

	it("releases the microphone when unmounted mid-recording", async () => {
		const { streams } = installFakeMedia();
		const { result, unmount } = renderHook(() => useRecorder({ maxDurationMs: 60_000, onAutoStop: vi.fn() }));
		await act(() => result.current.start());
		unmount();
		expect(streams[0]!.tracks.every(track => track.stopped)).toBe(true);
	});
});
