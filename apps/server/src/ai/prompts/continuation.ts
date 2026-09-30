import type { ArtifactMode } from "@innoverse/shared";

/** Turn-level task text for a brand-new artifact. */
export function newArtifactTask(mode: ArtifactMode): string {
	const target = mode === "presentation" ? "one new slide" : "one new Markdown document";
	return [`Task: create ${target} from the transcript below.`, "This is a fresh artifact. Ignore any earlier conversation in this thread; use only this transcript."].join("\n");
}

/** Turn-level task text for editing the current artifact. */
export function continuationTask(mode: ArtifactMode): string {
	const target = mode === "presentation" ? "slide" : "document";
	return [
		`Task: update the current ${target} using the new transcript below.`,
		`- The <current_artifact> is the authoritative latest version. The user may have edited it by hand after your previous answer, so it overrides anything you remember from earlier turns.`,
		`- The new transcript may add information, correct earlier content, or ask for changes to the ${target}. Apply it.`,
		"- Preserve unaffected content exactly (same wording, numbers and order). Do not rewrite parts that the transcript does not touch.",
		"- If the transcript contradicts the current artifact, follow the transcript only when the speaker is clearly correcting it; otherwise keep both and add a warning.",
		`- Return the complete updated ${target}, not a diff.`
	].join("\n");
}
