/** Preference order; Safari typically only supports audio/mp4. */
export const RECORDER_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"] as const;

type RecorderSupport = { isTypeSupported(type: string): boolean } | undefined;

/** Returns the preferred supported MIME type, or `""` to let the browser choose. */
export function pickRecorderMimeType(recorder: RecorderSupport = typeof MediaRecorder === "undefined" ? undefined : MediaRecorder): string {
	if (!recorder || typeof recorder.isTypeSupported !== "function") return "";
	for (const candidate of RECORDER_MIME_CANDIDATES) {
		try {
			if (recorder.isTypeSupported(candidate)) return candidate;
		} catch {
			// Some browsers throw for unknown types.
		}
	}
	return "";
}
