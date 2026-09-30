import { z } from "zod";

export const ERROR_CODES = [
	"BAD_REQUEST",
	"NOT_FOUND",
	"EMPTY_RECORDING",
	"UNSUPPORTED_AUDIO",
	"UPLOAD_TOO_LARGE",
	"ASR_UNAVAILABLE",
	"ASR_TIMEOUT",
	"NO_SPEECH",
	"CODEX_UNAUTHENTICATED",
	"CODEX_UNAVAILABLE",
	"CODEX_RATE_LIMITED",
	"LOGIN_FAILED",
	"INVALID_MODEL",
	"INVALID_REASONING_EFFORT",
	"INVALID_OUTPUT",
	"INVALID_SLIDE",
	"STALE_REVISION",
	"GENERATION_IN_PROGRESS",
	"GENERATION_FAILED",
	"DATABASE_ERROR",
	"RATE_LIMITED",
	"INTERNAL"
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
	error: z.object({
		code: ErrorCodeSchema,
		message: z.string()
	})
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

/** Concise Traditional Chinese user-facing messages. Never include stack traces. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
	BAD_REQUEST: "請求內容不正確。",
	NOT_FOUND: "找不到資料。",
	EMPTY_RECORDING: "錄音是空的，請再試一次。",
	UNSUPPORTED_AUDIO: "不支援這種錄音格式。",
	UPLOAD_TOO_LARGE: "錄音檔案太大。",
	ASR_UNAVAILABLE: "語音辨識服務目前無法使用。",
	ASR_TIMEOUT: "語音辨識逾時，請再試一次。",
	NO_SPEECH: "沒有辨識到語音，請再試一次。",
	CODEX_UNAUTHENTICATED: "AI 服務需要重新登入。",
	CODEX_UNAVAILABLE: "AI 服務暫時無法使用，原本的內容已保留。",
	CODEX_RATE_LIMITED: "AI 服務使用量已達上限，請稍後再試。",
	LOGIN_FAILED: "登入失敗，請再試一次。",
	INVALID_MODEL: "選擇的模型無法使用。",
	INVALID_REASONING_EFFORT: "選擇的思考強度無法使用。",
	INVALID_OUTPUT: "產生內容失敗，原本的內容已保留。",
	INVALID_SLIDE: "產生內容失敗，原本的內容已保留。",
	STALE_REVISION: "內容已在其他地方更新，請再試一次。",
	GENERATION_IN_PROGRESS: "正在處理上一段錄音。",
	GENERATION_FAILED: "產生內容失敗，原本的內容已保留。",
	DATABASE_ERROR: "無法儲存內容，請再試一次。",
	RATE_LIMITED: "操作太頻繁，請稍後再試。",
	INTERNAL: "發生錯誤，請再試一次。"
};

export function apiError(code: ErrorCode, message: string = ERROR_MESSAGES[code]): ApiErrorBody {
	return { error: { code, message } };
}
