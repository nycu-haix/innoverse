import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app";

const authRateLimit = { rateLimit: { max: 20, timeWindow: "1 minute" } };

export function registerAuthRoutes(app: FastifyInstance, deps: AppDependencies): void {
	app.get("/auth/status", async (_request, reply) => {
		reply.header("cache-control", "no-store");
		return deps.codex.getAuthStatus();
	});

	app.post("/auth/device/start", { config: authRateLimit }, async () => deps.codex.startDeviceLogin());

	app.post("/auth/device/cancel", { config: authRateLimit }, async (_request, reply) => {
		await deps.codex.cancelLogin();
		return reply.status(204).send();
	});

	app.post("/auth/logout", { config: authRateLimit }, async (_request, reply) => {
		await deps.codex.logout();
		return reply.status(204).send();
	});
}
