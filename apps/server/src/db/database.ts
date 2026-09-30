import type { Artifact, ArtifactMode, Workspace } from "@innoverse/shared";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

type ArtifactRow = {
	id: string;
	workspace_id: string;
	mode: ArtifactMode;
	content: string;
	revision: number;
	codex_thread_id: string | null;
	warnings: string;
	created_at: string;
	updated_at: string;
};

export type ArtifactRecord = Artifact & { codexThreadId: string | null };

export type SaveArtifactInput = {
	workspaceId: string;
	mode: ArtifactMode;
	content: string;
	warnings: string[];
	/** Revision the change was based on. 0 means "no artifact existed yet". */
	baseRevision: number;
	/** `undefined` keeps the current thread association. */
	codexThreadId?: string | null;
};

export type SaveArtifactResult = { ok: true; artifact: ArtifactRecord } | { ok: false; reason: "conflict"; current: ArtifactRecord | null };

export type GenerationRecord = {
	id: string;
	workspaceId: string;
	mode: ArtifactMode;
	continued: boolean;
	status: "success" | "error";
	errorCode: string | null;
	audioDurationMs: number | null;
	asrDurationMs: number | null;
	aiDurationMs: number | null;
	totalDurationMs: number;
	transcript: string | null;
};

const MIGRATIONS: string[] = [
	`
	CREATE TABLE workspaces (
		id TEXT PRIMARY KEY,
		hotwords TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE artifacts (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
		mode TEXT NOT NULL CHECK (mode IN ('presentation', 'document')),
		content TEXT NOT NULL,
		revision INTEGER NOT NULL CHECK (revision > 0),
		codex_thread_id TEXT,
		warnings TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		UNIQUE (workspace_id, mode)
	);
	CREATE TABLE generations (
		id TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL,
		mode TEXT NOT NULL,
		continued INTEGER NOT NULL,
		status TEXT NOT NULL,
		error_code TEXT,
		audio_duration_ms INTEGER,
		asr_duration_ms INTEGER,
		ai_duration_ms INTEGER,
		total_duration_ms INTEGER NOT NULL,
		transcript TEXT,
		created_at TEXT NOT NULL
	);
	CREATE INDEX generations_workspace_idx ON generations (workspace_id, created_at);
	`
];

function parseStringArray(json: string): string[] {
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function toRecord(row: ArtifactRow): ArtifactRecord {
	return {
		mode: row.mode,
		content: row.content,
		revision: row.revision,
		warnings: parseStringArray(row.warnings),
		updatedAt: row.updated_at,
		codexThreadId: row.codex_thread_id
	};
}

export function toPublicArtifact(record: ArtifactRecord): Artifact {
	return { mode: record.mode, content: record.content, revision: record.revision, warnings: record.warnings, updatedAt: record.updatedAt };
}

/** Compact SQLite persistence. Never stores audio or Codex credentials. */
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

	ensureWorkspace(workspaceId: string): void {
		const now = new Date().toISOString();
		this.db.prepare("INSERT INTO workspaces (id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING").run(workspaceId, now, now);
	}

	getWorkspace(workspaceId: string): Workspace {
		const workspace = this.db.prepare("SELECT hotwords FROM workspaces WHERE id = ?").get(workspaceId) as { hotwords: string } | undefined;
		const presentation = this.getArtifact(workspaceId, "presentation");
		const document = this.getArtifact(workspaceId, "document");
		return {
			id: workspaceId,
			artifacts: {
				presentation: presentation ? toPublicArtifact(presentation) : null,
				document: document ? toPublicArtifact(document) : null
			},
			hotwords: workspace ? parseStringArray(workspace.hotwords) : []
		};
	}

	getHotwords(workspaceId: string): string[] {
		const row = this.db.prepare("SELECT hotwords FROM workspaces WHERE id = ?").get(workspaceId) as { hotwords: string } | undefined;
		return row ? parseStringArray(row.hotwords) : [];
	}

	setHotwords(workspaceId: string, hotwords: string[]): void {
		this.ensureWorkspace(workspaceId);
		this.db.prepare("UPDATE workspaces SET hotwords = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(hotwords), new Date().toISOString(), workspaceId);
	}

	getArtifact(workspaceId: string, mode: ArtifactMode): ArtifactRecord | null {
		const row = this.db.prepare("SELECT * FROM artifacts WHERE workspace_id = ? AND mode = ?").get(workspaceId, mode) as ArtifactRow | undefined;
		return row ? toRecord(row) : null;
	}

	/**
	 * Optimistic concurrency: the write only succeeds when the stored revision still
	 * equals `baseRevision`; the new revision is `baseRevision + 1`.
	 */
	saveArtifact(input: SaveArtifactInput): SaveArtifactResult {
		return this.db.transaction((): SaveArtifactResult => {
			this.ensureWorkspace(input.workspaceId);
			const now = new Date().toISOString();
			const warnings = JSON.stringify(input.warnings);
			let changes: number;
			if (input.baseRevision === 0) {
				changes = this.db
					.prepare(
						`INSERT INTO artifacts (id, workspace_id, mode, content, revision, codex_thread_id, warnings, created_at, updated_at)
						VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT (workspace_id, mode) DO NOTHING`
					)
					.run(randomUUID(), input.workspaceId, input.mode, input.content, input.codexThreadId ?? null, warnings, now, now).changes;
			} else {
				const keepThread = input.codexThreadId === undefined ? 1 : 0;
				changes = this.db
					.prepare(
						`UPDATE artifacts SET content = ?, revision = revision + 1, warnings = ?, updated_at = ?,
							codex_thread_id = CASE WHEN ? THEN codex_thread_id ELSE ? END
						WHERE workspace_id = ? AND mode = ? AND revision = ?`
					)
					.run(input.content, warnings, now, keepThread, input.codexThreadId ?? null, input.workspaceId, input.mode, input.baseRevision).changes;
			}
			const current = this.getArtifact(input.workspaceId, input.mode);
			if (changes === 0 || !current) return { ok: false, reason: "conflict", current };
			this.db.prepare("UPDATE workspaces SET updated_at = ? WHERE id = ?").run(now, input.workspaceId);
			return { ok: true, artifact: current };
		})();
	}

	recordGeneration(record: GenerationRecord): void {
		this.db
			.prepare(
				`INSERT INTO generations (id, workspace_id, mode, continued, status, error_code, audio_duration_ms, asr_duration_ms, ai_duration_ms, total_duration_ms, transcript, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				record.id,
				record.workspaceId,
				record.mode,
				record.continued ? 1 : 0,
				record.status,
				record.errorCode,
				record.audioDurationMs === null ? null : Math.round(record.audioDurationMs),
				record.asrDurationMs === null ? null : Math.round(record.asrDurationMs),
				record.aiDurationMs === null ? null : Math.round(record.aiDurationMs),
				Math.round(record.totalDurationMs),
				record.transcript,
				new Date().toISOString()
			);
	}
}
