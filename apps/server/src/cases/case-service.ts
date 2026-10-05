import {
	ERROR_MESSAGES,
	normalizeHotwords,
	resolveModelSelection,
	stripMarkup,
	type CaseDetail,
	type CaseSummary,
	type GapState,
	type ModelOption,
	type RecordDocument,
	type Speaker,
	type TaskStatus,
	type Utterance
} from "@innoverse/shared";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { analyzeCase, buildAnalysisView, draftRecord, type ModelChoice, type TurnRunner } from "../ai/analysis";
import type { AsrProvider } from "../asr/asr-client";
import type { AppDatabase, UtteranceRecord } from "../db/database";
import { AppError, toAppError } from "../errors";
import { guessSpeaker } from "./speaker";

export type CaseCodex = TurnRunner & {
	readonly isAuthenticated: boolean;
	listModels(): Promise<ModelOption[]>;
};

type Logger = {
	info(obj: object, msg?: string): void;
	warn(obj: object, msg?: string): void;
	error(obj: object, msg?: string): void;
};

export type CaseServiceOptions = {
	db: AppDatabase;
	asr: AsrProvider;
	codex: CaseCodex;
	logger: Logger;
	audioDir: string;
	asrLanguage: string;
	organizationHotwords: string[];
	analysisDebounceMs: number;
	defaultModel?: string;
};

type CaseTasks = {
	analysis: TaskStatus;
	record: TaskStatus;
	timer: NodeJS.Timeout | undefined;
	running: Promise<void> | null;
	/** New input arrived while an analysis pass was running. */
	dirty: boolean;
};

const IDLE: TaskStatus = { state: "idle", error: null };

function failed(error: unknown): TaskStatus {
	const appError = toAppError(error, "GENERATION_FAILED");
	return { state: "error", error: { code: appError.code, message: ERROR_MESSAGES[appError.code] } };
}

function toPublicUtterance({ audioFile: _audioFile, ...utterance }: UtteranceRecord): Utterance {
	return utterance;
}

/**
 * One interview = one case. Utterances are transcribed as they arrive; the case is
 * re-analyzed after a short quiet period, one pass at a time per case. Officer
 * decisions (speakers, fact edits, gap states) are stored separately from AI output
 * and always win.
 */
export class CaseService {
	private readonly tasks = new Map<string, CaseTasks>();
	private closed = false;

	constructor(private readonly options: CaseServiceOptions) {}

	private tasksFor(caseId: string): CaseTasks {
		let tasks = this.tasks.get(caseId);
		if (!tasks) {
			tasks = { analysis: IDLE, record: IDLE, timer: undefined, running: null, dirty: false };
			this.tasks.set(caseId, tasks);
		}
		return tasks;
	}

	private db<T>(action: () => T): T {
		try {
			return action();
		} catch (error) {
			throw new AppError("DATABASE_ERROR", { cause: error });
		}
	}

	private requireCase(caseId: string) {
		const record = this.db(() => this.options.db.getCase(caseId));
		if (!record) throw new AppError("NOT_FOUND");
		return record;
	}

	createCase(): CaseDetail {
		const record = this.db(() => this.options.db.createCase(randomUUID()));
		return this.detail(record.summary.id);
	}

	list(): CaseSummary[] {
		return this.db(() => this.options.db.listCases());
	}

	version(caseId: string): number {
		const version = this.db(() => this.options.db.getVersion(caseId));
		if (version === null) throw new AppError("NOT_FOUND");
		return version;
	}

	detail(caseId: string): CaseDetail {
		const record = this.requireCase(caseId);
		const tasks = this.tasksFor(caseId);
		return {
			...record.summary,
			version: record.version,
			utterances: this.db(() => this.options.db.listUtterances(caseId)).map(toPublicUtterance),
			analysis: buildAnalysisView(record.analysis, record.factEdits, record.gapStates),
			analyzedThrough: record.analyzedThrough,
			analysisStatus: tasks.analysis,
			record: record.record,
			recordStatus: tasks.record
		};
	}

	/* ---------- transcript ---------- */

	async addUtterance(caseId: string, audio: { filePath: string; mimeType: string }, timing: { startedAt: number; durationMs: number }): Promise<Utterance> {
		this.requireCase(caseId);
		const { asr, db, logger } = this.options;
		const hotwords = normalizeHotwords([...this.options.organizationHotwords, ...this.db(() => db.getSettings().hotwords)]);
		const started = performance.now();
		const transcription = await asr.transcribe({ filePath: audio.filePath, mimeType: audio.mimeType, hotwords, language: this.options.asrLanguage });
		const text = transcription.text.trim();
		if (!text) throw new AppError("NO_SPEECH");

		const guess = guessSpeaker(text);
		const utterance = this.db(() =>
			db.addUtterance({ caseId, startedAt: new Date(timing.startedAt).toISOString(), durationMs: timing.durationMs, text, speaker: guess.speaker, speakerUncertain: guess.uncertain })
		);
		try {
			const dir = path.join(this.options.audioDir, caseId);
			await mkdir(dir, { recursive: true, mode: 0o700 });
			const file = `${utterance.id}.wav`;
			await copyFile(audio.filePath, path.join(dir, file));
			this.db(() => db.setUtteranceAudio(caseId, utterance.seq, file));
			utterance.audioFile = file;
			utterance.hasAudio = true;
		} catch (error) {
			// The transcript line is still useful without its audio.
			logger.warn({ caseId, line: utterance.id, err: error }, "failed to keep utterance audio");
		}
		logger.info({ caseId, line: utterance.id, audioMs: timing.durationMs, asrMs: Math.round(performance.now() - started) }, "utterance transcribed");
		this.scheduleAnalysis(caseId);
		return toPublicUtterance(utterance);
	}

	audioFile(caseId: string, line: string): string | null {
		const seq = Number(line.slice(1));
		const utterance = this.db(() => this.options.db.getUtterance(caseId, seq));
		return utterance?.audioFile ? path.join(this.options.audioDir, caseId, utterance.audioFile) : null;
	}

	setSpeaker(caseId: string, line: string, speaker: Speaker): void {
		const changed = this.db(() => this.options.db.setManualSpeaker(caseId, Number(line.slice(1)), speaker));
		if (!changed) throw new AppError("NOT_FOUND");
		this.scheduleAnalysis(caseId);
	}

	/* ---------- officer decisions ---------- */

	editFact(caseId: string, factId: string, text: string | null): void {
		const record = this.requireCase(caseId);
		const existing = record.factEdits[factId];
		const block = record.analysis?.blocks.find(candidate => candidate.facts.some(fact => fact.id === factId));
		const fact = block?.facts.find(candidate => candidate.id === factId);
		if (!fact && !existing) throw new AppError("NOT_FOUND");
		const original = existing?.original ?? (fact?.text as string);
		const keep = text !== null && text !== original && text !== stripMarkup(original);
		this.db(() => this.options.db.setFactEdit(caseId, factId, keep ? { text, original, blockId: block?.id ?? existing?.blockId ?? "", sources: fact?.sources ?? existing?.sources ?? [] } : null));
	}

	setGapState(caseId: string, gapId: string, state: GapState): void {
		const record = this.requireCase(caseId);
		const exists = record.analysis?.blocks.some(block => block.gaps.some(gap => gap.id === gapId));
		if (!exists) throw new AppError("NOT_FOUND");
		this.db(() => this.options.db.setGapState(caseId, gapId, state));
	}

	/* ---------- analysis ---------- */

	requestAnalysis(caseId: string): void {
		this.requireCase(caseId);
		this.scheduleAnalysis(caseId, 0);
	}

	private scheduleAnalysis(caseId: string, delay = this.options.analysisDebounceMs): void {
		if (this.closed) return;
		const tasks = this.tasksFor(caseId);
		if (tasks.running) {
			tasks.dirty = true;
			return;
		}
		clearTimeout(tasks.timer);
		if (tasks.analysis.state !== "queued") {
			tasks.analysis = { state: "queued", error: null };
			this.db(() => this.options.db.touch(caseId));
		}
		tasks.timer = setTimeout(() => {
			tasks.timer = undefined;
			tasks.running = this.runAnalysis(caseId).finally(() => {
				tasks.running = null;
				if (tasks.dirty) {
					tasks.dirty = false;
					this.scheduleAnalysis(caseId, 0);
				}
			});
		}, delay);
	}

	private setStatus(caseId: string, key: "analysis" | "record", status: TaskStatus): void {
		this.tasksFor(caseId)[key] = status;
		try {
			this.options.db.touch(caseId);
		} catch (error) {
			this.options.logger.warn({ caseId, err: error }, "failed to bump case version");
		}
	}

	private async runAnalysis(caseId: string): Promise<void> {
		const { db, codex, logger } = this.options;
		this.setStatus(caseId, "analysis", { state: "running", error: null });
		const started = performance.now();
		try {
			const record = db.getCase(caseId);
			if (!record) return;
			const utterances = db.listUtterances(caseId);
			if (utterances.length === 0) {
				this.setStatus(caseId, "analysis", IDLE);
				return;
			}
			const model = await this.modelChoice();
			const output = await analyzeCase(codex, model, {
				utterances,
				previous: record.analysis,
				current: buildAnalysisView(record.analysis, record.factEdits, record.gapStates),
				interviewStartedAt: record.summary.startedAt
			});
			const through = utterances.at(-1)?.seq ?? 0;
			db.saveAnalysis(caseId, output, through);
			logger.info(
				{ caseId, through, blocks: output.blocks.length, gaps: output.blocks.reduce((sum, block) => sum + block.gaps.length, 0), aiMs: Math.round(performance.now() - started), model: model.model },
				"case analyzed"
			);
			this.setStatus(caseId, "analysis", IDLE);
		} catch (error) {
			const status = failed(error);
			logger.warn({ caseId, errorCode: status.error?.code, detail: error instanceof Error ? error.message : undefined }, "case analysis failed");
			this.setStatus(caseId, "analysis", status);
		}
	}

	/** Resolves when no analysis pass is pending or running for the case (tests, shutdown). */
	async settled(caseId: string): Promise<void> {
		for (;;) {
			const tasks = this.tasks.get(caseId);
			if (!tasks) return;
			if (tasks.running) await tasks.running;
			else if (tasks.timer) await new Promise(resolve => setTimeout(resolve, 5));
			else return;
		}
	}

	private async modelChoice(): Promise<ModelChoice> {
		const { codex } = this.options;
		if (!codex.isAuthenticated) throw new AppError("CODEX_UNAUTHENTICATED");
		const settings = this.options.db.getSettings();
		const models = await codex.listModels();
		const preferred = resolveModelSelection(models, settings.model ?? this.options.defaultModel, settings.reasoningEffort ?? undefined);
		if (preferred.ok) return preferred.selection;
		// A stored choice may have disappeared from the catalog; fall back to the defaults.
		const fallback = resolveModelSelection(models, undefined, undefined);
		if (!fallback.ok) throw new AppError(fallback.code);
		return fallback.selection;
	}

	/* ---------- 筆錄 ---------- */

	async generateRecord(caseId: string): Promise<RecordDocument> {
		const record = this.requireCase(caseId);
		const tasks = this.tasksFor(caseId);
		if (tasks.record.state === "running") throw new AppError("GENERATION_IN_PROGRESS");
		const utterances = this.db(() => this.options.db.listUtterances(caseId));
		if (utterances.length === 0) throw new AppError("NO_SPEECH");
		this.setStatus(caseId, "record", { state: "running", error: null });
		try {
			const model = await this.modelChoice();
			const markdown = await draftRecord(this.options.codex, model, {
				utterances,
				current: buildAnalysisView(record.analysis, record.factEdits, record.gapStates),
				interviewStartedAt: record.summary.startedAt
			});
			const current = this.requireCase(caseId).record;
			const saved = this.db(() => this.options.db.saveRecord(caseId, markdown, current.revision));
			if (!saved.ok) throw new AppError("STALE_REVISION");
			this.setStatus(caseId, "record", IDLE);
			return saved.record;
		} catch (error) {
			this.setStatus(caseId, "record", failed(error));
			throw toAppError(error, "GENERATION_FAILED");
		}
	}

	saveRecord(caseId: string, content: string, baseRevision: number): { ok: true; record: RecordDocument } | { ok: false; current: RecordDocument | null } {
		this.requireCase(caseId);
		return this.db(() => this.options.db.saveRecord(caseId, content, baseRevision));
	}

	close(): void {
		this.closed = true;
		for (const tasks of this.tasks.values()) clearTimeout(tasks.timer);
	}
}
