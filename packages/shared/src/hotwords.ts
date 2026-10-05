export const MAX_HOTWORDS = 200;
export const MAX_HOTWORD_LENGTH = 64;

/** Trim, drop empties and duplicates, and cap the list. Order is preserved. */
export function normalizeHotwords(input: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of input) {
		// Strip control characters and the delimiters the ASR prompt uses to separate terms.
		// eslint-disable-next-line no-control-regex
		const term = raw.replace(/[\u0000-\u001f\u007f[\]]/g, "").trim();
		if (!term || term.length > MAX_HOTWORD_LENGTH || seen.has(term)) continue;
		seen.add(term);
		result.push(term);
		if (result.length >= MAX_HOTWORDS) break;
	}
	return result;
}
