import { openAsBlob } from "node:fs";
import { z } from "zod";
import { AppError } from "../errors";

export type TranscriptionInput = {
	filePath: string;
	mimeType: string;
	hotwords: string[];
	language?: string;
	signal?: AbortSignal;
};

export type TranscriptionResult = {
	text: string;
	audioDurationMs: number | null;
	model: string;
	provider: string;
	processingMs: number;
};

export type AsrHealth = { reachable: boolean; modelLoaded: boolean; model: string | null; device: string | null };

/**
 * Application-side ASR boundary. The app layer only depends on this interface;
 * the concrete model (Fun-ASR-Nano, SenseVoice, Whisper, ...) lives behind the
 * ASR service and is selected there via ASR_PROVIDER / ASR_MODEL.
 */
export interface AsrProvider {
	transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
	health(): Promise<AsrHealth>;
}

/** Response contract of services/asr `POST /v1/transcribe`. */
export const TranscriptionResponseSchema = z.object({
	text: z.string(),
	language: z.string().nullable(),
	model: z.string(),
	provider: z.string(),
	audioDurationMs: z.number().nonnegative().nullable(),
	processingMs: z.number().nonnegative()
});

const HealthResponseSchema = z
	.object({
		status: z.string(),
		modelLoaded: z.boolean(),
		model: z.string().nullable().optional(),
		device: z.string().nullable().optional()
	})
	.loose();

const ErrorResponseSchema = z.object({ detail: z.object({ code: z.string() }).loose() }).loose();

/** HTTP client for the internal ASR service (never exposed publicly). */
export class HttpAsrProvider implements AsrProvider {
	private healthCache: { at: number; value: AsrHealth } | null = null;

	constructor(private readonly options: { baseUrl: string; timeoutMs: number; healthCacheMs?: number; fetch?: typeof fetch }) {}

	private get fetchImpl(): typeof fetch {
		return this.options.fetch ?? fetch;
	}

	async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
		const form = new FormData();
		const blob = await openAsBlob(input.filePath, { type: input.mimeType });
		form.append("hotwords", JSON.stringify(input.hotwords));
		if (input.language) form.append("language", input.language);
		form.append("audio", blob, "recording");

		const timeout = AbortSignal.timeout(this.options.timeoutMs);
		const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

		let response: Response;
		try {
			response = await this.fetchImpl(new URL("/v1/transcribe", this.options.baseUrl), { method: "POST", body: form, signal });
		} catch (error) {
			if (timeout.aborted) throw new AppError("ASR_TIMEOUT", { cause: error });
			throw new AppError("ASR_UNAVAILABLE", { cause: error });
		}

		if (!response.ok) {
			const body: unknown = await response.json().catch(() => null);
			const code = ErrorResponseSchema.safeParse(body).data?.detail.code;
			throw mapAsrError(response.status, code);
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			throw new AppError("ASR_UNAVAILABLE", { cause: error, detail: "ASR returned invalid JSON" });
		}
		const parsed = TranscriptionResponseSchema.safeParse(body);
		if (!parsed.success) throw new AppError("ASR_UNAVAILABLE", { detail: "ASR response failed validation" });
		return {
			text: parsed.data.text,
			audioDurationMs: parsed.data.audioDurationMs,
			model: parsed.data.model,
			provider: parsed.data.provider,
			processingMs: parsed.data.processingMs
		};
	}

	/** Cheap cached readiness probe used by `/api/health`. */
	async health(): Promise<AsrHealth> {
		const now = Date.now();
		if (this.healthCache && now - this.healthCache.at < (this.options.healthCacheMs ?? 10_000)) return this.healthCache.value;
		let value: AsrHealth;
		try {
			const response = await this.fetchImpl(new URL("/health", this.options.baseUrl), { signal: AbortSignal.timeout(2_000) });
			const parsed = HealthResponseSchema.safeParse(await response.json());
			value = parsed.success
				? { reachable: true, modelLoaded: parsed.data.modelLoaded, model: parsed.data.model ?? null, device: parsed.data.device ?? null }
				: { reachable: true, modelLoaded: false, model: null, device: null };
		} catch {
			value = { reachable: false, modelLoaded: false, model: null, device: null };
		}
		this.healthCache = { at: now, value };
		return value;
	}
}

function mapAsrError(status: number, code: string | undefined): AppError {
	if (code === "empty_audio") return new AppError("EMPTY_RECORDING");
	if (code === "too_long") return new AppError("UPLOAD_TOO_LARGE");
	if (status === 413) return new AppError("UPLOAD_TOO_LARGE");
	if (status === 400 || status === 415 || status === 422) return new AppError("UNSUPPORTED_AUDIO", { detail: code ?? `asr status ${status}` });
	if (status === 504) return new AppError("ASR_TIMEOUT");
	return new AppError("ASR_UNAVAILABLE", { detail: `asr status ${status}` });
}
