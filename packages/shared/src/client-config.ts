import { z } from "zod";

/** Non-secret runtime settings the browser needs. */
export const ClientConfigSchema = z.object({
	maxRecordingSeconds: z.number().int().positive(),
	maxAudioBytes: z.number().int().positive()
});
export type ClientConfig = z.infer<typeof ClientConfigSchema>;

export const HealthResponseSchema = z.object({
	status: z.enum(["ok", "degraded", "error"]),
	database: z.object({ ok: z.boolean() }),
	codex: z.object({ state: z.string(), authenticated: z.boolean() }),
	asr: z.object({ reachable: z.boolean(), modelLoaded: z.boolean(), model: z.string().nullable(), device: z.string().nullable() })
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
