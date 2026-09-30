import type { ClientConfig, HealthResponse } from "@innoverse/shared";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDependencies): void {
	app.get("/health", async (_request, reply) => {
		let databaseOk: boolean;
		try {
			databaseOk = deps.db.ping();
		} catch {
			databaseOk = false;
		}
		const asr = await deps.asr.health();
		const codexReady = deps.codex.processState === "ready";
		const body: HealthResponse = {
			status: !databaseOk ? "error" : codexReady && asr.modelLoaded ? "ok" : "degraded",
			database: { ok: databaseOk },
			codex: { state: deps.codex.processState, authenticated: codexReady && deps.codex.isAuthenticated },
			asr
		};
		// Only a broken database makes the app itself unhealthy; ASR / Codex may still be warming up.
		return reply.status(databaseOk ? 200 : 503).send(body);
	});

	app.get("/config", async () => {
		const body: ClientConfig = {
			maxRecordingSeconds: Math.round(deps.config.MAX_AUDIO_MINUTES * 60),
			maxAudioBytes: deps.config.MAX_AUDIO_BYTES
		};
		return body;
	});
}
