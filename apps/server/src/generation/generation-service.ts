import { normalizeHotwords, resolveModelSelection, type GenerateMetadata, type GenerationResult, type GenerationStage, type ModelOption } from "@innoverse/shared";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { generateArtifact, type TurnRunner } from "../ai/artifact-generator";
import type { AsrProvider } from "../asr/asr-client";
import type { AppDatabase } from "../db/database";
import { toPublicArtifact } from "../db/database";
import { AppError, toAppError } from "../errors";

export type GenerationCodex = TurnRunner & {
	readonly isAuthenticated: boolean;
	listModels(): Promise<ModelOption[]>;
};

type Logger = {
	info(obj: object, msg?: string): void;
	warn(obj: object, msg?: string): void;
	error(obj: object, msg?: string): void;
	debug(obj: object, msg?: string): void;
};

export type GenerationServiceOptions = {
	db: AppDatabase;
	asr: AsrProvider;
	codex: GenerationCodex;
	logger: Logger;
	asrLanguage: string;
	organizationHotwords: string[];
	persistTranscripts: boolean;
	logTextPreviews: boolean;
};

export type PreparedGeneration = {
	generationId: string;
	metadata: GenerateMetadata;
	model: string;
	reasoningEffort: string | null;
	baseRevision: number;
	release: () => void;
};

function preview(text: string): string {
	return text.length <= 24 ? `${text.length} chars` : `${text.slice(0, 12)}…${text.slice(-6)} (${text.length} chars)`;
}

/**
 * Orchestrates one recording → artifact generation:
 * ASR → Codex → validation/sanitation → optimistic-concurrency save.
 */
export class GenerationService {
	private readonly active = new Set<string>();

	constructor(private readonly options: GenerationServiceOptions) {}

	/**
	 * Cheap checks run before any GPU/AI work: auth, model/effort against the live
	 * catalog, revision freshness, and one generation per workspace+mode at a time.
	 */
	async prepare(metadata: GenerateMetadata): Promise<PreparedGeneration> {
		const { codex, db } = this.options;
		if (!codex.isAuthenticated) throw new AppError("CODEX_UNAUTHENTICATED");

		// Fail fast with a real HTTP status while we still can: once the NDJSON stream
		// starts, the response is already 200 and errors can only be sent as events.
		const asrHealth = await this.options.asr.health();
		if (!asrHealth.reachable || !asrHealth.modelLoaded) throw new AppError("ASR_UNAVAILABLE", { detail: asrHealth.reachable ? "asr model not loaded" : "asr unreachable" });

		const models = await codex.listModels();
		const selection = resolveModelSelection(models, metadata.model, metadata.reasoningEffort);
		if (!selection.ok) throw new AppError(selection.code);

		const lockKey = `${metadata.workspaceId}:${metadata.mode}`;
		if (this.active.has(lockKey)) throw new AppError("GENERATION_IN_PROGRESS");

		let current;
		try {
			current = db.getArtifact(metadata.workspaceId, metadata.mode);
		} catch (error) {
			throw new AppError("DATABASE_ERROR", { cause: error });
		}
		const baseRevision = current?.revision ?? 0;
		// The client must be looking at the latest saved revision (pending manual edits are
		// flushed before recording is submitted), otherwise it could overwrite newer work.
		if (metadata.artifactRevision !== baseRevision) throw new AppError("STALE_REVISION");

		this.active.add(lockKey);
		return {
			generationId: randomUUID(),
			metadata,
			model: selection.selection.model,
			reasoningEffort: selection.selection.reasoningEffort,
			baseRevision,
			release: () => this.active.delete(lockKey)
		};
	}

	async run(prepared: PreparedGeneration, audio: { filePath: string; mimeType: string }, onStage: (stage: GenerationStage) => void): Promise<GenerationResult> {
		const { db, asr, codex, logger } = this.options;
		const { metadata, generationId } = prepared;
		const log = { generationId, workspaceId: metadata.workspaceId, mode: metadata.mode, continue: metadata.continue };
		const started = performance.now();
		let asrDurationMs: number | null = null;
		let aiDurationMs: number | null = null;
		let audioDurationMs: number | null = null;
		let transcript: string | null = null;

		const record = (status: "success" | "error", errorCode: string | null) => {
			try {
				db.recordGeneration({
					id: generationId,
					workspaceId: metadata.workspaceId,
					mode: metadata.mode,
					continued: metadata.continue,
					status,
					errorCode,
					audioDurationMs,
					asrDurationMs,
					aiDurationMs,
					totalDurationMs: performance.now() - started,
					transcript: this.options.persistTranscripts ? transcript : null
				});
			} catch (error) {
				logger.warn({ ...log, err: error }, "failed to record generation metadata");
			}
		};

		try {
			onStage("transcribing");
			const asrStarted = performance.now();
			const hotwords = normalizeHotwords([...this.options.organizationHotwords, ...db.getHotwords(metadata.workspaceId)]);
			const transcription = await asr.transcribe({ filePath: audio.filePath, mimeType: audio.mimeType, hotwords, language: this.options.asrLanguage });
			asrDurationMs = performance.now() - asrStarted;
			audioDurationMs = transcription.audioDurationMs;
			transcript = transcription.text.trim();
			logger.info({ ...log, stage: "asr", audioDurationMs, asrDurationMs: Math.round(asrDurationMs), hotwordCount: hotwords.length }, "transcription finished");
			if (this.options.logTextPreviews) logger.debug({ ...log, transcriptPreview: preview(transcript) }, "transcript preview");
			if (!transcript) throw new AppError("NO_SPEECH");

			onStage("generating");
			const aiStarted = performance.now();
			// Continue ON always uses the latest saved revision from SQLite, never client memory.
			const current = metadata.continue ? db.getArtifact(metadata.workspaceId, metadata.mode) : null;
			if (metadata.continue && (current?.revision ?? 0) !== prepared.baseRevision) throw new AppError("STALE_REVISION");
			const generated = await generateArtifact(codex, {
				mode: metadata.mode,
				transcript,
				continuation: current ? { currentContent: current.content, threadId: current.codexThreadId } : null,
				model: prepared.model,
				reasoningEffort: prepared.reasoningEffort
			});
			aiDurationMs = performance.now() - aiStarted;

			let saved;
			try {
				saved = db.saveArtifact({
					workspaceId: metadata.workspaceId,
					mode: metadata.mode,
					content: generated.content,
					warnings: generated.warnings,
					baseRevision: prepared.baseRevision,
					codexThreadId: generated.threadId
				});
			} catch (error) {
				throw new AppError("DATABASE_ERROR", { cause: error });
			}
			// An older generation must never overwrite a newer manual edit.
			if (!saved.ok) throw new AppError("STALE_REVISION");

			const totalDurationMs = performance.now() - started;
			logger.info(
				{
					...log,
					resultStatus: "success",
					model: prepared.model,
					reasoningEffort: prepared.reasoningEffort,
					resumedThread: generated.resumedThread,
					revision: saved.artifact.revision,
					audioDurationMs,
					asrDurationMs: Math.round(asrDurationMs),
					aiDurationMs: Math.round(aiDurationMs),
					totalDurationMs: Math.round(totalDurationMs),
					warningCount: generated.warnings.length,
					...(generated.sanitizer ?? {})
				},
				"generation finished"
			);
			record("success", null);
			return {
				generationId,
				artifact: toPublicArtifact(saved.artifact),
				warnings: generated.warnings,
				timings: { audioDurationMs, asrDurationMs, aiDurationMs, totalDurationMs }
			};
		} catch (error) {
			const appError = toAppError(error, "GENERATION_FAILED");
			logger.warn({ ...log, resultStatus: "error", errorCode: appError.code, detail: appError.message, totalDurationMs: Math.round(performance.now() - started) }, "generation failed");
			record("error", appError.code);
			throw appError;
		} finally {
			prepared.release();
		}
	}
}
