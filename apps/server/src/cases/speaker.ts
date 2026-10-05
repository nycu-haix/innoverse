import type { Speaker } from "@innoverse/shared";

const QUESTION_ENDING = /[?？嗎呢]\s*[。.]?$/;
const OFFICER_OPENING = /^(請問|請您|請你|那您|那你|您說|你說|好，|好的，)/;

/**
 * First guess before the model sees the line: questions are usually the officer's.
 * Always marked uncertain; analysis replaces it, and the officer can correct it.
 */
export function guessSpeaker(text: string): { speaker: Speaker; uncertain: boolean } {
	const trimmed = text.trim();
	const officer = QUESTION_ENDING.test(trimmed) || OFFICER_OPENING.test(trimmed);
	return { speaker: officer ? "officer" : "victim", uncertain: true };
}
