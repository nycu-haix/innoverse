import { ERROR_MESSAGES, type ErrorCode } from "@innoverse/shared";

export type ClientErrorCode = ErrorCode | "NETWORK" | "MIC_PERMISSION" | "MIC_UNSUPPORTED" | "MIC_FAILED";

const CLIENT_MESSAGES: Record<Exclude<ClientErrorCode, ErrorCode>, string> = {
	NETWORK: "網路連線失敗，請再試一次。",
	MIC_PERMISSION: "無法使用麥克風，請確認瀏覽器權限。",
	MIC_UNSUPPORTED: "這個瀏覽器不支援錄音。",
	MIC_FAILED: "無法開始錄音，請再試一次。"
};

/** Error with a stable code and a concise Traditional Chinese message. */
export class ClientError extends Error {
	readonly code: ClientErrorCode;

	constructor(code: ClientErrorCode, message?: string) {
		super(message ?? (code in CLIENT_MESSAGES ? CLIENT_MESSAGES[code as keyof typeof CLIENT_MESSAGES] : ERROR_MESSAGES[code as ErrorCode]));
		this.name = "ClientError";
		this.code = code;
	}
}

export function userMessage(error: unknown): string {
	if (error instanceof ClientError) return error.message;
	return ERROR_MESSAGES.INTERNAL;
}
