import { DocumentOutputSchema, outputJsonSchemaFor, PresentationOutputSchema, type ArtifactMode } from "@innoverse/shared";
import type { RunTurnInput, RunTurnResult } from "../codex/codex-service";
import { AppError } from "../errors";
import { sanitizeSlideHtml } from "../slide/sanitize";
import { buildDeveloperInstructions, buildTurnInput } from "./prompts/compose";

export type TurnRunner = { runTurn(input: RunTurnInput): Promise<RunTurnResult> };

export type GenerateArtifactInput = {
	mode: ArtifactMode;
	transcript: string;
	/** Continue ON: the latest saved artifact content and its thread (if any). */
	continuation: { currentContent: string; threadId: string | null } | null;
	model: string;
	reasoningEffort: string | null;
};

export type GeneratedArtifact = {
	content: string;
	warnings: string[];
	threadId: string;
	resumedThread: boolean;
	/** Diagnostics only (counts, no content). */
	sanitizer: { removedElements: number; rejectedClasses: number } | null;
};

/** Removes a single code fence wrapping the whole document, if the model added one anyway. */
function unwrapWholeDocumentFence(markdown: string): string {
	const match = /^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```\s*$/.exec(markdown);
	return match ? (match[1] as string) : markdown;
}

/**
 * Transcript (+ current artifact) → Codex structured output → validation → sanitation.
 *
 * Continue OFF: always a fresh Codex thread, no previous artifact in the prompt.
 * Continue ON: resume the artifact's thread when possible and always include the
 * current artifact explicitly (it may have been edited by hand).
 */
export async function generateArtifact(runner: TurnRunner, input: GenerateArtifactInput): Promise<GeneratedArtifact> {
	const turn = await runner.runTurn({
		threadId: input.continuation?.threadId ?? null,
		model: input.model,
		reasoningEffort: input.reasoningEffort,
		developerInstructions: buildDeveloperInstructions(input.mode),
		input: buildTurnInput({ mode: input.mode, transcript: input.transcript, currentArtifact: input.continuation?.currentContent ?? null }),
		outputSchema: outputJsonSchemaFor(input.mode)
	});

	let raw: unknown;
	try {
		raw = JSON.parse(turn.text);
	} catch (error) {
		throw new AppError("INVALID_OUTPUT", { cause: error, detail: "structured output is not JSON" });
	}

	const warnings = (list: string[]) => list.map(warning => warning.trim()).filter(Boolean);

	if (input.mode === "presentation") {
		const parsed = PresentationOutputSchema.safeParse(raw);
		if (!parsed.success) throw new AppError("INVALID_OUTPUT", { detail: "presentation output failed schema validation" });
		const sanitized = sanitizeSlideHtml(parsed.data.html);
		if (!sanitized.ok) throw new AppError("INVALID_SLIDE", { detail: `slide html rejected: ${sanitized.reason}` });
		return {
			content: sanitized.html,
			warnings: warnings(parsed.data.warnings),
			threadId: turn.threadId,
			resumedThread: turn.resumed,
			sanitizer: { removedElements: sanitized.report.removedElements.length, rejectedClasses: sanitized.report.rejectedClasses.length }
		};
	}

	const parsed = DocumentOutputSchema.safeParse(raw);
	if (!parsed.success) throw new AppError("INVALID_OUTPUT", { detail: "document output failed schema validation" });
	const markdown = unwrapWholeDocumentFence(parsed.data.markdown).trim();
	if (!markdown) throw new AppError("INVALID_OUTPUT", { detail: "document output is empty" });
	return { content: `${markdown}\n`, warnings: warnings(parsed.data.warnings), threadId: turn.threadId, resumedThread: turn.resumed, sanitizer: null };
}
