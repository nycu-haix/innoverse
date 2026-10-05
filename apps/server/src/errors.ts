import { apiError, ERROR_MESSAGES, type ApiErrorBody, type ErrorCode } from "@innoverse/shared";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
	BAD_REQUEST: 400,
	NOT_FOUND: 404,
	EMPTY_RECORDING: 400,
	UNSUPPORTED_AUDIO: 415,
	UPLOAD_TOO_LARGE: 413,
	ASR_UNAVAILABLE: 503,
	ASR_TIMEOUT: 504,
	NO_SPEECH: 422,
	CODEX_UNAUTHENTICATED: 401,
	CODEX_UNAVAILABLE: 503,
	CODEX_RATE_LIMITED: 429,
	LOGIN_FAILED: 502,
	INVALID_MODEL: 400,
	INVALID_REASONING_EFFORT: 400,
	INVALID_OUTPUT: 502,
	STALE_REVISION: 409,
	GENERATION_IN_PROGRESS: 409,
	GENERATION_FAILED: 502,
	DATABASE_ERROR: 500,
	RATE_LIMITED: 429,
	INTERNAL: 500
};

/** Application error with a stable code and a user-facing Traditional Chinese message. */
export class AppError extends Error {
	readonly code: ErrorCode;
	readonly statusCode: number;

	constructor(code: ErrorCode, options?: { cause?: unknown; detail?: string }) {
		super(options?.detail ?? code, options?.cause === undefined ? undefined : { cause: options.cause });
		this.name = "AppError";
		this.code = code;
		this.statusCode = STATUS_BY_CODE[code];
	}

	toBody(): ApiErrorBody {
		return apiError(this.code, ERROR_MESSAGES[this.code]);
	}
}

export function toAppError(error: unknown, fallback: ErrorCode = "INTERNAL"): AppError {
	return error instanceof AppError ? error : new AppError(fallback, { cause: error });
}
