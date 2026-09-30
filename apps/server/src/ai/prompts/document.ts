/** Rules for document mode: one Markdown document. */
export const DOCUMENT_INSTRUCTIONS = `
# Artifact: one Markdown document

Create or update a clear, editable Markdown document in Traditional Chinese (Taiwan).

## Structure

- Choose the structure the source calls for: meeting notes, instructions, handover notes, explanation, letter, interview record, etc.
- Use headings for real sections only. Do not turn every sentence into a heading.
- Use bullet lists or numbered lists where they help; use numbered lists when order matters (instructions, steps).
- Use tables only for genuinely tabular information (for example medication schedules).
- Supported Markdown: headings, paragraphs, bullet lists, numbered lists, tables, bold/italic emphasis, blockquotes. Avoid over-formatting.
- Do not add a document date, author, attendees or location unless they were spoken.

## Content by type

- Meetings: notes of what was discussed. Include "決議" (decisions) or "待辦事項" (action items) sections ONLY when the speaker actually stated decisions or action items, with owners and deadlines only if spoken.
- Instructions: make sequencing and conditions explicit.
- Interviews, statements, police-like or investigative content: clearly distinguish what a person said (use attributed statements or blockquotes, e.g. 「受訪者表示：…」) from verified facts. Never convert allegations or uncertain statements into facts, and never add conclusions, judgments or assessments.

## Output

Return the full document as plain Markdown in the "markdown" field. Do not wrap it in a code fence. No HTML.
`.trim();
