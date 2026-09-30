import {
	ApiErrorSchema,
	ArtifactSchema,
	AuthStatusSchema,
	ClientConfigSchema,
	DeviceLoginStartResponseSchema,
	GenerationEventSchema,
	ModelsResponseSchema,
	UpdateArtifactResponseSchema,
	UpdateHotwordsResponseSchema,
	WorkspaceSchema,
	type Artifact,
	type ArtifactMode,
	type GenerationResult,
	type GenerationStage
} from "@innoverse/shared";
import { z } from "zod";
import { ClientError } from "./errors";

async function request(path: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(path, { ...init, headers: { accept: "application/json", ...init?.headers } });
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") throw error;
		throw new ClientError("NETWORK");
	}
}

async function toClientError(response: Response): Promise<ClientError> {
	const body: unknown = await response.json().catch(() => null);
	const parsed = ApiErrorSchema.safeParse(body);
	if (parsed.success) return new ClientError(parsed.data.error.code, parsed.data.error.message);
	if (response.status === 413) return new ClientError("UPLOAD_TOO_LARGE");
	return new ClientError(response.status >= 500 ? "INTERNAL" : "BAD_REQUEST");
}

/** Fetch JSON and validate it with the shared Zod schema. */
async function getJson<T extends z.ZodType>(schema: T, path: string, init?: RequestInit): Promise<z.infer<T>> {
	const response = await request(path, init);
	if (!response.ok) throw await toClientError(response);
	const parsed = schema.safeParse(await response.json().catch(() => null));
	if (!parsed.success) throw new ClientError("INTERNAL");
	return parsed.data;
}

function jsonBody(method: string, body: unknown): RequestInit {
	return { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

export const api = {
	config: () => getJson(ClientConfigSchema, "/api/config"),
	authStatus: () => getJson(AuthStatusSchema, "/api/auth/status"),
	startDeviceLogin: () => getJson(DeviceLoginStartResponseSchema, "/api/auth/device/start", { method: "POST" }),
	async cancelDeviceLogin(): Promise<void> {
		const response = await request("/api/auth/device/cancel", { method: "POST" });
		if (!response.ok) throw await toClientError(response);
	},
	async logout(): Promise<void> {
		const response = await request("/api/auth/logout", { method: "POST" });
		if (!response.ok) throw await toClientError(response);
	},
	models: () => getJson(ModelsResponseSchema, "/api/models"),
	workspace: (workspaceId: string) => getJson(WorkspaceSchema, `/api/workspaces/${encodeURIComponent(workspaceId)}`),
	saveHotwords: (workspaceId: string, hotwords: string[]) => getJson(UpdateHotwordsResponseSchema, `/api/workspaces/${encodeURIComponent(workspaceId)}/hotwords`, jsonBody("PUT", { hotwords })),

	/** Optimistic-concurrency save. On conflict returns the server's current artifact. */
	async saveArtifact(workspaceId: string, mode: ArtifactMode, content: string, baseRevision: number): Promise<{ ok: true; artifact: Artifact } | { ok: false; current: Artifact | null }> {
		const response = await request(`/api/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${mode}`, jsonBody("PUT", { content, baseRevision }));
		if (response.status === 409) {
			const body: unknown = await response.json().catch(() => null);
			const parsed = z.object({ current: ArtifactSchema.nullable() }).safeParse(body);
			return { ok: false, current: parsed.success ? parsed.data.current : null };
		}
		if (!response.ok) throw await toClientError(response);
		const parsed = UpdateArtifactResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new ClientError("INTERNAL");
		return { ok: true, artifact: parsed.data.artifact };
	}
};

export type GenerateRequest = {
	workspaceId: string;
	mode: ArtifactMode;
	continue: boolean;
	model: string | null;
	reasoningEffort: string | null;
	artifactRevision: number;
	audio: Blob;
};

function audioFilename(type: string): string {
	if (type.includes("webm")) return "recording.webm";
	if (type.includes("ogg")) return "recording.ogg";
	if (type.includes("mp4") || type.includes("aac")) return "recording.m4a";
	if (type.includes("wav")) return "recording.wav";
	return "recording";
}

/**
 * POST /api/generate. Metadata fields go first, then the audio. The server replies with
 * a JSON error (before processing) or an NDJSON stream of stage events + final result.
 */
export async function generateArtifact(input: GenerateRequest, onStage: (stage: GenerationStage) => void): Promise<GenerationResult> {
	const form = new FormData();
	form.append("workspaceId", input.workspaceId);
	form.append("mode", input.mode);
	form.append("continue", String(input.continue));
	form.append("model", input.model ?? "");
	form.append("reasoningEffort", input.reasoningEffort ?? "");
	form.append("artifactRevision", String(input.artifactRevision));
	form.append("audio", input.audio, audioFilename(input.audio.type));

	const response = await request("/api/generate", { method: "POST", body: form, headers: { accept: "application/x-ndjson" } });
	if (!response.ok) throw await toClientError(response);
	if (!response.body) throw new ClientError("INTERNAL");

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	let result: GenerationResult | null = null;
	const handleLine = (line: string) => {
		if (!line.trim()) return;
		let json: unknown;
		try {
			json = JSON.parse(line);
		} catch {
			throw new ClientError("INTERNAL");
		}
		const event = GenerationEventSchema.safeParse(json);
		if (!event.success) throw new ClientError("INTERNAL");
		if (event.data.type === "stage") onStage(event.data.stage);
		else if (event.data.type === "error") throw new ClientError(event.data.error.code, event.data.error.message);
		else result = event.data.result;
	};
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			let newline: number;
			while ((newline = buffer.indexOf("\n")) >= 0) {
				handleLine(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
			}
		}
		handleLine(buffer);
	} catch (error) {
		if (error instanceof ClientError) throw error;
		throw new ClientError("NETWORK");
	} finally {
		reader.releaseLock();
	}
	if (!result) throw new ClientError("GENERATION_FAILED");
	return result;
}
