import { mkdirSync } from "node:fs";
import { pino } from "pino";
import { buildApp } from "./app";
import { HttpAsrProvider } from "./asr/asr-client";
import { CodexAppServerClient } from "./codex/app-server-client";
import { CodexService } from "./codex/codex-service";
import { OPT_OUT_NOTIFICATIONS } from "./codex/protocol";
import { loadConfig } from "./config";
import { AppDatabase } from "./db/database";
import { GenerationService } from "./generation/generation-service";

const CODEX_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USER",
	"LANG",
	"LC_ALL",
	"TZ",
	"TMPDIR",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"HTTPS_PROXY",
	"HTTP_PROXY",
	"NO_PROXY",
	"https_proxy",
	"http_proxy",
	"no_proxy",
	"RUST_LOG"
];

async function main(): Promise<void> {
	const config = loadConfig();
	const logger = pino({
		level: config.LOG_LEVEL,
		// Defense in depth: these should never be logged, but redact if they ever are.
		redact: { paths: ["req.headers.authorization", "req.headers.cookie", "*.accessToken", "*.refreshToken", "*.apiKey", "*.userCode", "*.transcript", "*.content"], censor: "[redacted]" }
	});

	mkdirSync(config.CODEX_RUNTIME_DIR, { recursive: true });
	const db = new AppDatabase(config.DATABASE_PATH);

	const codexEnv: NodeJS.ProcessEnv = {};
	for (const key of CODEX_ENV_ALLOWLIST) if (process.env[key] !== undefined) codexEnv[key] = process.env[key];
	if (config.CODEX_HOME) {
		mkdirSync(config.CODEX_HOME, { recursive: true });
		codexEnv.CODEX_HOME = config.CODEX_HOME;
	}

	const codexClient = new CodexAppServerClient({
		command: config.CODEX_BIN,
		cwd: config.CODEX_RUNTIME_DIR,
		env: codexEnv,
		logger: logger.child({ component: "codex" }),
		clientInfo: { name: "innoverse", title: "Innoverse", version: "0.1.0" },
		optOutNotificationMethods: OPT_OUT_NOTIFICATIONS,
		onServerRequest: request => CodexService.handleServerRequest(request)
	});
	const codex = new CodexService(codexClient, {
		runtimeDir: config.CODEX_RUNTIME_DIR,
		turnTimeoutMs: config.CODEX_TURN_TIMEOUT_MS,
		modelCacheMs: config.CODEX_MODEL_CACHE_MS,
		logger: logger.child({ component: "codex" })
	});
	const asr = new HttpAsrProvider({ baseUrl: config.ASR_URL, timeoutMs: config.ASR_TIMEOUT_MS });
	const generation = new GenerationService({
		db,
		asr,
		codex,
		logger: logger.child({ component: "generation" }),
		asrLanguage: config.ASR_LANGUAGE,
		organizationHotwords: config.organizationHotwords,
		persistTranscripts: config.PERSIST_TRANSCRIPTS,
		logTextPreviews: config.LOG_TEXT_PREVIEWS
	});

	const app = await buildApp({ config, db, asr, codex, generation }, { logger });

	app.addHook("onClose", async () => {
		await codexClient.close();
		db.close();
	});

	// Start Codex in the background; the app can serve the auth screen meanwhile.
	codexClient
		.start()
		.then(() => codex.refreshAccount())
		.then(account => logger.info({ authenticated: account.account !== null || !account.requiresOpenaiAuth }, "codex account checked"))
		.catch(error => logger.error({ err: error }, "codex app-server failed to start; will retry"));

	let shuttingDown = false;
	const shutdown = (signal: NodeJS.Signals) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info({ signal }, "shutting down");
		const forceExit = setTimeout(() => process.exit(1), 15_000);
		forceExit.unref();
		app
			.close()
			.then(() => process.exit(0))
			.catch(error => {
				logger.error({ err: error }, "shutdown failed");
				process.exit(1);
			});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch(error => {
	console.error("fatal startup error", error);
	process.exit(1);
});
