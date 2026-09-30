import type { GenerationStage } from "@innoverse/shared";

export type SessionStatus = "idle" | "recording" | "uploading" | "transcribing" | "generating" | "success" | "error";

export type SessionState = {
	status: SessionStatus;
	error: string | null;
	warnings: string[];
};

export type SessionAction =
	| { type: "record" }
	| { type: "cancel" }
	| { type: "submit" }
	| { type: "stage"; stage: GenerationStage }
	| { type: "success"; warnings: string[] }
	| { type: "fail"; error: string }
	| { type: "dismiss" };

export const initialSession: SessionState = { status: "idle", error: null, warnings: [] };

export function isProcessing(status: SessionStatus): boolean {
	return status === "uploading" || status === "transcribing" || status === "generating";
}

export function canStartRecording(status: SessionStatus): boolean {
	return status === "idle" || status === "success" || status === "error";
}

/**
 * Explicit interaction state machine:
 * idle → recording → uploading → transcribing → generating → success | error.
 * Invalid transitions are ignored, which prevents double submissions.
 */
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
	switch (action.type) {
		case "record":
			return canStartRecording(state.status) ? { status: "recording", error: null, warnings: [] } : state;
		case "cancel":
			return state.status === "recording" ? { ...state, status: "idle" } : state;
		case "submit":
			return state.status === "recording" ? { ...state, status: "uploading" } : state;
		case "stage":
			return isProcessing(state.status) ? { ...state, status: action.stage } : state;
		case "success":
			return isProcessing(state.status) ? { status: "success", error: null, warnings: action.warnings } : state;
		case "fail":
			return { status: "error", error: action.error, warnings: [] };
		case "dismiss":
			return isProcessing(state.status) || state.status === "recording" ? state : { status: "idle", error: null, warnings: [] };
	}
}

export const STATUS_TEXT: Partial<Record<SessionStatus, string>> = {
	uploading: "上傳中…",
	transcribing: "語音辨識中…",
	generating: "整理內容中…"
};
