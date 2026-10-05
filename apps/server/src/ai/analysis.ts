import {
	ANALYSIS_OUTPUT_JSON_SCHEMA,
	AnalysisDeltaSchema,
	RECORD_OUTPUT_JSON_SCHEMA,
	RecordOutputSchema,
	type AiBlock,
	type Analysis,
	type AnalysisDelta,
	type AnalysisOutput,
	type Block,
	type GapState,
	type Utterance
} from "@innoverse/shared";
import type { RunTurnInput, RunTurnResult } from "../codex/codex-service";
import type { FactEdit } from "../db/database";
import { AppError } from "../errors";
import { ANALYSIS_INSTRUCTIONS, buildAnalysisInput, buildRecordInput, RECORD_INSTRUCTIONS } from "./prompts";

export type TurnRunner = { runTurn(input: RunTurnInput): Promise<RunTurnResult> };

export type ModelChoice = { model: string; reasoningEffort: string | null };

export type CaseContext = {
	utterances: readonly Utterance[];
	/** Merged view (officer edits and gap decisions applied). */
	current: Analysis | null;
	interviewStartedAt: string | null;
};

export type AnalysisContext = CaseContext & {
	/** Stored AI output the delta applies to. */
	previous: AnalysisOutput | null;
};

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new AppError("INVALID_OUTPUT", { cause: error, detail: "structured output is not JSON" });
	}
}

/**
 * Every pass starts a fresh Codex thread: the full transcript and current state are
 * always in the input, so thread history would only grow without adding information.
 */
export async function analyzeCase(runner: TurnRunner, model: ModelChoice, context: AnalysisContext): Promise<AnalysisOutput> {
	const turn = await runner.runTurn({
		threadId: null,
		model: model.model,
		reasoningEffort: model.reasoningEffort,
		developerInstructions: ANALYSIS_INSTRUCTIONS,
		input: buildAnalysisInput(context),
		outputSchema: ANALYSIS_OUTPUT_JSON_SCHEMA
	});
	const parsed = AnalysisDeltaSchema.safeParse(parseJson(turn.text));
	if (!parsed.success) throw new AppError("INVALID_OUTPUT", { detail: "analysis output failed schema validation" });
	return normalizeAnalysis(applyDelta(context.previous, parsed.data), new Set(context.utterances.map(line => line.id)));
}

/** Blocks are shown in the order events happen in a fraud case. */
const KIND_ORDER: Record<AiBlock["kind"], number> = { contact: 0, trust: 1, scheme: 2, request: 3, payment: 4, discovery: 5, followup: 6, secondary: 7, other: 8, summary: 9 };

function blockNumber(id: string): number {
	const match = /-(\d+)$/.exec(id);
	return match ? Number(match[1]) : 0;
}

/**
 * Rebuild the full analysis from a delta: returned blocks replace stored ones with the
 * same id, omitted blocks are kept, and only ids listed in `removedBlockIds` are
 * dropped. Order follows the case timeline (payments by number).
 */
export function applyDelta(previous: AnalysisOutput | null, delta: AnalysisDelta): AnalysisOutput {
	const blocks = new Map((previous?.blocks ?? []).map(block => [block.id, block]));
	for (const block of delta.blocks) blocks.set(block.id, block);
	for (const id of delta.removedBlockIds) if (!delta.blocks.some(block => block.id === id)) blocks.delete(id);
	const ordered = [...blocks.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || blockNumber(a.id) - blockNumber(b.id));
	const { removedBlockIds: _removed, ...rest } = delta;
	return { ...rest, blocks: ordered };
}

export async function draftRecord(runner: TurnRunner, model: ModelChoice, context: CaseContext): Promise<string> {
	const turn = await runner.runTurn({
		threadId: null,
		model: model.model,
		reasoningEffort: model.reasoningEffort,
		developerInstructions: RECORD_INSTRUCTIONS,
		input: buildRecordInput(context),
		outputSchema: RECORD_OUTPUT_JSON_SCHEMA
	});
	const parsed = RecordOutputSchema.safeParse(parseJson(turn.text));
	if (!parsed.success) throw new AppError("INVALID_OUTPUT", { detail: "record output failed schema validation" });
	const fenced = /^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```\s*$/.exec(parsed.data.markdown);
	const markdown = (fenced ? (fenced[1] as string) : parsed.data.markdown).trim();
	if (!markdown) throw new AppError("INVALID_OUTPUT", { detail: "record output is empty" });
	return `${tidyQuestionAnswers(markdown)}\n`;
}

const ANSWER = /^\*\*答：\*\*\s*/;
const EMPTY_QUESTION = /^\*\*問：\*\*\s*$/;

/**
 * Keep the Q&A strictly alternating: an answer that continues without a new question
 * is merged into the previous answer, and empty questions are dropped.
 */
export function tidyQuestionAnswers(markdown: string): string {
	const out: string[] = [];
	for (const paragraph of markdown.split(/\n{2,}/)) {
		if (EMPTY_QUESTION.test(paragraph.trim())) continue;
		const previous = out.at(-1);
		if (previous !== undefined && ANSWER.test(previous) && ANSWER.test(paragraph)) {
			out[out.length - 1] = `${previous}${paragraph.replace(ANSWER, "")}`;
			continue;
		}
		out.push(paragraph);
	}
	return out.join("\n\n");
}

/**
 * Defensive cleanup of model output: unknown source lines are dropped, duplicate ids
 * get a suffix, speaker labels for unknown lines are discarded.
 */
export function normalizeAnalysis(output: AnalysisOutput, knownLines: ReadonlySet<string>): AnalysisOutput {
	// Each kind of item is addressed separately (blocks, facts, gaps…), so ids only need
	// to be unique within their kind; a gap may share its id with a block.
	const uniqueIn = () => {
		const seen = new Set<string>();
		return (id: string) => {
			let candidate = id;
			for (let n = 2; seen.has(candidate); n++) candidate = `${id}-${n}`;
			seen.add(candidate);
			return candidate;
		};
	};
	const blockId = uniqueIn();
	const factId = uniqueIn();
	const gapId = uniqueIn();
	const conflictId = uniqueIn();
	const actionId = uniqueIn();
	const sources = (list: readonly string[]) => [...new Set(list.filter(id => knownLines.has(id)))];

	return {
		...output,
		speakers: output.speakers.filter(label => knownLines.has(label.lineId)),
		blocks: output.blocks.map(block => ({
			...block,
			id: blockId(block.id),
			facts: block.facts.map(fact => ({ ...fact, id: factId(fact.id), sources: sources(fact.sources) })),
			gaps: block.gaps.map(gap => ({ ...gap, id: gapId(gap.id) }))
		})),
		conflicts: output.conflicts.map(conflict => ({ ...conflict, id: conflictId(conflict.id), sources: sources(conflict.sources) })),
		actions: output.actions.map(action => ({ ...action, id: actionId(action.id) }))
	};
}

/**
 * Apply the officer's decisions on top of the stored AI output. Edited facts keep the
 * officer's wording; an edited fact the model dropped is kept in its last block.
 */
export function buildAnalysisView(output: AnalysisOutput | null, factEdits: Readonly<Record<string, FactEdit>>, gapStates: Readonly<Record<string, GapState>>): Analysis | null {
	if (!output) return null;
	const placed = new Set<string>();
	const blocks: Block[] = output.blocks.map(block => ({
		...block,
		facts: block.facts.map(fact => {
			const edit = factEdits[fact.id];
			if (!edit) return { ...fact, original: null };
			placed.add(fact.id);
			return { ...fact, text: edit.text, original: edit.original };
		}),
		gaps: block.gaps.map(gap => ({ ...gap, state: gapStates[gap.id] ?? "open" }))
	}));

	for (const [factId, edit] of Object.entries(factEdits)) {
		if (placed.has(factId)) continue;
		const block = blocks.find(candidate => candidate.id === edit.blockId);
		block?.facts.push({ id: factId, text: edit.text, original: edit.original, sources: edit.sources, status: "ok", note: null, verifyWith: null });
	}

	return { fraudType: output.fraudType, deliveryMethods: output.deliveryMethods, victimName: output.victimName, blocks, conflicts: output.conflicts, actions: output.actions };
}
