import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

const booleanString = z
	.enum(["true", "false", "1", "0", ""])
	.optional()
	.transform(value => value === "true" || value === "1");

const EnvSchema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	HOST: z.string().default("0.0.0.0"),
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
	/** Development only: include short redacted text previews in logs. Ignored in production. */
	LOG_TEXT_PREVIEWS: booleanString,
	TRUST_PROXY: booleanString,

	DATABASE_PATH: z.string().default(path.join(serverRoot, "data", "app.db")),
	/** Persist generation transcripts in SQLite for debugging. Off by default. */
	PERSIST_TRANSCRIPTS: booleanString,

	CODEX_BIN: z.string().default("codex"),
	CODEX_HOME: z.string().optional(),
	/** Dedicated empty working directory for Codex threads. */
	CODEX_RUNTIME_DIR: z.string().default(path.join(serverRoot, ".runtime", "codex-workdir")),
	CODEX_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
	CODEX_MODEL_CACHE_MS: z.coerce.number().int().nonnegative().default(300_000),

	ASR_URL: z.url().default("http://127.0.0.1:8000"),
	ASR_LANGUAGE: z.string().default("zh"),
	ASR_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
	/** Comma-separated organization-wide hotwords. */
	HOTWORDS: z.string().default(""),
	/** Path to a UTF-8 file with one hotword per line (# starts a comment). */
	HOTWORDS_FILE: z.string().optional(),

	MAX_AUDIO_MINUTES: z.coerce.number().positive().max(240).default(60),
	MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(262_144_000),

	WEB_DIST_DIR: z.string().default(path.resolve(serverRoot, "..", "web", "dist"))
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
	const parsed = EnvSchema.safeParse(env);
	if (!parsed.success) {
		const issues = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
		throw new Error(`Invalid environment configuration: ${issues}`);
	}
	const values = parsed.data;
	return {
		...values,
		isProduction: values.NODE_ENV === "production",
		LOG_TEXT_PREVIEWS: values.LOG_TEXT_PREVIEWS && values.NODE_ENV !== "production",
		organizationHotwords: readOrganizationHotwords(values.HOTWORDS, values.HOTWORDS_FILE)
	};
}

function readOrganizationHotwords(inline: string, file: string | undefined): string[] {
	const terms = inline.split(",");
	if (file) {
		const text = readFileSync(file, "utf8");
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim().startsWith("#")) terms.push(line);
		}
	}
	return terms.map(term => term.trim()).filter(Boolean);
}
