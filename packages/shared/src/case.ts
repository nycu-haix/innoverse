import { z } from "zod";
import { ErrorCodeSchema } from "./errors";

export const CaseIdSchema = z.uuid();

export const SPEAKERS = ["officer", "victim"] as const;
export const SpeakerSchema = z.enum(SPEAKERS);
export type Speaker = z.infer<typeof SpeakerSchema>;
export const SPEAKER_LABELS: Record<Speaker, string> = { officer: "員警", victim: "被害人" };

/**
 * Where the current speaker label came from. `manual` always wins; `ai` replaces
 * `heuristic` after each analysis pass.
 */
export const SpeakerSourceSchema = z.enum(["heuristic", "ai", "manual"]);
export type SpeakerSource = z.infer<typeof SpeakerSourceSchema>;

/** Line ids are `L<seq>` and are what every structured fact points back to. */
export const LineIdSchema = z.string().regex(/^L[1-9]\d{0,5}$/);
export const lineId = (seq: number) => `L${seq}`;

export const UtteranceSchema = z.object({
	id: LineIdSchema,
	seq: z.int().positive(),
	/** Wall-clock start of the utterance (ISO 8601). */
	startedAt: z.string(),
	durationMs: z.int().nonnegative(),
	text: z.string(),
	speaker: SpeakerSchema,
	speakerSource: SpeakerSourceSchema,
	speakerUncertain: z.boolean(),
	hasAudio: z.boolean()
});
export type Utterance = z.infer<typeof UtteranceSchema>;

/* ---------- AI analysis (structured output) ---------- */

export const FACT_STATUSES = ["ok", "pending"] as const;
export const BLOCK_STATUSES = ["ok", "pending", "missing"] as const;
export const GAP_LEVELS = ["must", "lead", "add"] as const;
export const BLOCK_KINDS = ["contact", "trust", "scheme", "request", "payment", "discovery", "followup", "secondary", "summary", "other"] as const;

export type BlockStatus = (typeof BLOCK_STATUSES)[number];
export type GapLevel = (typeof GAP_LEVELS)[number];
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const GAP_LEVEL_LABELS: Record<GapLevel, string> = { must: "必要", lead: "偵查線索", add: "補充" };
export const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = { ok: "已取得", pending: "待確認", missing: "尚未提及" };

const ItemIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9][a-z0-9-]*$/);
const Text = (max: number) => z.string().max(max);

export const AiFactSchema = z.object({
	id: ItemIdSchema,
	/** May contain inline markup: {t|時間} {a|金額} {i|帳號／ID} {p|地點}. */
	text: Text(600),
	sources: z.array(z.string()).max(20),
	status: z.enum(FACT_STATUSES),
	/** Why the fact is pending (contradiction, vague wording, possible misrecognition). */
	note: Text(200).nullable(),
	/** Critical value to check against the victim's own records, e.g. "轉帳紀錄". */
	verifyWith: Text(60).nullable()
});

export const AiGapSchema = z.object({
	id: ItemIdSchema,
	field: Text(80),
	level: z.enum(GAP_LEVELS),
	question: Text(300),
	reason: Text(300),
	use: Text(200),
	basis: Text(300),
	/** 1 = ask first. */
	priority: z.int().min(1).max(99)
});

export const AiBlockSchema = z.object({
	id: ItemIdSchema,
	kind: z.enum(BLOCK_KINDS),
	title: Text(40),
	subtitle: Text(60).nullable(),
	status: z.enum(BLOCK_STATUSES),
	facts: z.array(AiFactSchema).max(40),
	gaps: z.array(AiGapSchema).max(20)
});

export const AiConflictSchema = z.object({
	id: ItemIdSchema,
	title: Text(80),
	detail: Text(400),
	sources: z.array(z.string()).max(20)
});

export const AiActionSchema = z.object({
	id: ItemIdSchema,
	text: Text(200),
	urgent: z.boolean(),
	reason: Text(200)
});

export const AiSpeakerSchema = z.object({
	lineId: z.string(),
	speaker: SpeakerSchema,
	uncertain: z.boolean()
});

export const AnalysisOutputSchema = z.object({
	fraudType: Text(40).nullable(),
	deliveryMethods: z.array(Text(40)).max(10),
	victimName: Text(40).nullable(),
	speakers: z.array(AiSpeakerSchema).max(2000),
	blocks: z.array(AiBlockSchema).max(30),
	conflicts: z.array(AiConflictSchema).max(20),
	actions: z.array(AiActionSchema).max(20)
});
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

/**
 * What the model returns each pass: only new or changed blocks, and explicit removals.
 * Omitted blocks are carried over from the stored analysis, which keeps output (and
 * therefore latency) proportional to what the latest lines changed.
 */
export const AnalysisDeltaSchema = AnalysisOutputSchema.extend({
	removedBlockIds: z.array(z.string()).max(30)
});
export type AnalysisDelta = z.infer<typeof AnalysisDeltaSchema>;
export type AiBlock = z.infer<typeof AiBlockSchema>;
export type AiFact = z.infer<typeof AiFactSchema>;
export type AiGap = z.infer<typeof AiGapSchema>;

const nullableString = { type: ["string", "null"] } as const;
const stringArray = { type: "array", items: { type: "string" } } as const;
const strictObject = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }) as const;

/** JSON Schema passed to Codex `turn/start` as `outputSchema`; mirrors AnalysisDeltaSchema. */
export const ANALYSIS_OUTPUT_JSON_SCHEMA = strictObject({
	fraudType: nullableString,
	deliveryMethods: stringArray,
	victimName: nullableString,
	speakers: {
		type: "array",
		items: strictObject({ lineId: { type: "string" }, speaker: { type: "string", enum: [...SPEAKERS] }, uncertain: { type: "boolean" } })
	},
	blocks: {
		type: "array",
		items: strictObject({
			id: { type: "string" },
			kind: { type: "string", enum: [...BLOCK_KINDS] },
			title: { type: "string" },
			subtitle: nullableString,
			status: { type: "string", enum: [...BLOCK_STATUSES] },
			facts: {
				type: "array",
				items: strictObject({
					id: { type: "string" },
					text: { type: "string" },
					sources: stringArray,
					status: { type: "string", enum: [...FACT_STATUSES] },
					note: nullableString,
					verifyWith: nullableString
				})
			},
			gaps: {
				type: "array",
				items: strictObject({
					id: { type: "string" },
					field: { type: "string" },
					level: { type: "string", enum: [...GAP_LEVELS] },
					question: { type: "string" },
					reason: { type: "string" },
					use: { type: "string" },
					basis: { type: "string" },
					priority: { type: "integer" }
				})
			}
		})
	},
	conflicts: {
		type: "array",
		items: strictObject({ id: { type: "string" }, title: { type: "string" }, detail: { type: "string" }, sources: stringArray })
	},
	actions: {
		type: "array",
		items: strictObject({ id: { type: "string" }, text: { type: "string" }, urgent: { type: "boolean" }, reason: { type: "string" } })
	},
	removedBlockIds: stringArray
});

export const RecordOutputSchema = z.object({ markdown: z.string().min(1).max(400_000) });
export const RECORD_OUTPUT_JSON_SCHEMA = strictObject({ markdown: { type: "string" } });

/* ---------- Case view sent to the browser (AI output merged with officer decisions) ---------- */

export const GAP_STATES = ["open", "asked", "skipped"] as const;
export const GapStateSchema = z.enum(GAP_STATES);
export type GapState = z.infer<typeof GapStateSchema>;

export const FactSchema = AiFactSchema.extend({
	/** AI wording before the officer edited it; null when unedited. */
	original: z.string().nullable()
});
export type Fact = z.infer<typeof FactSchema>;

export const GapSchema = AiGapSchema.extend({ state: GapStateSchema });
export type Gap = z.infer<typeof GapSchema>;

export const BlockSchema = AiBlockSchema.extend({ facts: z.array(FactSchema), gaps: z.array(GapSchema) });
export type Block = z.infer<typeof BlockSchema>;

export const AnalysisSchema = AnalysisOutputSchema.omit({ speakers: true }).extend({ blocks: z.array(BlockSchema) });
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Conflict = Analysis["conflicts"][number];
export type InvestigativeAction = Analysis["actions"][number];

export const TaskStatusSchema = z.object({
	state: z.enum(["idle", "queued", "running", "error"]),
	error: z.object({ code: ErrorCodeSchema, message: z.string() }).nullable()
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const RecordDocumentSchema = z.object({
	content: z.string(),
	/** Monotonic revision; 0 means "nothing generated yet". */
	revision: z.int().nonnegative(),
	updatedAt: z.string().nullable()
});
export type RecordDocument = z.infer<typeof RecordDocumentSchema>;

export const CaseSummarySchema = z.object({
	id: CaseIdSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
	startedAt: z.string().nullable(),
	fraudType: z.string().nullable(),
	victimName: z.string().nullable(),
	utteranceCount: z.int().nonnegative()
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;

export const CaseDetailSchema = CaseSummarySchema.extend({
	version: z.int().nonnegative(),
	utterances: z.array(UtteranceSchema),
	analysis: AnalysisSchema.nullable(),
	/** Highest utterance seq the current analysis has seen. */
	analyzedThrough: z.int().nonnegative(),
	analysisStatus: TaskStatusSchema,
	record: RecordDocumentSchema,
	recordStatus: TaskStatusSchema
});
export type CaseDetail = z.infer<typeof CaseDetailSchema>;

export const CaseListResponseSchema = z.object({ cases: z.array(CaseSummarySchema) });
export const CaseVersionResponseSchema = z.object({ version: z.int().nonnegative() });

/* ---------- Requests ---------- */

export const CaseParamsSchema = z.object({ caseId: CaseIdSchema });
export const LineParamsSchema = z.object({ caseId: CaseIdSchema, lineId: LineIdSchema });
export const ItemParamsSchema = z.object({ caseId: CaseIdSchema, itemId: ItemIdSchema });

/** Multipart fields sent with each utterance (strings, appended before the audio part). */
export const UtteranceFieldsSchema = z.object({
	startedAt: z.coerce.number().int().positive(),
	durationMs: z.coerce.number().int().nonnegative()
});
export const UTTERANCE_FIELDS = ["startedAt", "durationMs"] as const;

export const UpdateSpeakerRequestSchema = z.object({ speaker: SpeakerSchema });
export const UpdateFactRequestSchema = z.object({ text: z.string().trim().min(1).max(600).nullable() });
export const UpdateGapRequestSchema = z.object({ state: GapStateSchema });
export const UpdateRecordRequestSchema = z.object({ content: z.string().max(400_000), baseRevision: z.int().nonnegative() });
export const UpdateRecordResponseSchema = z.object({ record: RecordDocumentSchema });

export const SettingsSchema = z.object({
	model: z.string().max(128).nullable(),
	reasoningEffort: z.string().max(64).nullable(),
	hotwords: z.array(z.string().max(64)).max(200)
});
export type Settings = z.infer<typeof SettingsSchema>;

/* ---------- Inline markup ---------- */

export type MarkupKind = "t" | "a" | "i" | "p";
export type MarkupPart = { kind: MarkupKind | null; text: string };
export const MARKUP_LABELS: Record<MarkupKind, string> = { t: "時間", a: "金額", i: "帳號／ID", p: "地點" };

const MARKUP_PATTERN = /\{([taip])\|([^{}|]+)\}/g;

/** Split `{t|…}` style markup into typed parts. Malformed markup stays plain text. */
export function parseMarkup(text: string): MarkupPart[] {
	const parts: MarkupPart[] = [];
	let last = 0;
	for (const match of text.matchAll(MARKUP_PATTERN)) {
		const index = match.index;
		if (index > last) parts.push({ kind: null, text: text.slice(last, index) });
		parts.push({ kind: match[1] as MarkupKind, text: match[2] as string });
		last = index + match[0].length;
	}
	if (last < text.length) parts.push({ kind: null, text: text.slice(last) });
	return parts;
}

export function stripMarkup(text: string): string {
	return text.replace(MARKUP_PATTERN, "$2");
}
