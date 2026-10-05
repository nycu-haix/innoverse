import {
	ApiErrorSchema,
	AuthStatusSchema,
	CaseDetailSchema,
	CaseListResponseSchema,
	CaseVersionResponseSchema,
	ClientConfigSchema,
	DeviceLoginStartResponseSchema,
	ModelsResponseSchema,
	RecordDocumentSchema,
	SettingsSchema,
	UpdateRecordResponseSchema,
	UtteranceSchema,
	type GapState,
	type RecordDocument,
	type Settings,
	type Speaker
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

async function send(path: string, init: RequestInit): Promise<void> {
	const response = await request(path, init);
	if (!response.ok) throw await toClientError(response);
}

function jsonBody(method: string, body: unknown): RequestInit {
	return { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

const casePath = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}`;

export const api = {
	config: () => getJson(ClientConfigSchema, "/api/config"),
	authStatus: () => getJson(AuthStatusSchema, "/api/auth/status"),
	startDeviceLogin: () => getJson(DeviceLoginStartResponseSchema, "/api/auth/device/start", { method: "POST" }),
	cancelDeviceLogin: () => send("/api/auth/device/cancel", { method: "POST" }),
	logout: () => send("/api/auth/logout", { method: "POST" }),
	models: () => getJson(ModelsResponseSchema, "/api/models"),
	settings: () => getJson(SettingsSchema, "/api/settings"),
	saveSettings: (settings: Settings) => getJson(SettingsSchema, "/api/settings", jsonBody("PUT", settings)),

	listCases: () => getJson(CaseListResponseSchema, "/api/cases"),
	createCase: () => getJson(CaseDetailSchema, "/api/cases", { method: "POST" }),
	getCase: (caseId: string) => getJson(CaseDetailSchema, casePath(caseId)),
	caseVersion: async (caseId: string) => (await getJson(CaseVersionResponseSchema, `${casePath(caseId)}/version`)).version,

	/** One utterance: fields first, then the WAV. */
	uploadUtterance(caseId: string, audio: Blob, startedAt: number, durationMs: number) {
		const form = new FormData();
		form.append("startedAt", String(Math.round(startedAt)));
		form.append("durationMs", String(Math.round(durationMs)));
		form.append("audio", audio, "utterance.wav");
		return getJson(UtteranceSchema, `${casePath(caseId)}/utterances`, { method: "POST", body: form });
	},
	audioUrl: (caseId: string, lineId: string) => `${casePath(caseId)}/utterances/${lineId}/audio`,
	setSpeaker: (caseId: string, lineId: string, speaker: Speaker) => send(`${casePath(caseId)}/utterances/${lineId}/speaker`, jsonBody("PUT", { speaker })),
	editFact: (caseId: string, factId: string, text: string | null) => send(`${casePath(caseId)}/facts/${encodeURIComponent(factId)}`, jsonBody("PUT", { text })),
	setGapState: (caseId: string, gapId: string, state: GapState) => send(`${casePath(caseId)}/gaps/${encodeURIComponent(gapId)}`, jsonBody("PUT", { state })),
	analyze: (caseId: string) => send(`${casePath(caseId)}/analyze`, { method: "POST" }),
	generateRecord: async (caseId: string) => (await getJson(UpdateRecordResponseSchema, `${casePath(caseId)}/record/generate`, { method: "POST" })).record,

	/** Optimistic-concurrency save. On conflict returns the server's current document. */
	async saveRecord(caseId: string, content: string, baseRevision: number): Promise<{ ok: true; record: RecordDocument } | { ok: false; current: RecordDocument | null }> {
		const response = await request(`${casePath(caseId)}/record`, jsonBody("PUT", { content, baseRevision }));
		if (response.status === 409) {
			const parsed = z.object({ current: RecordDocumentSchema.nullable() }).safeParse(await response.json().catch(() => null));
			return { ok: false, current: parsed.success ? parsed.data.current : null };
		}
		if (!response.ok) throw await toClientError(response);
		const parsed = UpdateRecordResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new ClientError("INTERNAL");
		return { ok: true, record: parsed.data.record };
	}
};
