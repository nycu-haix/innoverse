import { lineId, type AnalysisOutput, type CaseSummary, type GapState, type RecordDocument, type Settings, type Speaker, type SpeakerSource, type Utterance } from "@innoverse/shared";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

type CaseRow = {
	id: string;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	version: number;
	analysis: string | null;
	analyzed_through: number;
	gap_states: string;
	fact_edits: string;
	record: string;
	record_revision: number;
	record_updated_at: string | null;
	utterance_count: number;
};

type UtteranceRow = {
	seq: number;
	started_at: string;
	duration_ms: number;
	text: string;
	speaker: Speaker;
	speaker_source: SpeakerSource;
	speaker_uncertain: number;
	audio_file: string | null;
};

/**
 * Officer edit of an AI fact. `original` is the AI wording it replaced; block and
 * sources are kept so the fact survives an analysis pass that drops it.
 */
export type FactEdit = { text: string; original: string; blockId: string; sources: string[] };

export type CaseRecord = {
	summary: CaseSummary;
	version: number;
	analysis: AnalysisOutput | null;
	analyzedThrough: number;
	gapStates: Record<string, GapState>;
	factEdits: Record<string, FactEdit>;
	record: RecordDocument;
};

export type UtteranceRecord = Utterance & { audioFile: string | null };

export type NewUtterance = {
	caseId: string;
	startedAt: string;
	durationMs: number;
	text: string;
	speaker: Speaker;
	speakerUncertain: boolean;
};

const MIGRATIONS: string[] = [
	`
	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	CREATE TABLE cases (
		id TEXT PRIMARY KEY,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		started_at TEXT,
		version INTEGER NOT NULL DEFAULT 1,
		analysis TEXT,
		analyzed_through INTEGER NOT NULL DEFAULT 0,
		gap_states TEXT NOT NULL DEFAULT '{}',
		fact_edits TEXT NOT NULL DEFAULT '{}',
		record TEXT NOT NULL DEFAULT '',
		record_revision INTEGER NOT NULL DEFAULT 0,
		record_updated_at TEXT
	);
	CREATE TABLE utterances (
		case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
		seq INTEGER NOT NULL,
		started_at TEXT NOT NULL,
		duration_ms INTEGER NOT NULL,
		text TEXT NOT NULL,
		speaker TEXT NOT NULL CHECK (speaker IN ('officer', 'victim')),
		speaker_source TEXT NOT NULL CHECK (speaker_source IN ('heuristic', 'ai', 'manual')),
		speaker_uncertain INTEGER NOT NULL DEFAULT 0,
		audio_file TEXT,
		created_at TEXT NOT NULL,
		PRIMARY KEY (case_id, seq)
	);
	`
];

function parseObject<T>(json: string | null): T | null {
	if (!json) return null;
	try {
		const value: unknown = JSON.parse(json);
		return value && typeof value === "object" ? (value as T) : null;
	} catch {
		return null;
	}
}

function toUtterance(row: UtteranceRow): UtteranceRecord {
	return {
		id: lineId(row.seq),
		seq: row.seq,
		startedAt: row.started_at,
		durationMs: row.duration_ms,
		text: row.text,
		speaker: row.speaker,
		speakerSource: row.speaker_source,
		speakerUncertain: row.speaker_uncertain === 1,
		hasAudio: row.audio_file !== null,
		audioFile: row.audio_file
	};
}

const CASE_SELECT = `SELECT c.*, (SELECT COUNT(*) FROM utterances u WHERE u.case_id = c.id) AS utterance_count FROM cases c`;

/** SQLite persistence for cases, utterances and settings. Audio files live on disk (AUDIO_DIR). */
export class AppDatabase {
	private readonly db: Database.Database;

	constructor(filename: string) {
		if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
		this.db = new Database(filename);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
		this.db.pragma("busy_timeout = 5000");
		this.migrate();
	}

	private migrate(): void {
		const current = this.db.pragma("user_version", { simple: true }) as number;
		for (let version = current; version < MIGRATIONS.length; version++) {
			this.db.transaction(() => {
				this.db.exec(MIGRATIONS[version] as string);
				this.db.pragma(`user_version = ${version + 1}`);
			})();
		}
	}

	ping(): boolean {
		return this.db.prepare("SELECT 1 AS ok").get() !== undefined;
	}

	close(): void {
		if (this.db.open) this.db.close();
	}

	/* ---------- settings ---------- */

	getSettings(): Settings {
		const rows = this.db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
		const map = new Map(rows.map(row => [row.key, row.value]));
		const hotwords = parseObject<unknown[]>(map.get("hotwords") ?? null);
		return {
			model: map.get("model") ?? null,
			reasoningEffort: map.get("reasoningEffort") ?? null,
			hotwords: Array.isArray(hotwords) ? hotwords.filter((item): item is string => typeof item === "string") : []
		};
	}

	saveSettings(settings: Settings): void {
		const upsert = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
		const remove = this.db.prepare("DELETE FROM settings WHERE key = ?");
		this.db.transaction(() => {
			for (const key of ["model", "reasoningEffort"] as const) {
				const value = settings[key];
				if (value) upsert.run(key, value);
				else remove.run(key);
			}
			upsert.run("hotwords", JSON.stringify(settings.hotwords));
		})();
	}

	/* ---------- cases ---------- */

	createCase(id: string): CaseRecord {
		const now = new Date().toISOString();
		this.db.prepare("INSERT INTO cases (id, created_at, updated_at) VALUES (?, ?, ?)").run(id, now, now);
		return this.getCase(id) as CaseRecord;
	}

	listCases(limit = 50): CaseSummary[] {
		const rows = this.db.prepare(`${CASE_SELECT} ORDER BY c.updated_at DESC LIMIT ?`).all(limit) as CaseRow[];
		return rows.map(row => this.toCase(row).summary);
	}

	getCase(id: string): CaseRecord | null {
		const row = this.db.prepare(`${CASE_SELECT} WHERE c.id = ?`).get(id) as CaseRow | undefined;
		return row ? this.toCase(row) : null;
	}

	getVersion(id: string): number | null {
		const row = this.db.prepare("SELECT version FROM cases WHERE id = ?").get(id) as { version: number } | undefined;
		return row?.version ?? null;
	}

	/** Bump the polling version, e.g. when in-memory task status changes. */
	touch(id: string): void {
		this.db.prepare("UPDATE cases SET version = version + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
	}

	private toCase(row: CaseRow): CaseRecord {
		const analysis = parseObject<AnalysisOutput>(row.analysis);
		return {
			summary: {
				id: row.id,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
				startedAt: row.started_at,
				fraudType: analysis?.fraudType ?? null,
				victimName: analysis?.victimName ?? null,
				utteranceCount: row.utterance_count
			},
			version: row.version,
			analysis,
			analyzedThrough: row.analyzed_through,
			gapStates: parseObject<Record<string, GapState>>(row.gap_states) ?? {},
			factEdits: parseObject<Record<string, FactEdit>>(row.fact_edits) ?? {},
			record: { content: row.record, revision: row.record_revision, updatedAt: row.record_updated_at }
		};
	}

	/* ---------- utterances ---------- */

	addUtterance(input: NewUtterance): UtteranceRecord {
		return this.db.transaction(() => {
			const now = new Date().toISOString();
			const next = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM utterances WHERE case_id = ?").get(input.caseId) as { seq: number };
			this.db
				.prepare(
					`INSERT INTO utterances (case_id, seq, started_at, duration_ms, text, speaker, speaker_source, speaker_uncertain, created_at)
					VALUES (?, ?, ?, ?, ?, ?, 'heuristic', ?, ?)`
				)
				.run(input.caseId, next.seq, input.startedAt, input.durationMs, input.text, input.speaker, input.speakerUncertain ? 1 : 0, now);
			this.db.prepare("UPDATE cases SET started_at = COALESCE(started_at, ?), version = version + 1, updated_at = ? WHERE id = ?").run(input.startedAt, now, input.caseId);
			return this.getUtterance(input.caseId, next.seq) as UtteranceRecord;
		})();
	}

	setUtteranceAudio(caseId: string, seq: number, audioFile: string): void {
		this.db.prepare("UPDATE utterances SET audio_file = ? WHERE case_id = ? AND seq = ?").run(audioFile, caseId, seq);
	}

	listUtterances(caseId: string): UtteranceRecord[] {
		const rows = this.db.prepare("SELECT * FROM utterances WHERE case_id = ? ORDER BY seq").all(caseId) as UtteranceRow[];
		return rows.map(toUtterance);
	}

	getUtterance(caseId: string, seq: number): UtteranceRecord | null {
		const row = this.db.prepare("SELECT * FROM utterances WHERE case_id = ? AND seq = ?").get(caseId, seq) as UtteranceRow | undefined;
		return row ? toUtterance(row) : null;
	}

	/** Officer correction; never overwritten by later analysis passes. */
	setManualSpeaker(caseId: string, seq: number, speaker: Speaker): boolean {
		return this.db.transaction(() => {
			const changes = this.db.prepare("UPDATE utterances SET speaker = ?, speaker_source = 'manual', speaker_uncertain = 0 WHERE case_id = ? AND seq = ?").run(speaker, caseId, seq).changes;
			if (changes > 0) this.touch(caseId);
			return changes > 0;
		})();
	}

	/* ---------- analysis ---------- */

	/**
	 * Store a completed analysis and the AI speaker labels in one transaction.
	 * Manually corrected speakers are left alone.
	 */
	saveAnalysis(caseId: string, analysis: AnalysisOutput, analyzedThrough: number): void {
		const setSpeaker = this.db.prepare("UPDATE utterances SET speaker = ?, speaker_source = 'ai', speaker_uncertain = ? WHERE case_id = ? AND seq = ? AND speaker_source != 'manual'");
		this.db.transaction(() => {
			for (const label of analysis.speakers) {
				const seq = Number(label.lineId.slice(1));
				if (Number.isInteger(seq)) setSpeaker.run(label.speaker, label.uncertain ? 1 : 0, caseId, seq);
			}
			this.db
				.prepare("UPDATE cases SET analysis = ?, analyzed_through = ?, version = version + 1, updated_at = ? WHERE id = ?")
				.run(JSON.stringify(analysis), analyzedThrough, new Date().toISOString(), caseId);
		})();
	}

	setGapState(caseId: string, gapId: string, state: GapState): boolean {
		return this.updateJsonColumn(caseId, "gap_states", (states: Record<string, GapState>) => {
			if (state === "open") delete states[gapId];
			else states[gapId] = state;
		});
	}

	setFactEdit(caseId: string, factId: string, edit: FactEdit | null): boolean {
		return this.updateJsonColumn(caseId, "fact_edits", (edits: Record<string, FactEdit>) => {
			if (edit) edits[factId] = edit;
			else delete edits[factId];
		});
	}

	private updateJsonColumn<T extends object>(caseId: string, column: "gap_states" | "fact_edits", mutate: (value: T) => void): boolean {
		return this.db.transaction(() => {
			const row = this.db.prepare(`SELECT ${column} AS value FROM cases WHERE id = ?`).get(caseId) as { value: string } | undefined;
			if (!row) return false;
			const value = parseObject<T>(row.value) ?? ({} as T);
			mutate(value);
			this.db.prepare(`UPDATE cases SET ${column} = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(JSON.stringify(value), new Date().toISOString(), caseId);
			return true;
		})();
	}

	/* ---------- record document ---------- */

	/** Optimistic concurrency: only writes when the stored revision equals `baseRevision`. */
	saveRecord(caseId: string, content: string, baseRevision: number): { ok: true; record: RecordDocument } | { ok: false; current: RecordDocument | null } {
		return this.db.transaction(() => {
			const now = new Date().toISOString();
			const changes = this.db
				.prepare("UPDATE cases SET record = ?, record_revision = record_revision + 1, record_updated_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND record_revision = ?")
				.run(content, now, now, caseId, baseRevision).changes;
			const current = this.getCase(caseId)?.record ?? null;
			if (changes === 0 || !current) return { ok: false as const, current };
			return { ok: true as const, record: current };
		})();
	}
}
