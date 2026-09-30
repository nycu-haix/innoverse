import type { ArtifactMode } from "@innoverse/shared";
import { continuationTask, newArtifactTask } from "./continuation";
import { DOCUMENT_INSTRUCTIONS } from "./document";
import { GLOBAL_ARTIFACT_INSTRUCTIONS } from "./global";
import { PRESENTATION_INSTRUCTIONS } from "./presentation";

/** Stable per-mode system-level instructions (Codex developer instructions). */
export function buildDeveloperInstructions(mode: ArtifactMode): string {
	return [GLOBAL_ARTIFACT_INSTRUCTIONS, mode === "presentation" ? PRESENTATION_INSTRUCTIONS : DOCUMENT_INSTRUCTIONS].join("\n\n");
}

/** Neutralize anything that could close our boundary tags early. */
function fenceContent(tag: "transcript" | "current_artifact", content: string): string {
	const safe = content.replace(/<\/?\s*(transcript|current_artifact)\s*>/gi, match => match.replace("<", "‹").replace(">", "›"));
	return `<${tag}>\n${safe}\n</${tag}>`;
}

export type TurnInputOptions = {
	mode: ArtifactMode;
	transcript: string;
	/** Present only when Continue is on. Always the latest saved revision. */
	currentArtifact: string | null;
};

/**
 * Per-turn user input: task, transcript and (for Continue) the current artifact,
 * each separated by explicit boundaries. Source material stays untrusted.
 */
export function buildTurnInput(options: TurnInputOptions): string {
	const sections: string[] = [];
	if (options.currentArtifact !== null) {
		sections.push(continuationTask(options.mode));
		sections.push(fenceContent("current_artifact", options.currentArtifact));
	} else {
		sections.push(newArtifactTask(options.mode));
	}
	sections.push(fenceContent("transcript", options.transcript));
	sections.push("Return only the JSON object required by the output schema.");
	return sections.join("\n\n");
}
