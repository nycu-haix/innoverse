import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { apiError } from "@innoverse/shared";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AsrProvider } from "./asr/asr-client";
import type { CaseService } from "./cases/case-service";
import type { CodexService } from "./codex/codex-service";
import type { Config } from "./config";
import type { AppDatabase } from "./db/database";
import { AppError } from "./errors";
import { registerAuthRoutes } from "./routes/auth";
import { registerCaseRoutes } from "./routes/cases";
import { registerHealthRoutes } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { registerSettingsRoutes } from "./routes/settings";

export type CodexFacade = Pick<CodexService, "getAuthStatus" | "startDeviceLogin" | "cancelLogin" | "logout" | "listModels" | "isAuthenticated"> & {
	readonly processState: string;
};

export type AppDependencies = {
	config: Pick<Config, "MAX_AUDIO_BYTES" | "MAX_UTTERANCE_SECONDS" | "WEB_DIST_DIR" | "TRUST_PROXY" | "isProduction" | "DEFAULT_MODEL">;
	db: AppDatabase;
	asr: AsrProvider;
	codex: CodexFacade;
	cases: CaseService;
};

export async function buildApp(deps: AppDependencies, options: { logger: FastifyBaseLogger | false }): Promise<FastifyInstance> {
	const app = Fastify({
		...(options.logger ? { loggerInstance: options.logger } : { logger: false }),
		trustProxy: deps.config.TRUST_PROXY,
		// JSON bodies are small (edits, the record draft); audio goes through multipart limits.
		bodyLimit: 2_097_152
	});

	await app.register(helmet, {
		contentSecurityPolicy: {
			useDefaults: false,
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'"],
				styleSrc: ["'self'", "'unsafe-inline'"],
				imgSrc: ["'self'", "data:"],
				fontSrc: ["'self'", "data:"],
				connectSrc: ["'self'"],
				mediaSrc: ["'self'", "blob:"],
				objectSrc: ["'none'"],
				frameSrc: ["'none'"],
				baseUri: ["'self'"],
				formAction: ["'self'"],
				frameAncestors: ["'none'"]
			}
		},
		crossOriginEmbedderPolicy: false
	});
	app.addHook("onSend", async (_request, reply) => {
		reply.header("permissions-policy", "microphone=(self), camera=(), geolocation=()");
	});

	await app.register(rateLimit, { global: false });
	await app.register(multipart, {
		limits: {
			fileSize: deps.config.MAX_AUDIO_BYTES,
			files: 1,
			fields: 12,
			fieldSize: 1024,
			parts: 16,
			headerPairs: 200
		}
	});

	app.setErrorHandler((error, request, reply) => {
		if (error instanceof AppError) {
			if (error.statusCode >= 500) request.log.warn({ errorCode: error.code, detail: error.message }, "request failed");
			return reply.status(error.statusCode).send(error.toBody());
		}
		const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 500;
		if (statusCode === 413) return reply.status(413).send(apiError("UPLOAD_TOO_LARGE"));
		if (statusCode === 429) return reply.status(429).send(apiError("RATE_LIMITED"));
		if (statusCode >= 400 && statusCode < 500) return reply.status(statusCode).send(apiError("BAD_REQUEST"));
		request.log.error({ err: error }, "unhandled error");
		return reply.status(500).send(apiError("INTERNAL"));
	});

	await app.register(
		async api => {
			registerHealthRoutes(api, deps);
			registerAuthRoutes(api, deps);
			registerModelRoutes(api, deps);
			registerSettingsRoutes(api, deps);
			registerCaseRoutes(api, deps);
		},
		{ prefix: "/api" }
	);

	const webRoot = path.resolve(deps.config.WEB_DIST_DIR);
	const hasWeb = existsSync(path.join(webRoot, "index.html"));
	if (hasWeb) {
		await app.register(fastifyStatic, {
			root: webRoot,
			wildcard: false,
			index: false,
			setHeaders(res, filePath) {
				if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header("cache-control", "public, max-age=31536000, immutable");
				else res.header("cache-control", "no-cache");
			}
		});
	}

	// SPA fallback: only for GET navigations outside /api. API 404s stay JSON.
	app.setNotFoundHandler((request, reply) => {
		const url = request.url.split("?")[0] ?? "/";
		if (url === "/api" || url.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD") || !hasWeb) {
			return reply.status(404).send(apiError("NOT_FOUND"));
		}
		return reply.header("cache-control", "no-cache").sendFile("index.html");
	});

	return app;
}
